import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ValidationService } from '../common/validation.service';
import { EditionService } from '../common/edition.service';
import { CreateEventRequestDto } from '../dto/create-event-request.dto';
import { CreateEventResponseDto } from '../dto/create-event-response.dto';
import { ReviewData, UnifiedReviewService } from '../../common/review.service';
// import { EventReplicaService } from '../common/event-replica.service';
import { S3Service } from '../../common/s3.service';
import { EmailService } from '../../common/email.service';
// import { StatsProcessingService } from '../common/stats-processing.service';
import { CommonService } from '../common/common.service';
// import { FutureEditionService } from '../common/future.edition.service';
// import { ProductManagementService } from '../common/product-management.service';
// import { SubVenueManagementService } from '../common/sub-venue-management.service';
import { EventUpsertRequestDto } from '../dto/upsert-event-request.dto';
import { EventUpsertResponseDto, createSuccessResponse, createErrorResponse } from '../dto/upsert-event-response.dto';
import { ElasticsearchService } from 'src/elasticsearch/elasticsearch.service';
// import { EventDataTransformerService } from '../common/event-data-transformer';
import { FirebaseSessionService } from 'src/common/firebase-session.service';
import { RabbitmqService } from '../../common/rabbitmq.service';
import { createEventReviewData } from '../dto/create-review.dto';

interface FutureEventData {
  startDate: string;
  endDate: string;
  companyId?: string;
  venue?: string;
  city?: string;
  website?: string;
  timezone?: string;
  timezonecountry?: string;
  timing?: string;
  description?: string;
  short_desc?: string;
  editionId?: string;
  expiredControl?: number;
}

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(
    private prisma: PrismaService,
    private validationService: ValidationService,
    private editionService: EditionService,
    private elasticsearchService: ElasticsearchService,
    // private eventReplicaService: EventReplicaService,
    // private eventDataTransformerService: EventDataTransformerService,
    private rabbitMQService: RabbitmqService, 
    private s3Service: S3Service,
    private emailService: EmailService,  
    private unifiedReviewService: UnifiedReviewService, 
    // private statsProcessingService: StatsProcessingService,
    private commonService: CommonService,
    // private futureEditionService: FutureEditionService,
    // private productManagementService: ProductManagementService,
    // private subVenueManagementService: SubVenueManagementService,
    private rabbitmqService: RabbitmqService,
    private firebaseSessionService: FirebaseSessionService,

  ) {}


  async upsertEvent(eventData: EventUpsertRequestDto): Promise<EventUpsertResponseDto> {
      try {
        console.log('Received eventData:', JSON.stringify(eventData, null, 2));
  
        // Future edition creation/update
        if (eventData.future && 
          typeof eventData.future === 'string' && 
          eventData.future.trim() !== '') {
          return await this.handleFutureEdition(eventData);
        }
  
        // Determine if this is create or update
        const isUpdate = eventData.id && typeof eventData.id === 'number';
        console.log('Is update:', isUpdate, 'Event ID:', eventData.id);
  
        let result: EventUpsertResponseDto;
        
        if (isUpdate) {
          console.log('Processing event update...');
          result = await this.updateEvent(eventData);
        } else {
          // result = await this.eventCreationService.createEvent(eventData);
          result = await this.updateEvent(eventData);
  
        }
  
        // Post-processing: Send to RabbitMQ and Elasticsearch
        if (result.status.code === 1 && result.data?.id) {
          await this.postProcessEvent(result.data.id, result.data.edition, eventData, !!isUpdate);
        }
  
        return result;
      } catch (error) {
        return createErrorResponse([error.message || 'Event operation failed']);
      }
    }

  private async handleFutureEdition(eventData: EventUpsertRequestDto): Promise<EventUpsertResponseDto> {
    try {
      // Step 1: Basic input validation
      if (!eventData.id) {
        return createErrorResponse(['Event ID is required for future edition']);
      }

      if (!eventData.future) {
        return createErrorResponse(['Future edition data is required']);
      }

      // Step 2: Parse and validate all data in one go
      const validationResult = await this.validateFutureEditionData(eventData);
      if (!validationResult.isValid) {
        return createErrorResponse(validationResult.messages);
      }

      // Step 3: Process transaction with validated data 
      const { future, company, venue, city, originalEdition } = validationResult.validatedData!;

      const result = await this.prisma.$transaction(async (tx) => {
        let futureEdition;
        let isNew = true;

        if (future.editionId) {
          // Update existing future edition
          futureEdition = await tx.event_edition.findUnique({
            where: { id: parseInt(future.editionId) }
          });

          if (!futureEdition) {
            throw new Error('invalid editionId');
          }

          isNew = false;
          
          await tx.event_edition.update({
            where: { id: futureEdition.id },
            data: {
              start_date: new Date(future.startDate),
              end_date: new Date(future.endDate),
              modified: new Date(),
              modifiedby: eventData.changesMadeBy,
              website: future.website,
              eep_process: eventData.eepProcess,
              city: city?.id || city,
            }
          });
        } else {
          // Create new future edition
          const editionNumber = originalEdition ? (originalEdition.edition_number || 0) + 1 : 1;

          futureEdition = await tx.event_edition.create({
            data: {
              event: eventData.id!,
              start_date: new Date(future.startDate),
              end_date: new Date(future.endDate),
              company_id: company?.id,
              venue: venue?.id,
              city: city?.id || city,
              edition_number: editionNumber,
              createdby: eventData.changesMadeBy,
              website: future.website,
              eep_process: eventData.eepProcess || 0,
              online_event: (city?.id || city) === 1 ? 1 : null,
            }
          });
        }

        // Handle timing data
        if (future.timing) {
          await this.upsertEventData(
            tx, 
            eventData.id!, 
            futureEdition.id, 
            'timing', 
            'JSON', 
            future.timing, 
            eventData.changesMadeBy
          );
        }

        // Handle description
        if (future.description) {
          await this.upsertEventData(
            tx, 
            eventData.id!, 
            futureEdition.id, 
            'desc', 
            'TEXT', 
            future.description, 
            eventData.changesMadeBy
          );
        }

        // Handle short description
        if (future.short_desc) {
          await this.upsertEventData(
            tx, 
            eventData.id!, 
            futureEdition.id, 
            'short_desc', 
            'TEXT', 
            future.short_desc, 
            eventData.changesMadeBy
          );
        }

        return {
          valid: true,
          message: isNew ? 'successfully added' : 'successfully updated',
          editionId: futureEdition.id
        };
      }, {
        maxWait: 5000,
        timeout: 10000,
      });

      if (!result.valid) {
        return createErrorResponse([result.message ?? 'Future edition processing failed']);
      }

      return createSuccessResponse(
        { id: eventData.id, edition: result.editionId },
        result.message ?? 'Future edition processed successfully'
      );

    } catch (error) {
      return createErrorResponse([error.message || 'Future edition processing failed']);
    }
  }
  

  private async validateFutureEditionData(eventData: EventUpsertRequestDto): Promise<{
    isValid: boolean;
    messages: string[];
    validatedData?: {
      future: FutureEventData;
      company: any;
      venue: any;
      city: any;
      originalEdition: any;
    };
  }> {
    const messages: string[] = [];
    let validatedData: any = {};

    try {
      // Parse future data
      const future: FutureEventData = JSON.parse(eventData.future!);
      validatedData.future = future;

      // Validate event exists
      const eventValidation = await this.validationService.validateEventExists(eventData.id!);
      if (!eventValidation.isValid) {
        messages.push(eventValidation.message ?? 'Event validation failed');
      }

      // Validate dates format
      const dateValidation = this.validationService.validateDates(
        future.startDate,
        future.endDate
      );
      if (!dateValidation.isValid) {
        messages.push(dateValidation.message ?? 'Unknown date validation error');
      }

      // Validate website format
      if (future.website && !this.validationService.validateWebsiteFormat(future.website)) {
        messages.push('website is not in correct format');
      }

      // Validate future dates are greater than current date
      const futureStart = new Date(future.startDate);
      const futureEnd = new Date(future.endDate);
      const now = new Date();

      if ((futureEnd <= now || futureStart <= now) && future.expiredControl !== 1) {
        messages.push('please mention the Dates greater than current');
      }

      if (futureEnd < futureStart) {
        messages.push('Start date should be greater than end date');
      }

      // Validate date conflicts with existing editions
      const conflictValidation = await this.validationService.validateDateConflicts(
        eventData.id!,
        future.startDate,
        future.endDate,
        future.editionId ? parseInt(future.editionId) : undefined
      );
      if (!conflictValidation.isValid) {
        messages.push(conflictValidation.message ?? 'Date conflict validation error');
      }

      // Validate company if provided
      let company = null;
      if (future.companyId) {
        const companyValidation = await this.validationService.validateCompany(
          parseInt(future.companyId)
        );
        if (!companyValidation.isValid) {
          messages.push('companyId does not exist');
        } else {
          company = companyValidation.company;
        }
      }
      validatedData.company = company;

      // Validate venue if provided
      let venue: { id: number; city: number; city_venue_cityTocity?: any } | null = null;
      if (future.venue) {
        const venueValidation = await this.validationService.validateVenue(
          parseInt(future.venue)
        );
        if (!venueValidation.isValid) {
          messages.push('venue does not exist');
        } else {
          venue = venueValidation.venue;
        }
      }
      validatedData.venue = venue;

      // Validate city if provided
      let city = null;
      if (future.city) {
        const cityValidation = await this.validationService.validateCity(
          parseInt(future.city)
        );
        if (!cityValidation.isValid) {
          messages.push('city does not exist');
        } else {
          city = cityValidation.city;
        }
      }

      // Validate city-venue relationship
      if (city && venue) {
        const cityObj = city as { id: number; [key: string]: any };
        const venueObj = venue as { city: number; [key: string]: any };
        
        if (cityObj.id !== venueObj.city) {
          messages.push('city does not match with venue');
        }
      }

      // Use venue's city if city not provided
      if (!city && venue && venue.city_venue_cityTocity) {
        city = venue.city_venue_cityTocity;
      }

      // Get original edition for location validation
      const originalEdition = await this.prisma.event_edition.findFirst({
        where: { event: eventData.id },
        orderBy: { created: 'asc' }
      });
      validatedData.originalEdition = originalEdition;

      // Validate location proximity if needed
      if (city && originalEdition?.city) {
        const originalCity = await this.prisma.city.findUnique({
          where: { id: originalEdition.city }
        });

        if (originalCity) {
          const locationValidation = await this.validateLocationProximity(
            originalCity,
            city
          );
          if (!locationValidation.valid) {
            messages.push(locationValidation.message || 'Location proximity validation failed');
          }
        }
      }

      // Set final city value
      validatedData.city = city || originalEdition?.city;

      return {
        isValid: messages.length === 0,
        messages,
        validatedData: messages.length === 0 ? validatedData : undefined,
      };

    } catch (parseError) {
      return {
        isValid: false,
        messages: ['Invalid future event format'],
      };
    }
  }

  private async validateLocationProximity(
    originalCity: any,
    newCity: any
  ): Promise<{ valid: boolean; message?: string }> {
    // Online events (city ID 1) 
    if (newCity.id === 1 && originalCity.id !== 1) {
      return { valid: true }; // Allow physical to online
    }
    
    if (newCity.id !== 1 && originalCity.id === 1) {
      return { valid: true }; // Allow online to physical
    }

    // Calculate distance between cities
    const R = 6371; // Earth's radius in km
    const radius = 50; // 50km radius allowed

    const lat1 = parseFloat(originalCity.geo_lat);
    const lon1 = parseFloat(originalCity.geo_long);
    const lat2 = parseFloat(newCity.geo_lat);
    const lon2 = parseFloat(newCity.geo_long);

    if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) {
      return { valid: false, message: 'latitude or longitude not valid' };
    }

    const maxLat = lat1 + (radius / R) * (180 / Math.PI);
    const minLat = lat1 - (radius / R) * (180 / Math.PI);
    const maxLon = lon1 + (radius / R) * (180 / Math.PI) / Math.cos(lat1 * Math.PI / 180);
    const minLon = lon1 - (radius / R) * (180 / Math.PI) / Math.cos(lat1 * Math.PI / 180);

    if (lat2 >= minLat && lat2 <= maxLat && lon2 >= minLon && lon2 <= maxLon) {
      return { valid: true };
    }

    if (newCity.id === originalCity.id) {
      return { valid: true }; // Same city is always allowed
    }

    return { 
      valid: false, 
      message: 'city is different from current edition city' 
    };
  }

  private async upsertEventData(
    tx: any,
    eventId: number,
    editionId: number,
    title: string,
    dataType: string,
    value: string,
    userId: number
  ) {
    const existing = await tx.event_data.findFirst({
      where: {
        event: eventId,
        event_edition: editionId,
        title: title
      }
    });

    if (existing) {
      await tx.event_data.update({
        where: { id: existing.id },
        data: {
          value: value,
          modifiedby: userId,
          modified: new Date()
        }
      });
    } else {
      await tx.event_data.create({
        data: {
          event: eventId,
          event_edition: editionId,
          title: title,
          data_type: dataType,
          value: value,
          createdby: userId,
        }
      });
    }
  }


    private async updateEvent(eventData: EventUpsertRequestDto): Promise<EventUpsertResponseDto> {
      try {
        // Step 1: Perform all validations upfront
        const validationResult = await this.validateEventUpdateData(eventData);
        if (!validationResult.isValid) {
          return createErrorResponse(validationResult.messages);
        }

        // Extract validated data
        const { existingEvent, company, location, eventTypeData, rehostAnalysis } = validationResult.validatedData!;

        // Step 2: Remove Description
        if (eventData.remove === 'description') {
          try {
            await this.prisma.event_data.deleteMany({
              where: {
                event: eventData.id!,
                event_edition: existingEvent.event_edition_event_event_editionToevent_edition?.id,
                title: 'desc'
              }
            });

            return createSuccessResponse(
              { 
                id: eventData.id!, 
                edition: existingEvent.event_edition_event_event_editionToevent_edition?.id 
              },
              'description removed successfully'
            );
          } catch (error) {
            return createErrorResponse(['Failed to remove description']);
          }
        }

        // Step 3: CORE TRANSACTION - Process update with validated data
        const oldCompanyId = existingEvent.event_edition_event_event_editionToevent_edition?.company_id;
        const newCompanyId = company?.id;
        
        const coreResult = await this.prisma.$transaction(async (tx) => {
          let currentEdition = existingEvent.event_edition_event_event_editionToevent_edition;
          let editionId = currentEdition?.id;
          let isNewEdition = false;

          // 1. Update main event record
          const eventUpdateData: any = {
            modified: new Date(),
            modifiedby: eventData.changesMadeBy,
          };

          if (eventData.name) eventUpdateData.name = eventData.name;
          if (eventData.abbrName || eventData.eventAbbrname) {
            eventUpdateData.abbr_name = eventData.abbrName || eventData.eventAbbrname;
          }
          if (eventData.punchline || eventData.eventPunchline) {
            eventUpdateData.punchline = eventData.punchline || eventData.eventPunchline;
          }
          if (eventData.website || eventData.eventWebsite) {
            eventUpdateData.website = eventData.website || eventData.eventWebsite;
          }
          if (eventData.frequency) eventUpdateData.frequency = eventData.frequency;
          if (eventData.published !== undefined) eventUpdateData.published = eventData.published === 1;
          if (eventData.status || eventData.eventStatus) {
            eventUpdateData.status = eventData.status || eventData.eventStatus;
          }
          if (eventData.functionality) eventUpdateData.functionality = eventData.functionality;
          if (eventData.multiCity !== undefined) eventUpdateData.multi_city = eventData.multiCity;
          if (eventData.brandId) eventUpdateData.brand_id = eventData.brandId;

          // Handle dates
          if (eventData.startDate) eventUpdateData.start_date = new Date(eventData.startDate);
          if (eventData.endDate) eventUpdateData.end_date = new Date(eventData.endDate);

          // Handle location updates
          if (location?.city) {
            eventUpdateData.city = location.city.id;
            eventUpdateData.country = location.country.id;
          }

          // Handle event type updates
          if (eventTypeData) {
            eventUpdateData.event_type = eventTypeData.eventType;
            eventUpdateData.sub_event_type = eventTypeData.subEventType;
            eventUpdateData.event_audience = eventTypeData.eventAudience?.toString();
          }

          const updatedEvent = await tx.event.update({
            where: { id: existingEvent.id },
            data: eventUpdateData
          });

          // 2. Handle rehost scenario or update existing edition
          if (rehostAnalysis.isRehost || rehostAnalysis.needsNewEdition) {
            const newEdition = await tx.event_edition.create({
              data: {
                event: existingEvent.id,
                city: location?.city?.id || currentEdition.city,
                venue: location?.venue?.id || (location?.removeVenue ? null : currentEdition.venue),
                edition_number: (currentEdition.edition_number || 0) + 1,
                start_date: eventData.startDate ? new Date(eventData.startDate) : currentEdition.start_date,
                end_date: eventData.endDate ? new Date(eventData.endDate) : currentEdition.end_date,
                company_id: company?.id || currentEdition.company_id,
                createdby: eventData.changesMadeBy,
                website: eventData.website || eventData.eventWebsite || currentEdition.website,
                eep_process: eventData.eepProcess || 2,
                facebook_id: eventData.facebookUrl || eventData.facebookId || currentEdition.facebook_id,
                linkedin_id: eventData.linkedinId || currentEdition.linkedin_id,
                twitter_id: eventData.twitterId || currentEdition.twitter_id,
                twitter_hashtag: eventData.twitterHashTags || currentEdition.twitter_hashtag,
                google_id: eventData.googleId || currentEdition.google_id,
              }
            });

            // Update event to point to new edition
            await tx.event.update({
              where: { id: existingEvent.id },
              data: { event_edition: newEdition.id }
            });

            editionId = newEdition.id;
            isNewEdition = true;
          } else {
            // Update existing edition
            const editionUpdateData: any = {
              modified: new Date(),
              modifiedby: eventData.changesMadeBy,
            };

            if (eventData.startDate) editionUpdateData.start_date = new Date(eventData.startDate);
            if (eventData.endDate) editionUpdateData.end_date = new Date(eventData.endDate);
            if (company) editionUpdateData.company_id = company.id;
            if (location?.city) editionUpdateData.city = location.city.id;
            if (location?.venue) editionUpdateData.venue = location.venue.id;
            if (location?.removeVenue) editionUpdateData.venue = null;
            if (eventData.editionNumber) editionUpdateData.edition_number = eventData.editionNumber;
            if (eventData.facebookUrl || eventData.facebookId) {
              editionUpdateData.facebook_id = eventData.facebookUrl || eventData.facebookId;
            }
            if (eventData.linkedinId) editionUpdateData.linkedin_id = eventData.linkedinId;
            if (eventData.twitterId) editionUpdateData.twitter_id = eventData.twitterId;
            if (eventData.twitterHashTags) editionUpdateData.twitter_hashtag = eventData.twitterHashTags;
            if (eventData.googleId) editionUpdateData.google_id = eventData.googleId;
            if (eventData.areaTotal) editionUpdateData.area_total = eventData.areaTotal;
            if (eventData.website || eventData.eventWebsite) {
              editionUpdateData.website = eventData.website || eventData.eventWebsite;
            }

            await tx.event_edition.update({
              where: { id: currentEdition.id },
              data: editionUpdateData
            });
          }

          // 3. Update basic event data 
          const basicEventDataUpdates: Array<{
            title: string;
            data_type: string;
            value: string | null;
          }> = [];
          
          if (eventData.desc || eventData.description) {
            basicEventDataUpdates.push({
              title: 'desc',
              data_type: 'TEXT',
              value: eventData.desc || eventData.description || '',
            });
          }
          if (eventData.short_desc) {
            basicEventDataUpdates.push({
              title: 'short_desc',
              data_type: 'TEXT',
              value: eventData.short_desc,
            });
          }
          if (eventData.stream_url !== undefined) {
            basicEventDataUpdates.push({
              title: 'event_stream_url',
              data_type: 'link',
              value: eventData.stream_url || null,
            });
          }

          // Process basic updates in transaction
          for (const update of basicEventDataUpdates) {
            const existing = await tx.event_data.findFirst({
              where: {
                event: existingEvent.id,
                event_edition: editionId,
                title: update.title
              }
            });

            if (existing) {
              await tx.event_data.update({
                where: { id: existing.id },
                data: {
                  value: update.value,
                  modifiedby: eventData.changesMadeBy,
                  modified: new Date(),
                }
              });
            } else {
              await tx.event_data.create({
                data: {
                  event: existingEvent.id,
                  event_edition: editionId,
                  data_type: update.data_type,
                  title: update.title,
                  value: update.value,
                  createdby: eventData.changesMadeBy,
                }
              });
            }
          }

          // 4. Handle URL creation
          if (eventData.url && eventData.functionality === 'open') {
            await tx.url.create({
              data: {
                id: eventData.url,
                createdby: eventData.changesMadeBy,
              }
            });
            
            await tx.event.update({
              where: { id: existingEvent.id },
              data: { url: eventData.url }
            });
          }

          return { 
            updatedEvent, 
            editionId, 
            isNewEdition,
            oldEditionId: currentEdition?.id 
          };
        }, {
          maxWait: 5000,
          timeout: 10000,
        });

        console.log('Core transaction completed successfully');

        // Handle Firebase session cloning if company changed
        if (oldCompanyId !== newCompanyId) {
          await this.handleFirebaseSessionCloning(
            existingEvent.id,
            oldCompanyId,
            newCompanyId
          );
        }

        // Step 4: POST-TRANSACTION OPERATIONS
        const { editionId, isNewEdition, oldEditionId } = coreResult;

        // Copy event data for rehost
        if (isNewEdition && oldEditionId) {
          await this.copyEventDataToNewEdition(
            existingEvent.id, 
            oldEditionId, 
            editionId, 
            eventData.changesMadeBy
          );

          await this.handleRehostElasticsearch(
            existingEvent.id,
            oldEditionId,
            editionId
          );
          console.log('Event data copied to new edition');
        }

        // Process stats
        if (eventData.stats || eventData.eventExhibitors !== undefined || 
            eventData.eventVisitors !== undefined || eventData.event_exhibitors !== undefined || 
            eventData.event_visitors !== undefined) {
          try {
            await this.commonService.processEventStats(
              existingEvent.id,
              editionId,
              eventData,
              eventData.changesMadeBy
            );
            console.log('Stats processing completed');
          } catch (error) {
            console.error('Stats processing failed:', error);
          }
        }

        // Process products and categories
        if (eventData.product || eventData.eventProducts) {
          try {
            const productData = eventData.product || eventData.eventProducts;
            if (productData) {
              const productResult = await this.commonService.processEventProducts(
                existingEvent.id,
                editionId,
                productData,
                eventData.changesMadeBy
              );
            
              // Handle categories from products
              if (eventData.category) {
                const allCategories = [...eventData.category, ...productResult.categoryIds];
                await this.commonService.processEventCategories(
                  existingEvent.id,
                  allCategories,
                  eventData.changesMadeBy
                );
              } else if (productResult.categoryIds.length > 0) {
                await this.commonService.saveProductCategories(
                  existingEvent.id,
                  productResult.categoryIds,
                  eventData.changesMadeBy
                );
              }
            }
            console.log('Product processing completed');
          } catch (error) {
            console.error('Product processing failed:', error);
          }
        }

        // Update event categories (if not handled by products)
        if (eventData.category && (!eventData.product && !eventData.eventProducts)) {
          try {
            await this.updateEventCategoriesStandalone(existingEvent.id, eventData.category, eventData.changesMadeBy);
            console.log('Categories updated');
          } catch (error) {
            console.error('Category update failed:', error);
          }
        }

        // Update event types
        if (eventTypeData) {
          try {
            await this.updateEventTypesStandalone(existingEvent.id, eventTypeData.eventTypeArray, eventData.changesMadeBy);
            console.log('Event types updated');
          } catch (error) {
            console.error('Event type update failed:', error);
          }
        }

        // Process complex event data
        if (eventData.timing || eventData.eventHighlights) {
          try {
            await this.updateComplexEventData(existingEvent.id, editionId, eventData);
            console.log('Complex event data updated');
          } catch (error) {
            console.error('Complex event data update failed:', error);
          }
        }

        // Process attachments (file operations)
        try {
          await this.processAttachments(existingEvent.id, editionId, eventData);
          console.log('Attachments processed');
        } catch (error) {
          console.error('Attachment processing failed:', error);
        }

        // Process contacts 
        if (eventData.contactAdd) {
          try {
            await this.commonService.addEventContacts(
              existingEvent.id,
              eventData.contactAdd,
              eventData.changesMadeBy
            );
            console.log('Contacts added');
          } catch (error) {
            console.error('Contact addition failed:', error);
          }
        }

        if (eventData.contactDelete) {
          try {
            await this.commonService.deleteEventContacts(
              existingEvent.id,
              eventData.contactDelete,
              eventData.changesMadeBy
            );
            console.log('Contacts deleted');
          } catch (error) {
            console.error('Contact deletion failed:', error);
          }
        }

        // Process sub-venues
        if (eventData.subVenue && (eventData.venue || eventData.venueId)) {
          try {
            const venueIdValue = eventData.venue || eventData.venueId;
            if (venueIdValue) {
              const venueId = typeof venueIdValue === 'string' ? parseInt(venueIdValue) : venueIdValue;
              
              const subVenueResult = await this.commonService.processSubVenues(
                existingEvent.id,
                editionId,
                eventData.subVenue,
                venueId,
                eventData.changesMadeBy
              );

              if (!subVenueResult.valid) {
                console.warn('Sub-venue processing failed:', subVenueResult.message);
              } else {
                console.log('Sub-venues processed');
              }
            }
          } catch (error) {
            console.error('Sub-venue processing failed:', error);
          }
        }

        // Create shareable URL if needed
        let shareableUrl: string | null = null;
        if (eventData.createUrl === 1 || eventData.fromDashboard === 1) {
          try {
            shareableUrl = await this.commonService.createShareableUrl(
              existingEvent.id,
              eventData.changesMadeBy
            );
            console.log('Shareable URL created');
          } catch (error) {
            console.error('Shareable URL creation failed:', error);
          }
        }

        // Step 5: CREATE REVIEW TRACKING
        let reviewResult: { preReviewId?: number; postReviewId?: number } = {};
        
        try {
          // Get existing data before update
          const existingData = await this.getExistingEventData(existingEvent.id, existingEvent.event_edition);
          
          // Create PreReview with EXISTING data
          const preReviewData = createEventReviewData(
            existingEvent.id,
            existingEvent.name,
            eventData.changesMadeBy,
            {
              description: existingData.currentDescription ?? undefined,
              startDate: existingEvent.start_date?.toISOString().split('T')[0],
              endDate: existingEvent.end_date?.toISOString().split('T')[0],
              functionality: existingEvent.functionality,
              website: existingEvent.website,
              eventAudience: existingEvent.event_audience,
              bypassQC: true,
            }
          );

          const preReviewId = await this.unifiedReviewService.createPreReview(preReviewData);
          reviewResult.preReviewId = preReviewId;

          // Create PostReview with NEW data
          const postReviewData = createEventReviewData(
            existingEvent.id,
            existingEvent.name,
            eventData.changesMadeBy,
            {
              description: eventData.desc || eventData.description,
              startDate: eventData.startDate,
              endDate: eventData.endDate,
              functionality: eventData.functionality,
              website: eventData.website || eventData.eventWebsite,
              eventAudience: eventData.eventAudience,
              bypassQC: true,
            }
          );

          const postReviewId = await this.unifiedReviewService.createPostReview({
            ...postReviewData,
            preReviewId: preReviewId,
            oldData: preReviewData.content,
            newData: postReviewData.content,
            apiPayload: eventData,
          });
          
          reviewResult.postReviewId = postReviewId;
          
          this.logger.log(`Created reviews - Pre: ${reviewResult.preReviewId}, Post: ${reviewResult.postReviewId}`);
        } catch (reviewError) {
          this.logger.error('Review creation failed:', reviewError);
        }

        console.log('All processing completed successfully');

        return createSuccessResponse(
          {
            id: existingEvent.id,
            edition: editionId,
            shareableUrl: shareableUrl,
            pre_review: reviewResult.preReviewId,
            post_review: reviewResult.postReviewId,
          },
          'updated'
        );

      } catch (error) {
        console.error('Event update failed:', error);
        return createErrorResponse([error.message || 'Event update failed']);
      }
    }

    private async validateEventUpdateData(eventData: EventUpsertRequestDto): Promise<{
      isValid: boolean;
      messages: string[];
      validatedData?: {
        existingEvent: any;
        company: any;
        location: any;
        eventTypeData: any;
        rehostAnalysis: any;
        contactValidation?: any;
      };
    }> {
      const messages: string[] = [];
      let validatedData: any = {};

      try {
        // Step 1: Validate user
        const userValidation = await this.validationService.validateUser(eventData.changesMadeBy);
        if (!userValidation.isValid) {
          messages.push(userValidation.message ?? 'User validation failed');
        }

        // Step 2: Validate event exists and ID
        if (typeof eventData.id !== 'number') {
          messages.push('Event id is required for update');
        } else {
          const eventValidation = await this.validationService.validateEventExists(eventData.id);
          if (!eventValidation.isValid) {
            messages.push(eventValidation.message ?? 'Event validation failed');
          } else {
            validatedData.existingEvent = eventValidation.event;
          }
        }

        // Early return if basic validations fail
        if (messages.length > 0) {
          return { isValid: false, messages };
        }

        const existingEvent = validatedData.existingEvent;

        // Step 3: Check user permissions
        if (eventData.fromDashboard === 1 && eventData.changesMadeBy !== existingEvent.createdby) {
          messages.push('Not authorized to change the event details');
        }

        // Step 4: Validate contact operations
        if (eventData.contactAdd) {
          try {
            const contacts = JSON.parse(eventData.contactAdd);
            const contactValidation = await this.commonService.validateContactEmails(
              contacts,
              eventData.restrictionLevel || 'vendor'
            );
            if (!contactValidation.valid) {
              messages.push(contactValidation.message!);
            } else {
              validatedData.contactValidation = contactValidation;
            }
          } catch (parseError) {
            messages.push('Invalid contact data format');
          }
        }

        // Step 5: Determine rehost scenario
        validatedData.rehostAnalysis = this.analyzeRehostScenario(eventData, existingEvent);

        // Step 6: Validate dates if provided
        if (eventData.startDate && eventData.endDate) {
          const dateValidation = this.validationService.validateDates(
            eventData.startDate,
            eventData.endDate,
            eventData.eventAudience || existingEvent.event_audience
          );
          if (!dateValidation.isValid) {
            messages.push(dateValidation.message ?? 'Date validation failed');
          }

          // Check for date conflicts
          const conflictValidation = await this.validationService.validateDateConflicts(
            eventData.id!,
            eventData.startDate,
            eventData.endDate,
            validatedData.rehostAnalysis.isRehost ? undefined : existingEvent.event_edition
          );
          if (!conflictValidation.isValid) {
            messages.push(conflictValidation.message ?? 'Date conflict validation failed');
          }
        }

        // Step 7: Validate website format if provided
        if (eventData.website || eventData.eventWebsite) {
          const website = eventData.website || eventData.eventWebsite;
          if (!this.validationService.validateWebsiteFormat(website ?? '')) {
            messages.push('website is not in correct format');
          }
        }

        // Step 8: Validate company if provided
        let company = null;
        if (eventData.company || eventData.companyId) {
          const companyId = eventData.company || eventData.companyId;
          const numericCompanyId = typeof companyId === 'string' ? parseInt(companyId) : companyId;
          if (numericCompanyId === undefined) {
            messages.push('Company ID is required');
          } else {
            const companyValidation = await this.validationService.validateCompany(numericCompanyId);
            if (!companyValidation.isValid) {
              messages.push(companyValidation.message ?? 'Company validation failed');
            } else {
              company = companyValidation.company;
            }
          }
        }
        validatedData.company = company;

        // Step 9: Validate location if provided
        let location: any = null;
        if (eventData.venue || eventData.venueId || eventData.city) {
          location = await this.validateUpdateLocation(eventData);
          if (!location || !location.isValid) {
            messages.push(location?.message ?? 'Location validation failed');
          }
        }
        validatedData.location = location;

        // Step 10: Process event type changes
        let eventTypeData: any = null;
        if (eventData.type || eventData.eventType || eventData.typeVal || eventData.type_val) {
          eventTypeData = await this.processEventTypeUpdate(eventData, existingEvent);
          if (!eventTypeData || !eventTypeData.isValid) {
            messages.push(eventTypeData?.message ?? 'Event type validation failed');
          }
        }
        validatedData.eventTypeData = eventTypeData;

        // Step 11: Validate categories if provided
        if (eventData.category) {
          const categoryValidation = await this.validationService.validateCategories(eventData.category);
          if (!categoryValidation.isValid) {
            messages.push(categoryValidation.message ?? 'Category validation failed');
          }
        }

        // Step 12: Validate URL if functionality is being changed to open
        if (eventData.functionality === 'open' || eventData.url) {
          const urlValidation = await this.validateUrlForFunctionality(eventData, existingEvent);
          if (!urlValidation.isValid) {
            messages.push(urlValidation.message ?? 'URL validation failed');
          }
        }

        return {
          isValid: messages.length === 0,
          messages,
          validatedData: messages.length === 0 ? validatedData : undefined,
        };

      } catch (error) {
        return {
          isValid: false,
          messages: [`Validation error: ${error.message}`],
        };
      }
    }
  
    private analyzeRehostScenario(eventData: EventUpsertRequestDto, existingEvent: any) {
      const now = new Date();
      const currentEdition = existingEvent.event_edition_event_event_editionToevent_edition;
      
      // Check if current edition has ended and new dates are provided
      const isRehost = currentEdition && 
                       currentEdition.end_date < now && 
                       eventData.startDate && 
                       eventData.endDate && 
                       new Date(eventData.startDate) > currentEdition.end_date;
  
      // Check if it's a date update on current edition
      const isDateUpdate = eventData.startDate && 
                           eventData.endDate && 
                           currentEdition &&
                           (currentEdition.start_date.toISOString().split('T')[0] === eventData.startDate &&
                            currentEdition.end_date.toISOString().split('T')[0] === eventData.endDate);
  
      return {
        isRehost,
        isDateUpdate,
        needsNewEdition: isRehost,
        currentEdition
      };
    }

    private async getExistingEventData(eventId: number, editionId: number) {
      const existingEvent = await this.prisma.event.findUnique({
        where: { id: eventId },
        include: {
          event_edition_event_event_editionToevent_edition: true,
        }
      });

      // Get current description from event_data
      const currentDesc = await this.prisma.event_data.findFirst({
        where: {
          event: eventId,
          event_edition: editionId,
          title: 'desc'
        }
      });

      return {
        ...existingEvent,
        currentDescription: currentDesc?.value || null,
      };
    }
  
    private async validateUpdateLocation(eventData: EventUpsertRequestDto) {
      if (eventData.venue === "0" || eventData.venueId === "0") {
        // Remove venue, keep city
        return { valid: true, removeVenue: true };
      }
  
      const venueId = eventData.venue || eventData.venueId;
      if (venueId && venueId !== "0") {
        const venueValidation = await this.validationService.validateVenue(
          typeof venueId === 'string' ? parseInt(venueId) : venueId
        );
        if (!venueValidation.isValid) {
          return venueValidation;
        }
        
        return {
          valid: true,
          venue: venueValidation.venue,
          city: venueValidation.venue.city_venue_cityTocity,
          country: venueValidation.venue.city_venue_cityTocity.country
        };
      }
  
      if (eventData.city) {
        const cityId = typeof eventData.city === 'string' ? parseInt(eventData.city) : eventData.city;
        const cityValidation = await this.validationService.validateCity(cityId);
        if (!cityValidation.isValid) {
          return cityValidation;
        }
        
        return {
          valid: true,
          city: cityValidation.city,
          country: cityValidation.city.country
        };
      }
  
      return { valid: true };
    }
  
    private async processEventTypeUpdate(eventData: EventUpsertRequestDto, existingEvent: any): Promise<{
      isValid: boolean;
      message?: string;
      eventType?: number;
      subEventType?: number | null;
      eventTypeArray?: number[];
      eventAudience?: string;
      }> {
        // Check if user is trying to change from/to business floor (not allowed)
        if (eventData.type) {
          const isCurrentlyBusinessFloor = existingEvent.event_type === 10;
          const isNewBusinessFloor = eventData.type === 'business floor';
          
          if ((isCurrentlyBusinessFloor && !isNewBusinessFloor) || 
              (!isCurrentlyBusinessFloor && isNewBusinessFloor)) {
            return { isValid: false, message: 'you can not change the event type' };
          }
        }
  
        // Process new event type
        let eventType: number | undefined;
        let subEventType: number | null = null;
        let eventTypeArray: number[] = [];
  
        if (eventData.type) {
          switch (eventData.type) {
            case 'tradeshow':
              eventType = 1;
              eventTypeArray.push(1);
              break;
            case 'conference':
              eventType = 2;
              eventTypeArray.push(2);
              break;
            case 'workshop':
              eventType = 3;
              eventTypeArray.push(3);
              break;
            case 'meetx':
              eventType = 3;
              subEventType = 1;
              eventTypeArray.push(4);
              break;
            case 'business floor':
              eventType = 10;
              eventTypeArray.push(10);
              break;
            default:
              return { isValid: false, message: 'Invalid event type' };
          }
        } else if (eventData.eventType) {
          eventType = typeof eventData.eventType === 'string' ? parseInt(eventData.eventType) : eventData.eventType;
          eventTypeArray.push(eventType);
        }
  
        // Add additional types from typeVal
        if (eventData.typeVal || eventData.type_val) {
          const typeString = eventData.typeVal || eventData.type_val;
          if (typeString) {
            const additionalTypes = typeString.split(',').map(t => parseInt(t.trim())).filter(t => !isNaN(t));
            eventTypeArray.push(...additionalTypes);
          }
        }
  
        eventTypeArray = [...new Set(eventTypeArray)];
  
        // Validate event types and get audience 
        const typeValidation = await this.validationService.validateEventType(eventTypeArray);
        if (!typeValidation.isValid) {
          return { isValid: false, message: typeValidation.message };
        }
  
        return {
          isValid: true,
          eventType,
          subEventType,
          eventTypeArray,
          eventAudience: typeValidation.eventAudience
        };
      }
  
    private async validateUrlForFunctionality(eventData: EventUpsertRequestDto, existingEvent: any): Promise<{
      isValid: boolean;
      message?: string;
    }> {
      if (eventData.functionality === 'open' && !eventData.url) {
        return { isValid: false, message: 'url is mandatory' };
      }
  
      if (eventData.url) {
        const currentUrl = existingEvent.url;
        if (currentUrl && 
            !currentUrl.startsWith('e1') && 
            eventData.url !== currentUrl && 
            !eventData.url.startsWith('e1') && 
            currentUrl !== `event/${existingEvent.id}`) {
          return { isValid: false, message: 'You can not change the url' };
        }
  
        // Check URL uniqueness
        const urlValidation = await this.validationService.validateUrlUniqueness(eventData.url, existingEvent.id);
        if (!urlValidation.isValid) {
          return { isValid: false, message: urlValidation.message };
        }
      }
  
      return { isValid: true };
    }
  
    private async removeEventDescription(eventId: number, editionId: number) {
      try {
        await this.prisma.event_data.deleteMany({
          where: {
            event: eventId,
            event_edition: editionId,
            title: 'desc'
          }
        });
  
        return createSuccessResponse(
          { id: eventId, edition: editionId },
          'description removed successfully'
        );
      } catch (error) {
        return createErrorResponse(['Failed to remove description']);
      }
    }
  
  // private async executeEventUpdate(params: {
  //     eventData: EventUpsertRequestDto;
  //     existingEvent: any;
  //     rehostAnalysis: any;
  //     company: any;
  //     location: any;
  //     eventTypeData: any;
  //   }) {
  //   const { eventData, existingEvent, rehostAnalysis, company, location, eventTypeData } = params;
  
  //   try {
  //     // PHASE 1: CORE TRANSACTION
  //     const oldCompanyId = existingEvent.event_edition_event_event_editionToevent_edition?.company_id;
  //     const newCompanyId = company?.id;
  //     const coreResult = await this.prisma.$transaction(async (tx) => {
  //       let currentEdition = existingEvent.event_edition_event_event_editionToevent_edition;
  //       let editionId = currentEdition?.id;
  //       let isNewEdition = false;
  
  //       // 1. Update main event record
  //       const eventUpdateData: any = {
  //         modified: new Date(),
  //         modifiedby: eventData.changesMadeBy,
  //       };
  
  //       if (eventData.name) eventUpdateData.name = eventData.name;
  //       if (eventData.abbrName || eventData.eventAbbrname) {
  //         eventUpdateData.abbr_name = eventData.abbrName || eventData.eventAbbrname;
  //       }
  //       if (eventData.punchline || eventData.eventPunchline) {
  //         eventUpdateData.punchline = eventData.punchline || eventData.eventPunchline;
  //       }
  //       if (eventData.website || eventData.eventWebsite) {
  //         eventUpdateData.website = eventData.website || eventData.eventWebsite;
  //       }
  //       if (eventData.frequency) eventUpdateData.frequency = eventData.frequency;
  //       if (eventData.published !== undefined) eventUpdateData.published = eventData.published === 1;
  //       if (eventData.status || eventData.eventStatus) {
  //         eventUpdateData.status = eventData.status || eventData.eventStatus;
  //       }
  //       if (eventData.functionality) eventUpdateData.functionality = eventData.functionality;
  //       if (eventData.multiCity !== undefined) eventUpdateData.multi_city = eventData.multiCity;
  //       if (eventData.brandId) eventUpdateData.brand_id = eventData.brandId;
  
  //       // Handle dates
  //       if (eventData.startDate) eventUpdateData.start_date = new Date(eventData.startDate);
  //       if (eventData.endDate) eventUpdateData.end_date = new Date(eventData.endDate);
  
  //       // Handle location updates
  //       if (location?.city) {
  //         eventUpdateData.city = location.city.id;
  //         eventUpdateData.country = location.country.id;
  //       }
  
  //       // Handle event type updates
  //       if (eventTypeData) {
  //         eventUpdateData.event_type = eventTypeData.eventType;
  //         eventUpdateData.sub_event_type = eventTypeData.subEventType;
  //         eventUpdateData.event_audience = eventTypeData.eventAudience?.toString();
  //       }
  
  //       const updatedEvent = await tx.event.update({
  //         where: { id: existingEvent.id },
  //         data: eventUpdateData
  //       });
  
  //       // 2. Handle rehost scenario or update existing edition
  //       if (rehostAnalysis.isRehost || rehostAnalysis.needsNewEdition) {
  //         const newEdition = await tx.event_edition.create({
  //           data: {
  //             event: existingEvent.id,
  //             city: location?.city?.id || currentEdition.city,
  //             venue: location?.venue?.id || (location?.removeVenue ? null : currentEdition.venue),
  //             edition_number: (currentEdition.edition_number || 0) + 1,
  //             start_date: eventData.startDate ? new Date(eventData.startDate) : currentEdition.start_date,
  //             end_date: eventData.endDate ? new Date(eventData.endDate) : currentEdition.end_date,
  //             company_id: company?.id || currentEdition.company_id,
  //             createdby: eventData.changesMadeBy,
  //             website: eventData.website || eventData.eventWebsite || currentEdition.website,
  //             eep_process: eventData.eepProcess || 2,
  //             facebook_id: eventData.facebookUrl || eventData.facebookId || currentEdition.facebook_id,
  //             linkedin_id: eventData.linkedinId || currentEdition.linkedin_id,
  //             twitter_id: eventData.twitterId || currentEdition.twitter_id,
  //             twitter_hashtag: eventData.twitterHashTags || currentEdition.twitter_hashtag,
  //             google_id: eventData.googleId || currentEdition.google_id,
  //           }
  //         });
  
  //         // Update event to point to new edition
  //         await tx.event.update({
  //           where: { id: existingEvent.id },
  //           data: { event_edition: newEdition.id }
  //         });
  
  //         editionId = newEdition.id;
  //         isNewEdition = true;
  //       } else {
  //         // Update existing edition
  //         const editionUpdateData: any = {
  //           modified: new Date(),
  //           modifiedby: eventData.changesMadeBy,
  //         };
  
  //         if (eventData.startDate) editionUpdateData.start_date = new Date(eventData.startDate);
  //         if (eventData.endDate) editionUpdateData.end_date = new Date(eventData.endDate);
  //         if (company) editionUpdateData.company_id = company.id;
  //         if (location?.city) editionUpdateData.city = location.city.id;
  //         if (location?.venue) editionUpdateData.venue = location.venue.id;
  //         if (location?.removeVenue) editionUpdateData.venue = null;
  //         if (eventData.editionNumber) editionUpdateData.edition_number = eventData.editionNumber;
  //         if (eventData.facebookUrl || eventData.facebookId) {
  //           editionUpdateData.facebook_id = eventData.facebookUrl || eventData.facebookId;
  //         }
  //         if (eventData.linkedinId) editionUpdateData.linkedin_id = eventData.linkedinId;
  //         if (eventData.twitterId) editionUpdateData.twitter_id = eventData.twitterId;
  //         if (eventData.twitterHashTags) editionUpdateData.twitter_hashtag = eventData.twitterHashTags;
  //         if (eventData.googleId) editionUpdateData.google_id = eventData.googleId;
  //         if (eventData.areaTotal) editionUpdateData.area_total = eventData.areaTotal;
  //         if (eventData.website || eventData.eventWebsite) {
  //           editionUpdateData.website = eventData.website || eventData.eventWebsite;
  //         }
  
  //         await tx.event_edition.update({
  //           where: { id: currentEdition.id },
  //           data: editionUpdateData
  //         });
  //       }
  
  //       // 3. Update basic event data 
  //       const basicEventDataUpdates: Array<{
  //         title: string;
  //         data_type: string;
  //         value: string | null;
  //       }> = [];
        
  //       if (eventData.desc || eventData.description) {
  //         basicEventDataUpdates.push({
  //           title: 'desc',
  //           data_type: 'TEXT',
  //           value: eventData.desc || eventData.description || '',
  //         });
  //       }
  //       if (eventData.short_desc) {
  //         basicEventDataUpdates.push({
  //           title: 'short_desc',
  //           data_type: 'TEXT',
  //           value: eventData.short_desc,
  //         });
  //       }
  //       if (eventData.stream_url !== undefined) {
  //         basicEventDataUpdates.push({
  //           title: 'event_stream_url',
  //           data_type: 'link',
  //           value: eventData.stream_url || null,
  //         });
  //       }
  
  //       // Process basic updates in transaction
  //       for (const update of basicEventDataUpdates) {
  //         const existing = await tx.event_data.findFirst({
  //           where: {
  //             event: existingEvent.id,
  //             event_edition: editionId,
  //             title: update.title
  //           }
  //         });
  
  //         if (existing) {
  //           await tx.event_data.update({
  //             where: { id: existing.id },
  //             data: {
  //               value: update.value,
  //               modifiedby: eventData.changesMadeBy,
  //               modified: new Date(),
  //             }
  //           });
  //         } else {
  //           await tx.event_data.create({
  //             data: {
  //               event: existingEvent.id,
  //               event_edition: editionId,
  //               data_type: update.data_type,
  //               title: update.title,
  //               value: update.value,
  //               createdby: eventData.changesMadeBy,
  //             }
  //           });
  //         }
  //       }
  
  //       // 4. Handle URL creation
  //       if (eventData.url && eventData.functionality === 'open') {
  //         await tx.url.create({
  //           data: {
  //             id: eventData.url,
  //             createdby: eventData.changesMadeBy,
  //           }
  //         });
          
  //         await tx.event.update({
  //           where: { id: existingEvent.id },
  //           data: { url: eventData.url }
  //         });
  //       }
  
  //       return { 
  //         updatedEvent, 
  //         editionId, 
  //         isNewEdition,
  //         oldEditionId: currentEdition?.id 
  //       };
  //     }, {
  //       maxWait: 5000,
  //       timeout: 10000,
  //     });
  
  //     console.log('Core transaction completed successfully');
  
  //     if (oldCompanyId !== newCompanyId) {
  //         await this.handleFirebaseSessionCloning(
  //           existingEvent.id,
  //           oldCompanyId,
  //           newCompanyId
  //         );
  //     }
  
  //     // PHASE 2: COPY EVENT DATA FOR REHOST
  //     if (coreResult.isNewEdition && coreResult.oldEditionId) {
  //       await this.copyEventDataToNewEdition(
  //         existingEvent.id, 
  //         coreResult.oldEditionId, 
  //         coreResult.editionId, 
  //         eventData.changesMadeBy
  //       );
  
  //       // Handle Elasticsearch update for rehost
  //       await this.handleRehostElasticsearch(
  //         existingEvent.id,
  //         coreResult.oldEditionId,
  //         coreResult.editionId
  //       );
  //       console.log('Event data copied to new edition');
  //     }
  
  //     // PHASE 3: COMPLEX OPERATIONS
  //     const { updatedEvent, editionId } = coreResult;
  
  //     // Process stats
  //     if (eventData.stats || eventData.eventExhibitors !== undefined || 
  //         eventData.eventVisitors !== undefined || eventData.event_exhibitors !== undefined || 
  //         eventData.event_visitors !== undefined) {
  //       try {
  //         await this.commonService.processEventStats(
  //           existingEvent.id,
  //           editionId,
  //           eventData,
  //           eventData.changesMadeBy
  //         );
  //         console.log('Stats processing completed');
  //       } catch (error) {
  //         console.error('Stats processing failed:', error);
  //       }
  //     }
  
  //     // Process products 
  //     if (eventData.product || eventData.eventProducts) {
  //       try {
  //         const productData = eventData.product || eventData.eventProducts;
  //         if (productData) {
  //           const productResult = await this.commonService.processEventProducts(
  //             existingEvent.id,
  //             editionId,
  //             productData,
  //             eventData.changesMadeBy
  //           );
          
  //         // Handle categories from products
  //         if (eventData.category) {
  //           const allCategories = [...eventData.category, ...productResult.categoryIds];
  //           await this.commonService.processEventCategories(
  //             existingEvent.id,
  //             allCategories,
  //             eventData.changesMadeBy
  //           );
  //         } else if (productResult.categoryIds.length > 0) {
  //           await this.commonService.saveProductCategories(
  //             existingEvent.id,
  //             productResult.categoryIds,
  //             eventData.changesMadeBy
  //           );
  //         }
  //         }
  //         console.log('Product processing completed');
  //       } catch (error) {
  //         console.error('Product processing failed:', error);
  //       }
  //     }
  
  //     // Update event categories (if not handled by products)
  //     if (eventData.category && (!eventData.product && !eventData.eventProducts)) {
  //       try {
  //         await this.updateEventCategoriesStandalone(existingEvent.id, eventData.category, eventData.changesMadeBy);
  //         console.log('Categories updated');
  //       } catch (error) {
  //         console.error('Category update failed:', error);
  //       }
  //     }
  
  //     // Update event types
  //     if (eventTypeData) {
  //       try {
  //         await this.updateEventTypesStandalone(existingEvent.id, eventTypeData.eventTypeArray, eventData.changesMadeBy);
  //         console.log('Event types updated');
  //       } catch (error) {
  //         console.error('Event type update failed:', error);
  //       }
  //     }
  
  //     // Process complex event data (timing, highlights, etc.)
  //     if (eventData.timing || eventData.eventHighlights) {
  //       try {
  //         await this.updateComplexEventData(existingEvent.id, editionId, eventData);
  //         console.log('Complex event data updated');
  //       } catch (error) {
  //         console.error('Complex event data update failed:', error);
  //       }
  //     }
  
  //     // Process attachments (file operations)
  //     try {
  //       await this.processAttachments(existingEvent.id, editionId, eventData);
  //       console.log('Attachments processed');
  //     } catch (error) {
  //       console.error('Attachment processing failed:', error);
  //     }
  
  //     // Process contacts 
  //     if (eventData.contactAdd) {
  //       try {
  //         await this.commonService.addEventContacts(
  //           existingEvent.id,
  //           eventData.contactAdd,
  //           eventData.changesMadeBy
  //         );
  //         console.log('Contacts added');
  //       } catch (error) {
  //         console.error('Contact addition failed:', error);
  //       }
  //     }
  
  //     if (eventData.contactDelete) {
  //       try {
  //         await this.commonService.deleteEventContacts(
  //           existingEvent.id,
  //           eventData.contactDelete,
  //           eventData.changesMadeBy
  //         );
  //         console.log('Contacts deleted');
  //       } catch (error) {
  //         console.error('Contact deletion failed:', error);
  //       }
  //     }
  
  //     // Process sub-venues (can create new venues)
  //     if (eventData.subVenue && (eventData.venue || eventData.venueId)) {
  //       try {
  //         const venueIdValue = eventData.venue || eventData.venueId;
  //         if (venueIdValue) {
  //           const venueId = typeof venueIdValue === 'string' ? parseInt(venueIdValue) : venueIdValue;
            
  //           const subVenueResult = await this.commonService.processSubVenues(
  //             existingEvent.id,
  //             editionId,
  //             eventData.subVenue,
  //             venueId,
  //             eventData.changesMadeBy
  //           );
  
  //           if (!subVenueResult.valid) {
  //             console.warn('Sub-venue processing failed:', subVenueResult.message);
  //           } else {
  //             console.log('Sub-venues processed');
  //           }
  //         }
  //       } catch (error) {
  //         console.error('Sub-venue processing failed:', error);
  //       }
  //     }
  
  //     let shareableUrl: string | null = null;
  //     if (eventData.createUrl === 1 || eventData.fromDashboard === 1) {
  //       try {
  //         shareableUrl = await this.commonService.createShareableUrl(
  //           existingEvent.id,
  //           eventData.changesMadeBy
  //         );
  //         console.log('Shareable URL created');
  //       } catch (error) {
  //         console.error('Shareable URL creation failed:', error);
  //       }
  //     }
  
  //     // Create review tracking
  //     let reviewResult: { preReviewId?: number; postReviewId?: number } = {};
      
  //     try {
  //       // STEP 1: Get existing data before update
  //       const existingData = await this.getExistingEventData(existingEvent.id, existingEvent.event_edition);
        
  //       // STEP 2: Create PreReview with EXISTING data
  //       const preReviewData = createEventReviewData(
  //         existingEvent.id,
  //         existingEvent.name,
  //         eventData.changesMadeBy,
  //         {
  //           description: existingData.currentDescription ?? undefined,
  //           startDate: existingEvent.start_date?.toISOString().split('T')[0],
  //           endDate: existingEvent.end_date?.toISOString().split('T')[0],
  //           functionality: existingEvent.functionality,
  //           website: existingEvent.website,
  //           eventAudience: existingEvent.event_audience,
  //           bypassQC: true,
  //         }
  //       );

  //       const preReviewId = await this.unifiedReviewService.createPreReview(preReviewData);
  //       reviewResult.preReviewId = preReviewId;

  //       // STEP 3: Create PostReview with NEW data
  //       const postReviewData = createEventReviewData(
  //         existingEvent.id,
  //         existingEvent.name,
  //         eventData.changesMadeBy,
  //         {
  //           description: eventData.desc || eventData.description,
  //           startDate: eventData.startDate,
  //           endDate: eventData.endDate,
  //           functionality: eventData.functionality,
  //           website: eventData.website || eventData.eventWebsite,
  //           eventAudience: eventData.eventAudience,
  //           bypassQC: true,
  //         }
  //       );

  //       const postReviewId = await this.unifiedReviewService.createPostReview({
  //         ...postReviewData,
  //         preReviewId: preReviewId,
  //         oldData: preReviewData.content,
  //         newData: postReviewData.content,
  //         apiPayload: eventData, // Full API payload
  //       });
        
  //       reviewResult.postReviewId = postReviewId;
        
  //       this.logger.log(`Created reviews - Pre: ${reviewResult.preReviewId}, Post: ${reviewResult.postReviewId}`);
  //     } catch (reviewError) {
  //       this.logger.error('Review creation failed:', reviewError);
  //     }
  
  //     console.log('All processing completed successfully');
  
  //     return createSuccessResponse(
  //       {
  //         id: existingEvent.id,
  //         edition: editionId,
  //         shareableUrl: shareableUrl,
  //         pre_review: reviewResult.preReviewId,
  //         post_review: reviewResult.postReviewId,
  //       },
  //       'updated'
  //     );
  
  //   } catch (error) {
  //     console.error('Event update failed:', error);
  //     return createErrorResponse([error.message || 'Event update failed']);
  //   }
  // }
  
  private async copyEventDataToNewEdition(
    eventId: number, 
    oldEditionId: number, 
    newEditionId: number, 
    userId: number
  ) {
    try {
      const existingEventData = await this.prisma.event_data.findMany({
        where: {
          event: eventId,
          event_edition: oldEditionId,
          title: { not: 'event_media' }
        }
      });
  
      if (existingEventData.length > 0) {
        const newEventData = existingEventData.map(data => ({
          event: eventId,
          event_edition: newEditionId,
          data_type: data.data_type,
          title: data.title,
          value: data.value,
          published: data.published,
          createdby: userId,
        }));
  
        await this.prisma.event_data.createMany({
          data: newEventData
        });
      }
    } catch (error) {
      console.error('Failed to copy event data:', error);
      throw error;
    }
  }
  
  private async updateEventCategoriesStandalone(eventId: number, categoryIds: number[], userId: number) {
    await this.prisma.event_category.deleteMany({
      where: { event: eventId }
    });
  
    if (categoryIds.length > 0) {
      const categoryData = categoryIds.map(categoryId => ({
        category: categoryId,
        event: eventId,
        createdby: userId,
      }));
  
      await this.prisma.event_category.createMany({
        data: categoryData
      });
    }
  }
  
  private async updateEventTypesStandalone(eventId: number, eventTypeIds: number[], userId: number) {
    await this.prisma.event_type_event.updateMany({
      where: { event_id: eventId },
      data: { 
        published: 0,
        modified_by: userId 
      }
    });
  
    // Add/update event types
    for (const typeId of eventTypeIds) {
      const existing = await this.prisma.event_type_event.findFirst({
        where: {
          eventtype_id: typeId,
          event_id: eventId
        }
      });
  
      if (existing) {
        await this.prisma.event_type_event.update({
          where: { id: existing.id },
          data: { 
            published: 1,
            modified_by: userId 
          }
        });
      } else {
        await this.prisma.event_type_event.create({
          data: {
            eventtype_id: typeId,
            event_id: eventId,
            created_by: userId,
            published: 1,
          }
        });
      }
    }
  }
  
  private async updateComplexEventData(eventId: number, editionId: number, eventData: EventUpsertRequestDto) {
    const updates: Array<{
      title: string;
      data_type: string;
      value: string;
    }> = [];
  
    if (eventData.timing) {
      updates.push({
        title: 'timing',
        data_type: 'JSON',
        value: typeof eventData.timing === 'string' ? eventData.timing : JSON.stringify(eventData.timing),
      });
    }
  
    if (eventData.eventHighlights) {
      updates.push({
        title: 'event_highlights',
        data_type: 'JSON',
        value: eventData.eventHighlights,
      });
    }
  
    for (const update of updates) {
      const existing = await this.prisma.event_data.findFirst({
        where: {
          event: eventId,
          event_edition: editionId,
          title: update.title
        }
      });
  
      if (existing) {
        await this.prisma.event_data.update({
          where: { id: existing.id },
          data: {
            value: update.value,
            modifiedby: eventData.changesMadeBy,
            modified: new Date(),
          }
        });
      } else {
        await this.prisma.event_data.create({
          data: {
            event: eventId,
            event_edition: editionId,
            data_type: update.data_type,
            title: update.title,
            value: update.value,
            createdby: eventData.changesMadeBy,
          }
        });
      }
    }
  }
  
    private async processAttachments(eventId: number, editionId: number, eventData: EventUpsertRequestDto) {
      // Process intro video
      if (eventData.introvideo) {
        await this.commonService.processIntroVideo(
          eventId,
          editionId,
          eventData.introvideo,
          eventData.changesMadeBy
        );
      }
  
      // Process event documents
      if (eventData.eventDocs) {
        await this.commonService.processEventDocuments(
          eventId,
          editionId,
          eventData.eventDocs,
          eventData.changesMadeBy
        );
      }
  
      // Delete event documents
      if (eventData.deleteEventDocs) {
        await this.commonService.deleteEventDocuments(
          eventId,
          editionId,
          eventData.deleteEventDocs
        );
      }
  
      // Process brochure
      if (eventData.brochure) {
        await this.commonService.processAttachment(
          eventId,
          editionId,
          eventData.brochure,
          'brochure',
          eventData.changesMadeBy
        );
      }
  
      // Process OG image
      if (eventData.og_image) {
        await this.commonService.processAttachment(
          eventId,
          editionId,
          eventData.og_image,
          'event_og_image',
          eventData.changesMadeBy
        );
      }
  
      // Process customization
      if (eventData.customization) {
        await this.commonService.processCustomization(
          eventId,
          editionId,
          eventData.customization,
          eventData.changesMadeBy
        );
      }
    }
  
  
    private async postProcessEvent(
      eventId: number, 
      editionId: number | undefined, 
      eventData: EventUpsertRequestDto,
      isUpdate: boolean
    ): Promise<void> {
      try {
        const currentEditionId = editionId || await this.getCurrentEditionId(eventId);
        
        this.sendRabbitMQMessages(eventId, currentEditionId, eventData, isUpdate);
        
        this.indexToElasticsearch(eventId, isUpdate);
        
      } catch (error) {
        console.error('Post-processing failed:', error);
      }
    }
  
    private async getCurrentEditionId(eventId: number): Promise<number> {
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        select: { event_edition: true }
      });
      
      return event?.event_edition || 0;
    }
  
    private async sendRabbitMQMessages(
      eventId: number, 
      editionId: number, 
      eventData: EventUpsertRequestDto,
      isUpdate: boolean
    ): Promise<void> {
      try {
        const baseMessage = {
          event: eventId,
          edition: editionId,
          endPoint: this.getEndPoint(),
          file: isUpdate ? 'event-service.ts : updateEvent' : 'event-service.ts : createEvent',
        };
  
        // Send strength queue message 
        await this.rabbitmqService.sendStrengthMessage(baseMessage);
  
        // Send visitor ES message
        if (this.shouldSendVisitorEsMessage(eventData)) {
          await this.rabbitmqService.sendVisitorEsMessage({
            ...baseMessage,
            action: 'visitor_update',
          });
        }
  
        // Send priority message
        if (this.shouldSendPriorityMessage(eventData)) {
          await this.rabbitmqService.sendMessage(
            'visitors_priority_exchange',
            'visitors_priority_queue',
            {
              ...baseMessage,
              action: 'priority_update',
              payload: JSON.stringify({ event: eventId }),
            }
          );
        }
  
        console.log('RabbitMQ messages sent successfully');
      } catch (error) {
        console.error('Failed to send RabbitMQ messages:', error);
      }
    }
  
    private async indexToElasticsearch(eventId: number, isUpdate: boolean = false): Promise<void> {
      try {
        const operation = isUpdate ? 'Updating' : 'Indexing';
        this.logger.log(`${operation} event ${eventId} in Elasticsearch`);
  
        // Small delay to ensure data is committed after transaction
        await new Promise(resolve => setTimeout(resolve, 200));
  
        // Transform event data for Elasticsearch  
        const esDocument = await this.commonService.transformEventForES(eventId);
        
        // Index to Elasticsearch
        const result = await this.elasticsearchService.indexEvent(esDocument);
        
        if (result.success) {
          this.logger.log(`Event ${eventId} ${isUpdate ? 'updated' : 'indexed'} successfully in Elasticsearch`);
          
          if (result.failedTargets.length > 0) {
            this.logger.warn(`Some targets failed for event ${eventId}: ${result.failedTargets.join(', ')}`);
          }
        } else {
          this.logger.error(`Failed to ${isUpdate ? 'update' : 'index'} event ${eventId} in Elasticsearch`);
          this.logger.error(`Errors: ${result.errors.join(', ')}`);
        }
        
      } catch (error) {
        this.logger.error(`Failed to ${isUpdate ? 'update' : 'index'} event ${eventId} in Elasticsearch:`, error.message);
      }
    }
  
    private async handleRehostElasticsearch(
      eventId: number, 
      oldEditionId: number, 
      newEditionId: number
    ): Promise<void> {
      try {
        this.logger.log(`Handling rehost Elasticsearch update for event ${eventId}: ${oldEditionId} -> ${newEditionId}`);
        
        // Re-index the event with new edition data
        await this.indexToElasticsearch(eventId, true);
        
      } catch (error) {
        this.logger.error(`Failed to handle rehost Elasticsearch update for event ${eventId}:`, error.message);
      }
    }
  
    private shouldSendVisitorEsMessage(eventData: EventUpsertRequestDto): boolean {
      return !!(
        eventData.city || 
        eventData.venue || 
        eventData.status || 
        eventData.functionality ||
        eventData.published !== undefined ||
        eventData.online_event !== undefined
      );
    }
  
    private shouldSendPriorityMessage(eventData: EventUpsertRequestDto): boolean {
      return !!(
        eventData.startDate || 
        eventData.endDate || 
        eventData.eventType || 
        eventData.type ||
        eventData.functionality === 'open'
      );
    }
  
    private getEndPoint(): string {
      try {
        // Try to get from request context if available
        const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
        const host = process.env.HOST || 'localhost:3000';
        return `${protocol}://${host}/v1/event/upsert`;
      } catch {
        return 'http://localhost:3000/v1/event/upsert';
      }
    }
  
    private async handleFirebaseSessionCloning(
      eventId: number,
      oldCompanyId: number | null,
      newCompanyId: number | null
    ): Promise<void> {
      try {
        if (oldCompanyId && newCompanyId && oldCompanyId !== newCompanyId) {
          this.logger.log(
            `Company changed for event ${eventId}: ${oldCompanyId} → ${newCompanyId}. Starting Firebase session cloning...`
          );
  
          if (!this.firebaseSessionService.isConfigured()) {
            this.logger.warn('Firebase not configured, skipping session cloning');
            return;
          }
  
          const cloneResult = await this.firebaseSessionService.cloneEventSession(
            eventId,
            oldCompanyId,
            newCompanyId
          );
  
          if (cloneResult.success) {
            this.logger.log(`Firebase session cloned successfully for event ${eventId}`);
            if (cloneResult.result) {
              this.logger.debug(`Firebase response: ${cloneResult.result}`);
            }
          } else {
            this.logger.warn(
              `Firebase session cloning failed for event ${eventId}: ${cloneResult.error}`
            );
          }
        } else {
          this.logger.debug(`No Firebase cloning needed for event ${eventId} (company unchanged or invalid)`);
        }
      } catch (error) {
        this.logger.error(
          `Error handling Firebase session cloning for event ${eventId}:`,
          error.message
        );
      }
    }

  async createEvent(createEventDto: CreateEventRequestDto, req?: any): Promise<CreateEventResponseDto> {

    const validationResult = await this.performAllValidations(createEventDto);
  
    if (!validationResult.isValid) {
      return createErrorResponse(validationResult.messages, validationResult.errors) as CreateEventResponseDto;
    }

    // Extract validated data
    const {
      dateProcessing,
      eventTypeValidation,
      dateValidation,
      locationData
    } = validationResult.validatedData!;

    // Step 6: Core database transaction
    let eventData: any;
    let editionData: any;

    try {
      const result = await this.prisma.$transaction(async (prisma) => {
        // Create Event Entity
        const event = await this.createEventEntity(
          createEventDto,
          dateProcessing,
          eventTypeValidation,
          locationData,
          prisma
        );

        this.logger.log(`Created event: ${event.name} (ID: ${event.id})`);

        // Create Edition
        const edition = await this.editionService.createEdition({
          ...createEventDto,
          event: event.id,
          startDate: dateProcessing.processedStartDate,
          endDate: dateProcessing.processedEndDate,
          customFlag: dateProcessing.customFlag,
          edition: undefined
        }, prisma);

        if (!edition.isValid) {
          throw new Error(`Edition creation failed: ${edition.message}`);
        }

        if (edition.editionId === undefined || edition.editionId === null) {
          throw new Error(`Edition creation failed: editionId is ${edition.editionId}`);
        }

        const validatedEditionId = edition.editionId;

        // Update Event with Edition Reference
        await this.updateEventWithEdition(event.id, validatedEditionId, createEventDto, prisma);

        // Create Category Associations
        if (createEventDto.category) {
          await this.createCategoryAssociations(
            event.id,
            createEventDto.category,
            createEventDto.changesMadeBy,
            prisma
          );
        }

        // Create Event Data entries
        await this.createEventDataEntries(
          event.id,
          validatedEditionId,
          createEventDto,
          prisma
        );

        // Create Contact Entry
        await this.createContactEntry(event.id, createEventDto.changesMadeBy, prisma);

        await this.createUserEventMapping(event.id, createEventDto, prisma);

        await this.createEventSettings(event.id, createEventDto, prisma);

        // Create Default Questionnaire
        await this.createDefaultQuestionnaire(event.id, prisma);

        // Handle Event Type Mappings
        await this.createEventTypeAssociations(
          event.id,
          createEventDto.type,
          createEventDto.type_val,
          createEventDto.changesMadeBy,
          prisma
        );

        return {
          event,
          editionId: validatedEditionId,
        };
      }, {
        maxWait: 10000, 
        timeout: 15000,
      });

      eventData = result.event;
      editionData = { editionId: result.editionId };

    } catch (error) {
      this.logger.error('Core transaction failed', {
        error: error.message,
        stack: error.stack,
        input: createEventDto,
      });
      
      await this.sendErrorNotification(error, createEventDto);
      throw new Error('Cannot add event due to technical difficulties. Try again later.');
    }

    // Step 7: Post-transaction operations 
    let preReviewId: number | null = null;
    let postReviewId: number | null = null;

    try {
      // Create Reviews 
      const reviewData = createEventReviewData(
        eventData.id,
        eventData.name,
        createEventDto.changesMadeBy,
        {
          description: createEventDto.description,
          startDate: dateProcessing.processedStartDate,
          endDate: dateProcessing.processedEndDate,
          functionality: eventData.functionality,
          website: eventData.website,
          eventAudience: eventData.event_audience,
          bypassQC: true, // Auto-approve for creation
        }
      );

      const reviews = await this.unifiedReviewService.createReviewWorkflow(reviewData);
      preReviewId = reviews.preReviewId ?? null;
      postReviewId = reviews.postReviewId ?? null;

      // Async operations
      setImmediate(() => {
        this.performAsyncOperations(eventData.id, editionData.editionId, eventData.functionality, req);
      });

      this.logger.log(`Successfully created event ${eventData.id} with edition ${editionData.editionId}`);

     return createSuccessResponse({
      id: eventData.id,
      edition: editionData.editionId,
      pre_review: preReviewId,
      post_review: postReviewId,
    }, 'inserted') as CreateEventResponseDto;

    } catch (postError) {
      this.logger.warn('Post-transaction operations failed', {
        error: postError.message,
        eventId: eventData.id,
      });

      // Still return success since core event was created
      return createSuccessResponse({
        id: eventData.id,
        edition: editionData.editionId,
        pre_review: preReviewId,
        post_review: postReviewId,
      }, 'inserted') as CreateEventResponseDto;
    }
  }

  private async performAsyncOperations(eventId: number, editionId: number, functionality: string, req: any): Promise<void> {
    try {
      // Event replica creation
      await this.commonService.createEventReplica(eventId);
      
      // Update event_update table
      await this.commonService.updateEventUpdate(
        eventId,
        editionId,
        functionality || 'open',
        'active'
      );

      // Elasticsearch indexing
      await this.indexEventToElasticsearch(eventId);

      // RabbitMQ notification
      await this.sendRabbitmqNotification(
        eventId,
        editionId,
        'EventService.createEvent:performAsyncOperations',
        req
      );

      // External integrations
      await this.handleExternalIntegrations(eventId, editionId);

      this.logger.log(`Completed async operations for event ${eventId}`);
    } catch (error) {
      this.logger.error(`Async operations failed for event ${eventId}:`, error.message);
    }
  }


  private async performAllValidations(dto: CreateEventRequestDto): Promise<{
    isValid: boolean;
    messages: string[];
    errors: string[];
    validatedData?: {
      dateProcessing: any;
      eventTypeValidation: any;
      dateValidation: any;
      locationData: any;
    };
  }> {
    const messages: string[] = [];
    const errors: string[] = [];
    let validatedData: any = {};

    try {
      // Step 1: Basic validations
      const userValidation = await this.validationService.validateUser(dto.changesMadeBy);
      if (!userValidation.isValid) {
        messages.push(userValidation.message ?? 'Unknown user validation error');
      }

      if (dto.mainEvent) {
        const mainEventValidation = await this.validationService.validateMainEvent(dto.mainEvent);
        if (!mainEventValidation.isValid) {
          messages.push(mainEventValidation.message ?? 'Unknown main event validation error');
        }
      }

      if (dto.category) {
        const categoryValidation = await this.validationService.validateCategories(dto.category);
        if (!categoryValidation.isValid) {
          messages.push(categoryValidation.message ?? 'Unknown category validation error');
        }
      }

      // Step 2: Process and validate dates
      const dateProcessing = this.validationService.processDates(
        dto.startDate,
        dto.endDate
      );
      validatedData.dateProcessing = dateProcessing;

      // Step 3: Validate event type
      const eventTypeValidation = await this.validationService.validateEventType(
        this.mapEventTypeToArray(dto.type, dto.type_val)
      );

      if (!eventTypeValidation.isValid) {
        messages.push(eventTypeValidation.message ?? 'Unknown event type validation error');
      } else {
        validatedData.eventTypeValidation = eventTypeValidation;
      }

      // Step 4: Date logic validation 
      if (eventTypeValidation.isValid) {
        const dateValidation = this.validationService.validateDateLogic(
          dateProcessing.processedStartDate,
          dateProcessing.processedEndDate,
          (eventTypeValidation.eventAudience ?? '').toString()
        );

        if (!dateValidation.isValid) {
          messages.push(dateValidation.message ?? 'Unknown date validation error');
        } else {
          validatedData.dateValidation = dateValidation;
        }
      }

      // Step 5: Location validation
      const locationData = await this.resolveLocation(dto);
      if (!locationData.isValid) {
        messages.push(locationData.message ?? 'Unknown location error');
      } else {
        validatedData.locationData = locationData;
      }

      return {
        isValid: messages.length === 0,
        messages,
        errors,
        validatedData: messages.length === 0 ? validatedData : undefined,
      };

    } catch (error) {
      errors.push(`Validation failed: ${error.message}`);
      return {
        isValid: false,
        messages,
        errors,
      };
    }
  }

  private mapEventTypeToArray(type: string, typeVal?: string): number[] {
    let eventTypes: number[] = [];
    
    if (typeVal) {
      eventTypes = typeVal.split(',').map(Number).filter(Boolean);
    }

    const typeMapping = {
      'tradeshow': 1,
      'conference': 2,
      'workshop': 3,
      'meetx': 4,
      'business floor': 10,
    };

    const mappedType = typeMapping[type];
    if (mappedType) {
      eventTypes.push(mappedType);
    }

    return [...new Set(eventTypes)]; 
  }

  private async resolveLocation(dto: CreateEventRequestDto) {
    try {
      let cityId: number | null = null;
      let countryId: string | null = null;
      let venueId: number | null = null;

      if (dto.venue) {
        if (typeof dto.venue === 'string') {
          return {
            isValid: false,
            message: 'Google Place ID resolution not implemented yet - use numeric venue ID',
          };
        } else {
          const venue = await this.prisma.venue.findUnique({
            where: { id: dto.venue },
            select: {
              id: true,
              name: true,
              city: true,
              country: true,
            },
          });

          if (!venue) {
            return {
              isValid: false,
              message: `Invalid venue ID: ${dto.venue}`,
            };
          }

          venueId = venue.id;
          cityId = venue.city;
          countryId = venue.country;
        }
      } else if (dto.city) {
        if (typeof dto.city === 'string') {
          return {
            isValid: false,
            message: 'Google Place ID resolution not implemented yet - use numeric city ID',
          };
        } else {
          const city = await this.prisma.city.findUnique({
            where: { id: dto.city },
            select: {
              id: true,
              name: true,
              country: true,  
            },
          });

          if (!city) {
            return {
              isValid: false,
              message: `Invalid city ID: ${dto.city}`,
            };
          }

          cityId = city.id;
          countryId = city.country;
        }
      } else if (dto.country) {
        return {
          isValid: false,
          message: 'City is required - cannot create event with only country',
        };
      } else {
        return {
          isValid: false,
          message: 'Either venue or city must be provided',
        };
      }

      if (!cityId) {
        return {
          isValid: false,
          message: 'Could not resolve city ID',
        };
      }

      if (!countryId) {
        return {
          isValid: false,
          message: 'Could not resolve country ID',
        };
      }

      const countryExists = await this.prisma.country.findUnique({
        where: { id: countryId },
        select: { id: true, name: true },
      });

      if (!countryExists) {
        return {
          isValid: false,
          message: `Country with ID '${countryId}' does not exist`,
        };
      }

      return {
        isValid: true,
        venueId,
        cityId,
        countryId,
      };
    } catch (error) {
      return {
        isValid: false,
        message: `Database error during location resolution: ${error.message}`,
      };
    }
  }

  private async createEventEntity(
    dto: CreateEventRequestDto,
    dateProcessing: any,
    eventTypeValidation: any,
    locationData: any,
    prisma: any
  ) {
    const typeMapping = {
      'tradeshow': { eventType: 1, subEventType: null },
      'conference': { eventType: 2, subEventType: null },
      'workshop': { eventType: 3, subEventType: null },
      'meetx': { eventType: 3, subEventType: 1 },
      'business floor': { eventType: 10, subEventType: null },
    };

    const { eventType, subEventType } = typeMapping[dto.type];

    let functionality = 'open';
    if (dto.public === 'yes') functionality = 'draft';
    if (dto.public === 'no') functionality = 'private';
    if (dto.functionality === 'open' && (dto.from === 'manage' || eventType === 10)) {
      functionality = 'open';
    } else if (dto.functionality === 'draft' && dto.fromDashboard === 1) {
      functionality = 'draft';
    }

    if (!locationData.cityId || !locationData.countryId) {
      throw new Error(`Both city and country are required. Got city: ${locationData.cityId}, country: ${locationData.countryId}`);
    }

    const eventData = await prisma.event.create({
      data: {
        name: dto.name,                                    
        city: locationData.cityId,                         
        country: locationData.countryId,
        event_type: eventType,
        mail_type: 1, 
        published: dto.publish === 2 ? false : true,
        adsense: false,
        created: new Date(),
        abbr_name: dto.abbrName || null,
        zh_name: null,
        native_name: null,
        event_edition: null,
        start_date: new Date(dateProcessing.processedStartDate),
        end_date: new Date(dateProcessing.processedEndDate),
        website: dto.website || null,
        frequency: null,
        url: null,
        redirect_url: null,
        membership: 0,
        app_id: null,
        verified: null,
        verifiedby: null,
        status: null,
        modified: new Date(),
        createdby: dto.changesMadeBy,
        modifiedby: null,
        wrapper: null,
        logo: null,
        wrapper_small: null,
        host: null,
        hotel_id: null,
        punchline: null,
        validation: 0,
        onboard_date: null,
        concurrent: 0,
        duplicate: null,
        badge_initial_id: null,
        tags: null,
        score: 0,
        hotel_id2: null,
        ios_url: null,
        android_url: null,
        brand_id: null,
        zh_published: false,
        functionality: functionality,
        multi_city: 0,
        remark: null,
        group_id: null,
        sub_event_type: subEventType,
        online_event: dto.online_event || null,
        event_audience: eventTypeValidation.eventAudience?.toString() || null,
      },
    });

    return eventData;
  }

  private async updateEventWithEdition(
    eventId: number,
    editionId: number,
    dto: CreateEventRequestDto,
    prisma: any
  ) {
    let eventUrl = `event/${eventId}`;
    
    if (dto.functionality === 'open' && dto.from === 'manage') {
      eventUrl = `event/${eventId}`;
    }

    await prisma.event.update({
      where: { id: eventId },
      data: {
        event_edition: editionId,
        url: eventUrl,
      },
    });
  }

  private async createCategoryAssociations(
    eventId: number,
    categories: number[],
    userId: number,
    prisma: any
  ) {
    try {
      await prisma.event_category.deleteMany({
        where: { event: eventId },
      });

      for (const categoryId of categories) {
        await prisma.event_category.upsert({
          where: {
            event_category: {
              event: eventId,
              category: categoryId,
            },
          },
          update: {
            modified: new Date(),
            modifiedby: userId,  
          },
          create: {
            event: eventId,
            category: categoryId,
            created: new Date(),
            createdby: userId,
          },
        });
      }
    } catch (error) {
      this.logger.error('Category association error:', error);
    }
  }

  private async createEventDataEntries(
    eventId: number,
    editionId: number,
    dto: CreateEventRequestDto,
    prisma: any
  ) {
    try {
      const eventDataEntries: Array<{ dataType: string; title: string; value: string }> = [];

      if (dto.description) {
        eventDataEntries.push({
          dataType: 'TEXT',
          title: 'desc',
          value: dto.description,
        });
      }

      if (dto.short_desc) {
        eventDataEntries.push({
          dataType: 'TEXT',
          title: 'short_desc',
          value: dto.short_desc,
        });
      }

      if (dto.og_image) {
        eventDataEntries.push({
          dataType: 'ATTACHMENT',
          title: 'event_og_image',
          value: dto.og_image,
        });
      }

      eventDataEntries.push({
        dataType: 'Bool',
        title: 'year_block',
        value: dto.yearBlock ? '1' : '0',
      });

      eventDataEntries.push({
        dataType: 'Bool',
        title: 'intro_block',
        value: dto.introBlock ? '1' : '0',
      });

      if (dto.customization) {
        const processedCustomization = await this.processCustomizationData(
          dto.customization, 
          eventId
        );
        
        eventDataEntries.push({
          dataType: 'JSON',
          title: 'customization',
          value: processedCustomization,
        });
      }

      for (const entry of eventDataEntries) {
        await prisma.event_data.create({
          data: {
            event: eventId,
            event_edition: editionId,
            data_type: entry.dataType,
            title: entry.title,
            value: entry.value,
            published: true,
            createdby: dto.changesMadeBy,
            created: new Date(),
          },
        });
      }
    } catch (error) {
      this.logger.error('Event data creation error:', error);
    }
  }

  private async processCustomizationData(customizationJson: string, eventId: number): Promise<string> {
    try {
      const customizationData = JSON.parse(customizationJson);
      
      // Process banner image through S3 service
      const processedData = await this.s3Service.processCustomizationBannerImage(
        customizationData, 
        eventId
      );
      
      return JSON.stringify(processedData);
      
    } catch (error) {
      this.logger.error(`Failed to process customization data for event ${eventId}:`, error.message);
      return customizationJson; 
    }
  }

  private async createContactEntry(eventId: number, userId: number, prisma: any) {
    try {
      await prisma.contact.create({
        data: {
          entity_type: 1,
          entity_id: eventId,
          user_reference: userId,
          notification: 10,
          role_id: 0,
          published: 1,
          show_phone: 0,
          created: new Date(),
          createdby: userId,
          is_stall: false,
          is_visitor: false,
        },
      });
    } catch (error) {
      this.logger.error('Contact creation error:', error);
    }
  }

  private async createUserEventMapping(eventId: number, dto: CreateEventRequestDto, prisma: any) {
  if (dto.fromDashboard === 1) {
    await prisma.user_event_mapping.upsert({
      where: {
        event_userEvent: {
          event: dto.mainEvent || eventId,
          userEvent: dto.mainEvent ? eventId : undefined,
        }
      },
      update: { published: dto.publish ?? 1 },
      create: {
        event: dto.mainEvent || eventId,
        userEvent: dto.mainEvent ? eventId : undefined,
        published: dto.publish ?? 1,
        created: new Date(),
        createdBy: dto.changesMadeBy,
      },
    });
  }
}

  private async createEventSettings(eventId: number, dto: CreateEventRequestDto, prisma: any) {
    if (dto.fromDashboard === 1 && 
        (dto.autoApproval !== undefined || dto.regStartDate || dto.regEndDate || dto.capacity)) {
      
      await prisma.event_settings.create({
        data: {
          event_id: eventId,
          user_id: dto.changesMadeBy,
          auto_approval: dto.autoApproval ?? 0,
          reg_start_date: dto.regStartDate ? new Date(dto.regStartDate) : null,
          reg_end_date: dto.regEndDate ? new Date(dto.regEndDate) : null,
          capacity: dto.capacity ?? null,
          created: new Date(),
        }
      });
    }
  }

  private async createDefaultQuestionnaire(eventId: number, prisma: any) {
    try {
      const questionnaire = await prisma.questionnaire.create({
        data: {
          question: 'Which topics or products are you eager to explore?',
          answer_type: true,
          options: null,
          configuration: null,
        },
      });

      await prisma.event_questionnaire.create({
        data: {
          event_id: eventId,
          question_id: questionnaire.id,
          position: null,
          is_mandatory: false,
          published: true,
          for_exhibitor: 0,
          stage: 0,
        },
      });
    } catch (error) {
      this.logger.error('Questionnaire creation error:', error);
    }
  }

  private async createEventTypeAssociations(
    eventId: number,
    type: string,
    typeVal: string | undefined,
    userId: number,
    prisma: any
  ) {
    try {
      const eventTypes = this.mapEventTypeToArray(type, typeVal);

      for (const eventTypeId of eventTypes) {
        const eventType = await prisma.event_type.findUnique({
          where: { id: eventTypeId },
        });

        if (eventType) {
          await prisma.event_type_event.upsert({
            where: {
              eventtype_id_event_id: {  
                eventtype_id: eventTypeId,
                event_id: eventId,
              },
            },
            update: {
              modified_by: userId,
              modified: new Date(),
            },
            create: {
              eventtype_id: eventTypeId,
              event_id: eventId,
              created_by: userId,
              created: new Date(),
              modified: new Date(),
              published: 1,
            },
          });
        }
      }
    } catch (error) {
      this.logger.error('Event type association error:', error);
    }
  }

  private async indexEventToElasticsearch(eventId: number): Promise<void> {
    try {
      this.logger.log(`Starting Elasticsearch indexing for event ${eventId}`);

      // Small delay to ensure data is committed
      await new Promise(resolve => setTimeout(resolve, 100));

      const esDocument = await this.commonService.transformEventForES(eventId);
      await this.elasticsearchService.indexEvent(esDocument);
      
      this.logger.log(`Successfully indexed event ${eventId} to Elasticsearch`);
    } catch (error) {
      this.logger.error(`Failed to index event ${eventId} to Elasticsearch:`, error.message);
    }
  }

  private async handleExternalIntegrations(eventId: number, editionId: number) {
    try {
      this.logger.log(`External integrations triggered for event ${eventId}, edition ${editionId}`);
    } catch (error) {
      this.logger.warn('External integrations failed', error);
    }
  }

  private async sendRabbitmqNotification(
    eventId: number,
    editionId: number,
    sourceFile: string,
    req?: any
  ): Promise<void> {
    try {
      const protocol = req?.secure || req?.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const host = req?.get('host') || 'localhost';
      const endpoint = `${protocol}://${host}${req?.originalUrl || '/api/events'}`;

      const message = {
        event: eventId,
        edition: editionId,
        endPoint: endpoint,
        file: sourceFile,
      };

      await this.rabbitMQService.sendStrengthMessage(message);
      
    } catch (error) {
      this.logger.error(`Failed to send RabbitMQ notification for event ${eventId}:`, error.message);
    }
  }

   private async sendErrorNotification(error: Error, dto: CreateEventRequestDto, req?: any): Promise<void> {
    try {
      let endpoint = '';
      if (req) {
        const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const host = req.get('host') || 'localhost';
        endpoint = `${protocol}://${host}${req.originalUrl || '/v1/event/add'}`;
      }

      await this.emailService.sendErrorNotification(error, dto, endpoint);
      
      this.logger.log('Error notification email sent');
    } catch (notificationError) {
      this.logger.error('Failed to send error notification email:', notificationError.message);
    }
  }
}