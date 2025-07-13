import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ValidationService } from '../common/validation.service';
import { EditionService } from '../common/edition.service';
import { CreateEventRequestDto } from '../dto/create-event-request.dto';
import { CreateEventResponseDto } from '../dto/create-event-response.dto';
import { ReviewData, UnifiedReviewService } from '../../common/review.service';
import { S3Service } from '../../common/s3.service';
import { EmailService } from '../../common/email.service';
import { CommonService } from '../common/common.service';
import { EventUpsertRequestDto } from '../dto/upsert-event-request.dto';
import { EventUpsertResponseDto, createSuccessResponse, createErrorResponse } from '../dto/upsert-event-response.dto';
import { ElasticsearchService } from 'src/elasticsearch/elasticsearch.service';
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
    private rabbitMQService: RabbitmqService, 
    private s3Service: S3Service,
    private emailService: EmailService,  
    private unifiedReviewService: UnifiedReviewService, 
    private commonService: CommonService,
    private rabbitmqService: RabbitmqService,
    private firebaseSessionService: FirebaseSessionService,

  ) {}


  async upsertEvent(eventData: EventUpsertRequestDto, userId: number): Promise<EventUpsertResponseDto> {
      try {
        console.log('Received eventData:', JSON.stringify(eventData, null, 2));

        const futureDetection = eventData.editionId ? 
          { isFutureEdition: false, reason: 'Explicit edition ID provided' } :
          await this.detectFutureEditionScenario(eventData);

        if (futureDetection.isFutureEdition) {
          console.log('Auto-detected future edition - processing separately');
          return await this.handleAutoDetectedFutureEdition(eventData, userId);
        }
  
        // Determine if this is create or update
        const isUpdate = eventData.eventId && typeof eventData.eventId === 'number';
        console.log('Is update:', isUpdate, 'Event ID:', eventData.eventId);

        let result: EventUpsertResponseDto;
        
        if (isUpdate) {
          console.log('Processing event update...');
          result = await this.updateEvent(eventData, userId);
        } else {
          // result = await this.eventCreationService.createEvent(eventData);
          result = await this.updateEvent(eventData, userId);

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


   private async detectFutureEditionScenario(eventData: EventUpsertRequestDto): Promise<{
      isFutureEdition: boolean;
      reason?: string;
      currentEdition?: any;
    }> {
      // Must have event ID and dates for future edition detection
      if (!eventData.eventId || !eventData.startDate || !eventData.endDate) {
        return { 
          isFutureEdition: false, 
          reason: 'Missing required data for future edition detection' 
        };
      }
      
      try {
        console.log('Detecting future edition scenario...');
        
        // Get current event with edition
        const existingEvent = await this.prisma.event.findUnique({
          where: { id: eventData.eventId },
          include: {
            event_edition_event_event_editionToevent_edition: true
          }
        });
        
        if (!existingEvent?.event_edition_event_event_editionToevent_edition) {
          return { 
            isFutureEdition: false, 
            reason: 'No current edition found' 
          };
        }
        
        const currentEdition = existingEvent.event_edition_event_event_editionToevent_edition;
        
        // CRITICAL: Check for null dates before creating Date objects
        if (!currentEdition.start_date || !currentEdition.end_date) {
          return { 
            isFutureEdition: false, 
            reason: 'Current edition missing required dates' 
          };
        }
        
        const now = new Date();
        const newStart = new Date(eventData.startDate);
        const newEnd = new Date(eventData.endDate);
        const currentStart = new Date(currentEdition.start_date); 
        const currentEnd = new Date(currentEdition.end_date);
        
        console.log('Future Edition Analysis:', {
          currentStart: currentStart.toISOString(),
          currentEnd: currentEnd.toISOString(),
          newStart: newStart.toISOString(),
          newEnd: newEnd.toISOString(),
          now: now.toISOString()
        });
        
        // KEY CONDITIONS for future edition 
        
        // 1. Current edition must still exist and be valid
        const currentStillActive = currentEnd >= now;
        
        // 2. New dates must be in the future
        const datesInFuture = newStart > now && newEnd > now;
        
        // 3. New dates must be AFTER current edition dates
        const datesAfterCurrent = newStart > currentEnd;
        
        // 4. Must not be a rehost scenario (rehost = current edition ended)
        const isNotRehost = currentEnd >= now;
        
        console.log('Future Edition Conditions:', {
          currentStillActive,
          datesInFuture,
          datesAfterCurrent,
          isNotRehost
        });
        
        const isFutureEdition = currentStillActive && 
                              datesInFuture && 
                              datesAfterCurrent && 
                              isNotRehost;
        
        console.log('Future Edition Result:', isFutureEdition);
        
        return { 
          isFutureEdition,
          currentEdition,
          reason: isFutureEdition 
            ? 'Auto-detected future edition scenario' 
            : `Not future edition: active=${currentStillActive}, future=${datesInFuture}, after=${datesAfterCurrent}, notRehost=${isNotRehost}`
        };
        
      } catch (error) {
        console.error('Future edition detection failed:', error);
        return { 
          isFutureEdition: false, 
          reason: `Detection failed: ${error.message}` 
        };
      }
    }

  private async handleAutoDetectedFutureEdition(
    eventData: EventUpsertRequestDto, 
    userId: number
  ): Promise<EventUpsertResponseDto> {
    try {
      console.log('Processing auto-detected future edition with proper optimization');
      
      // Step 1: ALL VALIDATIONS OUTSIDE TRANSACTION
      const validationResult = await this.validateFutureEditionData(eventData, userId);
      if (!validationResult.isValid) {
        return createErrorResponse(validationResult.messages);
      }

      const { existingEvent, company, location, eventTypeData, categoryData } = validationResult.validatedData!;
      
      // Step 2: PRE-LOAD DATA OUTSIDE TRANSACTION
      const existingFutureEditionData = await this.preloadFutureEditionData(
        eventData.eventId!,
        eventData.startDate!,
        eventData.endDate!
      );

      // Step 3: MINIMAL TRANSACTION - ONLY CRITICAL DATABASE WRITES
      const coreResult = await this.prisma.$transaction(async (tx) => {
        let futureEdition;
        let isNew = true;
        
        if (existingFutureEditionData.existingEdition) {
          // Update existing future edition
          isNew = false;
          futureEdition = await this.updateExistingFutureEdition(
            existingFutureEditionData.existingEdition,
            eventData,
            company,
            location,
            userId,
            tx
          );
        } else {
          // Create new future edition
          futureEdition = await this.createNewFutureEdition(
            eventData,
            company,
            location,
            existingFutureEditionData.maxEditionNumber,
            userId,
            tx
          );
        }
        
        // ONLY CORE EVENT DATA IN TRANSACTION
        await this.createCoreEventData(eventData.eventId!, futureEdition.id, eventData, userId, tx);

        return {
          valid: true,
          message: isNew ? 'Future edition created successfully' : 'Future edition updated successfully',
          editionId: futureEdition.id,
          isNew
        };
      }, {
        maxWait: 1000,   // Reduced timeout
        timeout: 20000,  // Reduced timeout
      });
      
      if (!coreResult.valid) {
        return createErrorResponse([coreResult.message ?? 'Future edition processing failed']);
      }

      // Step 4: ALL COMPLEX OPERATIONS OUTSIDE TRANSACTION
      await this.processComplexFutureEditionData(
        eventData.eventId!,
        coreResult.editionId,
        eventData,
        categoryData,
        userId
      );

      // Step 5: NON-BLOCKING POST-PROCESSING
      setImmediate(() => {
        this.postProcessFutureEdition(eventData.eventId!, coreResult.editionId, eventData);
      });
      
      return createSuccessResponse(
        { 
          eventId: eventData.eventId, 
          edition: coreResult.editionId,
          futureEdition: true,
          isNew: coreResult.isNew
        },
        coreResult.message ?? 'Future edition processed successfully'
      );
      
    } catch (error) {
      console.error('Future edition processing failed:', error);
      return createErrorResponse([error.message || 'Future edition processing failed']);
    }
  }

  private async createCoreEventData(
    eventId: number,
    editionId: number,
    eventData: EventUpsertRequestDto,
    userId: number,
    tx: any
  ): Promise<void> {
    const eventDataEntries: Array<{
      title: string;
      data_type: string;
      value: string;
    }> = [];

    // Only add ESSENTIAL event data that must be in transaction
    if (eventData.description) {
      eventDataEntries.push({
        title: 'desc',
        data_type: 'TEXT',
        value: eventData.description,
      });
    }

    if (eventData.shortDesc) {
      eventDataEntries.push({
        title: 'short_desc',
        data_type: 'TEXT',
        value: eventData.shortDesc,
      });
    }

    if (eventData.timing) {
      eventDataEntries.push({
        title: 'timing',
        data_type: 'JSON',
        value: typeof eventData.timing === 'string' ? eventData.timing : JSON.stringify(eventData.timing),
      });
    }

    // if (eventData.stats) {
    //   eventDataEntries.push({
    //     title: 'stats',
    //     data_type: 'JSON',
    //     value: typeof eventData.stats === 'string' ? eventData.stats : JSON.stringify(eventData.stats),
    //   });
    // }


    // Batch create all event data
    if (eventDataEntries.length > 0) {
      const createOperations = eventDataEntries.map(entry => 
        tx.event_data.upsert({
          where: {
            event_event_edition_title: {
              event: eventId,
              event_edition: editionId,
              title: entry.title
            }
          },
          update: {
            value: entry.value,
            modifiedby: userId,
            modified: new Date(),
          },
          create: {
            event: eventId,
            event_edition: editionId,
            data_type: entry.data_type,
            title: entry.title,
            value: entry.value,
            createdby: userId,
          }
        })
      );

      await Promise.all(createOperations);
    }
  }

  private async processComplexFutureEditionData(
    eventId: number,
    editionId: number,
    eventData: EventUpsertRequestDto,
    categoryData: any,
    userId: number
  ): Promise<void> {
    const operations: Promise<any>[] = [];

    // Process stats
    if (eventData.stats) {
      operations.push(this.processFutureStats(eventId, editionId, eventData.stats, userId));
    }

    // Process contacts (independent operation)
    if (eventData.contact) {
      operations.push(this.processFutureContacts(eventId, eventData.contact, userId));
    }

    // Process products and categories
    if (eventData.product || eventData.category) {
      operations.push(this.processFutureProductsAndCategories(
        eventId, editionId, eventData, categoryData, userId
      ));
    }

    // Process event settings
    if (eventData.eventSettings) {
      operations.push(this.processFutureEventSettings(eventId, eventData.eventSettings, userId));
    }

    // Process sub-venues
    if (eventData.subVenue) {
      // Get venue ID from the created edition
      operations.push(this.processFutureSubVenuesWithQuery(eventId, editionId, eventData.subVenue, userId));
    }

    if (eventData.salesAction || eventData.salesActionBy || eventData.salesStatus || eventData.salesRemark) {
      operations.push(this.processFutureSalesData(eventId, editionId, eventData, userId));
    }

    // Process attachments
    operations.push(this.processFutureAttachments(eventId, editionId, eventData, userId));

    // Execute all operations in parallel
    if (operations.length > 0) {
      await Promise.all(operations);
    }
  }

  private async processFutureStats(
    eventId: number,
    editionId: number,
    statsData: any,
    userId: number
  ): Promise<void> {
    try {
      await this.commonService.processEventStats(eventId, editionId, statsData, userId);
    } catch (error) {
      this.logger.warn(`Stats processing failed for future edition: ${error.message}`);
    }
  }

  private async processFutureSubVenuesWithQuery(
    eventId: number,
    editionId: number,
    subVenueData: string,
    userId: number
  ): Promise<void> {
    try {
      // Query the actual venue ID from the created edition
      const edition = await this.prisma.event_edition.findUnique({
        where: { id: editionId },
        select: { venue: true }
      });
      
      if (edition?.venue) {
        await this.commonService.processSubVenues(
          eventId, editionId, subVenueData, edition.venue, userId
        );
      } else {
        this.logger.warn(`No venue found for sub-venue processing in edition ${editionId}`);
      }
    } catch (error) {
      this.logger.warn(`Sub-venue processing failed for future edition: ${error.message}`);
    }
  }

  private async processFutureSalesData(
    eventId: number,
    editionId: number,
    eventData: EventUpsertRequestDto,
    userId: number
  ): Promise<void> {
    try {
      await this.processSalesData(eventData, editionId, userId);
    } catch (error) {
      this.logger.warn(`Sales processing failed for future edition: ${error.message}`);
    }
  }

  private async processFutureContacts(
    eventId: number,
    contactsData: string,
    userId: number
  ): Promise<void> {
    try {
      const contacts = JSON.parse(contactsData);
      const validation = await this.commonService.validateContactEmails(contacts);
      
      if (validation.valid) {
        await this.commonService.addEventContacts(eventId, contactsData, userId);
      } else {
        this.logger.warn(`Contact validation failed for future edition: ${validation.message}`);
      }
    } catch (error) {
      this.logger.error('Future edition contact processing failed:', error);
    }
  }

  private async processFutureProductsAndCategories(
    eventId: number,
    editionId: number,
    eventData: EventUpsertRequestDto,
    categoryData: any,
    userId: number
  ): Promise<void> {
    try {
      let productCategoryIds: number[] = [];

      // Process products first
      if (eventData.product) {
        const productResult = await this.commonService.processEventProducts(
          eventId, editionId, eventData.product, userId
        );
        productCategoryIds = productResult.categoryIds;
      }

      // Process categories
      if (eventData.category || productCategoryIds.length > 0) {
        const userCategoryIds = categoryData?.categoryIds || [];
        const allCategories = [...userCategoryIds, ...productCategoryIds];
        const uniqueCategories = [...new Set(allCategories)];
        
        await this.commonService.processEventCategories(
          eventId, uniqueCategories, userId
        );
      }
    } catch (error) {
      this.logger.error('Products/Categories processing failed for future edition:', error);
    }
  }

  private async processFutureEventSettings(
    eventId: number,
    eventSettingsData: string,
    userId: number
  ): Promise<void> {
    try {
      await this.processEventSettings(eventId, eventSettingsData, userId);
    } catch (error) {
      this.logger.warn(`Event settings processing failed for future edition: ${error.message}`);
    }
  }

  private async processFutureSubVenues(
    eventId: number,
    editionId: number,
    subVenueData: string,
    venueId: number,
    userId: number
  ): Promise<void> {
    try {
      await this.commonService.processSubVenues(
        eventId, editionId, subVenueData, venueId, userId
      );
    } catch (error) {
      this.logger.warn(`SubVenue processing failed for future edition: ${error.message}`);
    }
  }

  private async processFutureAttachments(
    eventId: number,
    editionId: number,
    eventData: EventUpsertRequestDto,
    userId: number
  ): Promise<void> {
    try {
      await this.processAttachments(eventData, eventId, editionId, userId, null);
    } catch (error) {
      this.logger.warn(`Attachments processing failed for future edition: ${error.message}`);
    }
  }

    private async validateFutureEditionData(eventData: EventUpsertRequestDto, userId: number): Promise<{
      isValid: boolean;
      messages: string[];
      validatedData?: any;
    }> {
      const messages: string[] = [];
      let validatedData: any = {};

      try {
        // Step 1: Validate user
        const userValidation = await this.validationService.validateUser(userId);
        if (!userValidation.isValid) {
          messages.push(userValidation.message ?? 'User validation failed');
        }

        // Step 2: Validate event exists
        if (typeof eventData.eventId !== 'number') {
          messages.push('Event id is required for future edition');
        } else {
          const eventValidation = await this.validationService.validateEventExists(eventData.eventId);
          if (!eventValidation.isValid) {
            messages.push(eventValidation.message ?? 'Event validation failed');
          } else {
            validatedData.existingEvent = eventValidation.event;
          }
        }

        // Step 3: Validate dates (required for future edition)
        if (!eventData.startDate || !eventData.endDate) {
          messages.push('Start date and end date are required for future edition');
        } else {
          const dateValidation = this.validationService.validateDates(
            eventData.startDate,
            eventData.endDate
          );
          if (!dateValidation.isValid) {
            messages.push(dateValidation.message ?? 'Date validation failed');
          }
        }

        // Step 4: Validate website format if provided
        if (eventData.website && !this.validationService.validateWebsiteFormat(eventData.website)) {
          messages.push('website is not in correct format');
        }

        // Step 5: Validate company if provided
        let company = null;
        if (eventData.company) {
          const companyValidation = await this.validationService.validateCompany(eventData.company);
          if (!companyValidation.isValid) {
            messages.push(companyValidation.message ?? 'Company validation failed');
          } else {
            company = companyValidation.company;
          }
        }
        validatedData.company = company;

        // Step 6: Validate location if provided
        let location: any = null;
        if (eventData.venue || eventData.city) {
          location = await this.validateUpdateLocation(eventData);
          if (!location || !location.isValid) {
            messages.push(location?.message ?? 'Location validation failed');
          }
        }
        validatedData.location = location;

        // Step 7: Process event type changes
        let eventTypeData: any = null;
        if (eventData.type) {
          eventTypeData = await this.processEventTypeUpdateWithUrl(eventData, validatedData.existingEvent);
          if (!eventTypeData || !eventTypeData.isValid) {
            messages.push(eventTypeData?.message ?? 'Event type validation failed');
          }
        }
        validatedData.eventTypeData = eventTypeData;

        // Step 8: Validate categories if provided
        if (eventData.category && eventData.category.length > 0) {
          const categoryValidation = await this.validationService.resolveCategoriesByUrl(eventData.category);
          if (!categoryValidation.isValid) {
            messages.push(categoryValidation.message ?? 'Category validation failed');
          } else {
            validatedData.categoryData = categoryValidation;
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
          messages: [`Future edition validation error: ${error.message}`],
        };
      }
    }

    private async preloadFutureEditionData(
      eventId: number,
      startDate: string,
      endDate: string
    ): Promise<{
      existingEdition: any | null;
      maxEditionNumber: number;
      existingEventData: Map<string, any>;
    }> {
      try {
        // Check for existing future edition with same dates
        const existingEdition = await this.prisma.event_edition.findFirst({
          where: {
            event: eventId,
            start_date: new Date(startDate),
            end_date: new Date(endDate)
          }
        });

        // Get max edition number for new edition creation
        const maxEdition = await this.prisma.event_edition.findFirst({
          where: { event: eventId },
          select: { edition_number: true },
          orderBy: { edition_number: 'desc' }
        });
        const maxEditionNumber = maxEdition?.edition_number || 0;

        // Pre-load existing event data if updating
        let existingEventData = new Map();
        if (existingEdition) {
          existingEventData = await this.preloadExistingEventData(eventId, existingEdition.id);
        }

        return {
          existingEdition,
          maxEditionNumber,
          existingEventData
        };
      } catch (error) {
        console.error('Failed to preload future edition data:', error);
        return {
          existingEdition: null,
          maxEditionNumber: 0,
          existingEventData: new Map()
        };
      }
    }

    // Optimized method to update existing future edition
    private async updateExistingFutureEdition(
      existingEdition: any,
      eventData: EventUpsertRequestDto,
      company: any,
      location: any,
      userId: number,
      tx: any
    ): Promise<any> {
      const updateData: any = {
        modified: new Date(),
        modifiedby: userId,
      };

      // Batch all updates
      if (eventData.website) updateData.website = eventData.website;
      if (eventData.eepProcess) updateData.eep_process = eventData.eepProcess;
      if (location?.city) {
        updateData.city = location.city.id;
        if (location.city.id === 1) {
          updateData.online_event = 1;
        } else {
          updateData.online_event = null;
        }
      }    
      if (location?.venue) updateData.venue = location.venue.id;
      if (location?.removeVenue) updateData.venue = null;
      if (company) updateData.company_id = company.id;
      
      // Social media fields
      if (eventData.facebookId) updateData.facebook_id = eventData.facebookId;
      if (eventData.linkedinId) updateData.linkedin_id = eventData.linkedinId;
      if (eventData.twitterId) updateData.twitter_id = eventData.twitterId;
      if (eventData.twitterHashTags) updateData.twitter_hashtag = eventData.twitterHashTags;
      if (eventData.googleId) updateData.google_id = eventData.googleId;
      if (eventData.customFlag) {
        updateData.custom_flag = eventData.customFlag;
      }

      await tx.event_edition.update({
        where: { id: existingEdition.id },
        data: updateData
      });
      
      return existingEdition;
    }

    // Optimized method to create new future edition
    private async createNewFutureEdition(
      eventData: EventUpsertRequestDto,
      company: any,
      location: any,
      maxEditionNumber: number,
      userId: number,
      tx: any
    ): Promise<any> {
      const editionNumber = maxEditionNumber + 1;
      
      const futureEdition = await tx.event_edition.create({
        data: {
          event: eventData.eventId!,
          start_date: new Date(eventData.startDate!),
          end_date: new Date(eventData.endDate!),
          company_id: company?.id,
          venue: location?.venue?.id,
          city: location?.city?.id,
          edition_number: editionNumber,
          createdby: userId,
          website: eventData.website,
          eep_process: eventData.eepProcess || 0,
          online_event: (location?.city?.id) === 1 ? 1 : null,
          facebook_id: eventData.facebookId,
          linkedin_id: eventData.linkedinId,
          twitter_id: eventData.twitterId,
          twitter_hashtag: eventData.twitterHashTags,
          google_id: eventData.googleId,
        }
      });

      return futureEdition;
    }


    private getFutureVenueId(location: any, eventData: EventUpsertRequestDto, futureEdition: any): number | undefined {
      // REPLACE ENTIRE METHOD WITH:
      
      // 1. First check if venue was provided in request
      if (location?.venue?.id) {
        return location.venue.id;
      }
      
      // 2. Check if venue is a number in eventData
      if (typeof eventData.venue === 'number') {
        return eventData.venue;
      }
      
      // 3. Try to resolve venue from validation result
      if (typeof eventData.venue === 'string') {
        // This means venue was validated and should be in location
        return location?.venue?.id;
      }
      
      // 4. Get venue from the created future edition
      if (futureEdition?.venue) {
        return futureEdition.venue;
      }
      
      // 5. Last resort: query the actual edition from DB
      return undefined;
    }

    // Non-blocking post-processing for future editions
    private async postProcessFutureEdition(
      eventId: number,
      editionId: number,
      eventData: EventUpsertRequestDto
    ): Promise<void> {
      try {
        // Send to RabbitMQ and Elasticsearch in background
        await this.postProcessEvent(eventId, editionId, eventData, true);
        
        this.logger.log(`Post-processing completed for future edition ${editionId}`);
      } catch (error) {
        this.logger.warn('Post-processing failed for future edition:', error);
      }
    }

    private async updateEvent(eventData: EventUpsertRequestDto, userId: number): Promise<EventUpsertResponseDto> {
      try {
        // Step 1: Perform all validations upfront 
        const validationResult = await this.validateEventUpdateData(eventData, userId);
        if (!validationResult.isValid) {
          return createErrorResponse(validationResult.messages);
        }

        const { existingEvent, company, location, eventTypeData, rehostAnalysis, categoryData, isCurrentEdition } = validationResult.validatedData!;

        // Step 2: Pre-fetch all existing data we'll need (OUTSIDE transaction)
        const existingEventData = await this.preloadExistingEventData(
          existingEvent.id, 
          existingEvent.event_edition_event_event_editionToevent_edition.id
        );

        // Step 3: OPTIMIZED CORE TRANSACTION - Process update with pre-loaded data
        const oldCompanyId = existingEvent.event_edition_event_event_editionToevent_edition?.company_id;
        const newCompanyId = company?.id;
        
        const coreResult = await this.prisma.$transaction(async (tx) => {
          let currentEdition = existingEvent.event_edition_event_event_editionToevent_edition;
          let editionId = currentEdition?.id;
          let isNewEdition = false;

          let targetEdition = currentEdition;
          if (eventData.editionId && eventData.editionId !== currentEdition?.id) {
            // Working with a specific past/future edition
            targetEdition = await tx.event_edition.findUnique({
              where: { id: eventData.editionId }
            });
            
            if (!targetEdition) {
              throw new Error(`Edition ${eventData.editionId} not found`);
            }
            
            editionId = targetEdition.id;
            console.log(`Working with specific edition: ${editionId} (current: ${currentEdition?.id})`);
          }

          // Handle rehost scenario (create new edition)
          if ((rehostAnalysis.isRehost || rehostAnalysis.needsNewEdition) && isCurrentEdition) {
            console.log('Creating new edition (rehost scenario)');

            if (!eventData.startDate || !eventData.endDate) {
              throw new Error('Start date and end date are required for rehost scenario');
            }

            // Calculate new edition number
            let editionNumber = 1;
            if (currentEdition && currentEdition.edition_number) {
              editionNumber = currentEdition.edition_number + 1;
            } else {
              const maxEdition = await tx.event_edition.findFirst({
                where: { event: existingEvent.id },
                select: { edition_number: true },
                orderBy: { edition_number: 'desc' }
              });
              
              if (maxEdition && maxEdition.edition_number) {
                editionNumber = maxEdition.edition_number + 1;
              }
            }
            
            // Create new edition
            const newEdition = await tx.event_edition.create({
              data: {
                event: existingEvent.id,
                start_date: new Date(eventData.startDate),
                end_date: new Date(eventData.endDate),
                city: location?.city?.id || currentEdition.city,
                venue: location?.venue?.id || (location?.removeVenue ? null : currentEdition.venue),
                company_id: company?.id || currentEdition.company_id,
                website: eventData.website || currentEdition.website,
                edition_number: editionNumber,
                createdby: userId,
                eep_process: eventData.eepProcess || 2,
                facebook_id: eventData.facebookId || currentEdition.facebook_id,
                linkedin_id: eventData.linkedinId || currentEdition.linkedin_id,
                twitter_id: eventData.twitterId || currentEdition.twitter_id,
                twitter_hashtag: eventData.twitterHashTags || currentEdition.twitter_hashtag,
                google_id: eventData.googleId || currentEdition.google_id,
                visitors_total: null,
                exhibitors_total: null,
                area_total: null,
              }
            });

            // Update event to point to new edition
            await tx.event.update({
              where: { id: existingEvent.id },
              data: { 
                event_edition: newEdition.id,
                verified: null,
                membership: 0,
              }
            });

            editionId = newEdition.id;
            isNewEdition = true;
            currentEdition = newEdition;
          } else {

            console.log(`Updating edition ${editionId}`);
            // Update existing edition
            const editionUpdateData: any = {
              modified: new Date(),
              modifiedby: userId,
            };

            if (eventData.startDate) editionUpdateData.start_date = new Date(eventData.startDate);
            if (eventData.endDate) editionUpdateData.end_date = new Date(eventData.endDate);
            if (company) editionUpdateData.company_id = company.id;
            if (location?.city) editionUpdateData.city = location.city.id;
            if (location?.venue) editionUpdateData.venue = location.venue.id;
            if (location?.removeVenue) editionUpdateData.venue = null;
            if (eventData.facebookId) editionUpdateData.facebook_id = eventData.facebookId;
            if (eventData.linkedinId) editionUpdateData.linkedin_id = eventData.linkedinId;
            if (eventData.twitterId) editionUpdateData.twitter_id = eventData.twitterId;
            if (eventData.twitterHashTags) editionUpdateData.twitter_hashtag = eventData.twitterHashTags;
            if (eventData.googleId) editionUpdateData.google_id = eventData.googleId;
            if (eventData.website) editionUpdateData.website = eventData.website;

            await tx.event_edition.update({
              where: { id: editionId },
              data: editionUpdateData
            });
          }

          // Update main event table ONLY if we're working with the current edition
          if (isCurrentEdition || isNewEdition) {
            console.log('Updating main event table (current edition changes)');
            const eventUpdateData: any = {
              modified: new Date(),
              modifiedby: userId,
            };

            if (eventData.name) eventUpdateData.name = eventData.name;
            if (eventData.abbrName) eventUpdateData.abbr_name = eventData.abbrName;
            if (eventData.punchline) eventUpdateData.punchline = eventData.punchline;
            if (eventData.website) eventUpdateData.website = eventData.website;
            if (eventData.frequency) eventUpdateData.frequency = eventData.frequency;
            if (eventData.brand) eventUpdateData.brand_id = eventData.brand;

            if (eventData.startDate) eventUpdateData.start_date = new Date(eventData.startDate);
            if (eventData.endDate) eventUpdateData.end_date = new Date(eventData.endDate);

            if (location?.city) {
              eventUpdateData.city = location.city.id;
              eventUpdateData.country = location.country.id;
            }

            if (eventTypeData) {
              eventUpdateData.event_type = eventTypeData.eventType;
              eventUpdateData.sub_event_type = eventTypeData.subEventType;
              eventUpdateData.event_audience = eventTypeData.eventAudience?.toString();
            }

            await tx.event.update({
              where: { id: existingEvent.id },
              data: eventUpdateData
            });
          }
          else {
            console.log('Skipping main event table update (past/future edition)');
          }

          if ((isCurrentEdition || isNewEdition) && eventTypeData?.eventTypeArray) {
            console.log('Processing event types (current edition only)');
            await this.updateEventTypesStandalone(
              existingEvent.id,
              eventTypeData.eventTypeArray,
              userId,
              tx
            );
          } else if (!isCurrentEdition && eventTypeData?.eventTypeArray) {
            console.log('Skipping event type update (past/future edition)');
          }

          //  Bulk process all event_data updates in single operations
          await this.updateEventData(existingEvent.id, editionId, eventData, userId, existingEventData, tx);

          //  Bulk process all other operations
          const bulkOperations: Promise<any>[] = [];

          // Process sales data
          if (eventData.salesAction || eventData.salesActionBy || eventData.salesStatus || eventData.salesRemark) {
            bulkOperations.push(this.processSalesData(eventData, editionId, userId, tx));
          }

          // Process contacts
          if (eventData.contact) {
            bulkOperations.push(this.processContacts(existingEvent.id, eventData.contact, userId));
          }

          // Process stats
          if (eventData.stats) {
            bulkOperations.push(this.processStats(existingEvent.id, editionId, eventData.stats, userId, tx));
          }

          // Process products and categories together
          if (eventData.product || eventData.category) {
            bulkOperations.push(this.processProductsAndCategories(
              existingEvent.id, editionId, eventData, categoryData, userId, tx
            ));
          }

          // Process event settings
          if (eventData.eventSettings) {
            bulkOperations.push(this.processEventSettings(existingEvent.id, eventData.eventSettings, userId, tx));
          }

          if (eventData.subVenue && typeof eventData.subVenue === 'string') {
            bulkOperations.push(this.processSubVenues(existingEvent.id, editionId, eventData, userId, tx));
          }


          // Execute all bulk operations in parallel where possible
          if (bulkOperations.length > 0) {
            await Promise.all(bulkOperations);
          }

          return { 
            updatedEvent: existingEvent, 
            editionId, 
            isNewEdition,
            isCurrentEdition,
            rehostScenario: rehostAnalysis.scenario
          };
        }, {
          maxWait: 10000,   // Reduced from 10000
          timeout: 20000,  // Reduced from 20000
        });

        console.log('Core transaction completed successfully');

        // if (oldCompanyId !== newCompanyId) {
        //   setImmediate(() => {
        //     this.handleFirebaseSessionCloning(existingEvent.id, oldCompanyId, newCompanyId);
        //   });
        // }

        // Copy event data for rehost
        if (coreResult.isNewEdition) {
          setImmediate(() => {
            this.copyEventDataToNewEdition(
              existingEvent.id, 
              existingEvent.event_edition_event_event_editionToevent_edition.id,
              coreResult.editionId, 
              userId
            );
          });
        }


        // Post-processing operations
        setImmediate(() => {
          this.postProcessEvent(existingEvent.id, coreResult.editionId, eventData, true);
        });

        return createSuccessResponse(
          {
            eventId: existingEvent.id,
            editionId: coreResult.editionId,
          },
          'updated'
        );

      } catch (error) {
        console.error('Event update failed:', error);
        return createErrorResponse([error.message || 'Event update failed']);
      }
    }

    private async preloadExistingEventData(eventId: number, editionId: number): Promise<Map<string, any>> {
      const existingEventData = await this.prisma.event_data.findMany({
        where: {
          event: eventId,
          event_edition: editionId,
          title: {
            in: ['timing', 'desc', 'short_desc', 'event_highlights', 'stats', 'event_documents', 'brochure', 'event_og_image', 'customization']
          }
        }
      });

      // Create a map for faster lookups
      const dataMap = new Map();
      existingEventData.forEach(data => {
        dataMap.set(data.title, data);
      });

      return dataMap;
    }


    private async updateEventData(
      eventId: number,
      editionId: number,
      eventData: EventUpsertRequestDto,
      userId: number,
      existingDataMap: Map<string, any>,
      tx: any
    ) {
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

      if (eventData.highlights) {
        updates.push({
          title: 'event_highlights',
          data_type: 'JSON',
          value: eventData.highlights,
        });
      }

      if (eventData.description) {
        updates.push({
          title: 'desc',
          data_type: 'TEXT',
          value: eventData.description,
        });
      }

      if (eventData.shortDesc) {
        updates.push({
          title: 'short_desc',
          data_type: 'TEXT',
          value: eventData.shortDesc,
        });
      }

      if (eventData.brochure) {
        updates.push({
          title: 'brochure',
          data_type: 'ATTACHMENT',
          value: eventData.brochure.toString(),
        });
      }

      if (eventData.ogImage) {
        updates.push({
          title: 'event_og_image',
          data_type: 'ATTACHMENT',
          value: eventData.ogImage.toString(),
        });
      }

      // if (eventData.stats) {
      //   console.log('Processing stats:', eventData.stats);
      //   updates.push({
      //     title: 'stats',
      //     data_type: 'JSON',
      //     value: typeof eventData.stats === 'string' ? eventData.stats : JSON.stringify(eventData.stats),
      //   });
      // }

      const operations: Promise<any>[] = [];

      for (const update of updates) {
        operations.push(
          tx.event_data.upsert({
            where: {
              event_event_edition_title: {
                event: eventId,
                event_edition: editionId,
                title: update.title
              }
            },
            update: {
              value: update.value,
              modifiedby: userId,
              modified: new Date(),
            },
            create: {
              event: eventId,
              event_edition: editionId,
              data_type: update.data_type,
              title: update.title,
              value: update.value,
              createdby: userId,
              created: new Date(),
            }
          })
        );
      }

      if (operations.length > 0) {
        await Promise.all(operations);
      }
    }

    private async processContacts(eventId: number, contactsData: string, userId: number): Promise<void> {
      // Move contact processing outside of main transaction
      setImmediate(async () => {
        try {
          const contacts = JSON.parse(contactsData);
          const validation = await this.commonService.validateContactEmails(contacts);
          
          if (!validation.valid) {
            this.logger.warn(`Contact validation failed: ${validation.message}`);
            return;
          }

          await this.commonService.addEventContacts(eventId, contactsData, userId);
        } catch (error) {
          this.logger.error('Bulk contact processing failed:', error);
        }
      });
    }

    private async processStats(
      eventId: number,
      editionId: number,
      statsData: any,
      userId: number,
      tx: any
    ): Promise<{ valid: boolean; message?: string }> {
      try {
        return await this.commonService.processEventStats(eventId, editionId, statsData, userId, tx);
      } catch (error) {
        this.logger.warn(`Stats processing failed: ${error.message}`);
        return { valid: false };
      }
    }

    private async processProductsAndCategories(
      eventId: number,
      editionId: number,
      eventData: EventUpsertRequestDto,
      categoryData: any,
      userId: number,
      tx: any
    ): Promise<void> {
      let productCategoryIds: number[] = [];

      // Process products first
      if (eventData.product) {
        try {
          const productResult = await this.commonService.processEventProducts(
            eventId,
            editionId,
            eventData.product,
            userId,
            tx
          );
          productCategoryIds = productResult.categoryIds;
        } catch (error) {
          this.logger.error('Product processing failed:', error);
          throw new Error(`Product processing failed: ${error.message}`);
        }
      }

      // Process categories (merge user categories with product categories)
      if (eventData.category || productCategoryIds.length > 0) {
        const userCategoryIds = categoryData?.categoryIds || [];
        const allCategories = [...userCategoryIds, ...productCategoryIds];
        const uniqueCategories = [...new Set(allCategories)];
        
        await this.commonService.processEventCategories(
          eventId,
          uniqueCategories,
          userId,
          undefined,
          undefined,
          tx
        );
      }
    }

    private isCurrentEdition(eventData: EventUpsertRequestDto, existingEvent: any): boolean {
      const currentEditionId = existingEvent.event_edition_event_event_editionToevent_edition?.id;
      
      // If editionId is specified in payload, check if it matches current
      if (eventData.editionId) {
        const isCurrentEdition = eventData.editionId === currentEditionId;
        console.log(`Edition Context: Specified edition ${eventData.editionId} ${isCurrentEdition ? '==' : '!='} current (${currentEditionId})`);
        return isCurrentEdition;
      }
      
      // If no editionId specified = working with current edition
      console.log('No edition specified = working with current edition');
      return true;
    }

    validateDates(startDate: string, endDate: string, eventAudience?: string, isPastEdition?: boolean): {
      isValid: boolean;
      message?: string;
    } {
      const dateLogicResult = this.validationService.validateDates(startDate, endDate, eventAudience);
      
      // Allow past dates if updating past edition
      if (isPastEdition) {
        // Only check that end date is after start date
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (end < start && eventAudience !== '10100') {
          return {
            isValid: false,
            message: 'startDate should be less than endDate',
          };
        }
        
        return { isValid: true };
      }
      
      return dateLogicResult;
    }

    private async copyEventDataToNewEdition(
      eventId: number, 
      oldEditionId: number, 
      newEditionId: number, 
      userId: number
    ) {
      try {
        console.log(`Copying data from edition ${oldEditionId} to ${newEditionId}`);
        
        // Copy event_data 
        const existingEventData = await this.prisma.event_data.findMany({
          where: {
            event: eventId,
            event_edition: oldEditionId,
            title: { 
              not: 'event_media' // Don't copy media for rehost
            }
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
            created: new Date(),
          }));

          await this.prisma.event_data.createMany({
            data: newEventData,
            skipDuplicates: true, // Prevent conflicts
          });
          
          console.log(`Copied ${newEventData.length} event_data records`);
        }

        // Copy event_products
        const existingProducts = await this.prisma.event_products.findMany({
          where: { 
            event: eventId, 
            edition: oldEditionId 
          }
        });

        if (existingProducts.length > 0) {
          const newProducts = existingProducts.map(product => ({
            event: eventId,
            edition: newEditionId,
            product: product.product,
            published: product.published,
            createdby: userId,
            created: new Date(),
          }));

          await this.prisma.event_products.createMany({
            data: newProducts,
            skipDuplicates: true,
          });
          
          console.log(`Copied ${newProducts.length} event_products records`);
        }

        const introBlockData = await this.prisma.event_data.findFirst({
          where: {
            event: eventId,
            event_edition: oldEditionId,
            title: 'intro_block'
          }
        });

        if (introBlockData) {
          await this.prisma.event_data.create({
            data: {
              event: eventId,
              event_edition: newEditionId,
              data_type: introBlockData.data_type,
              title: 'intro_block',
              value: introBlockData.value,
              published: introBlockData.published,
              createdby: userId,
            }
          });
          console.log('Copied intro_block setting');
        }

      } catch (error) {
        console.error('Failed to copy event data:', error);
        throw error;
      }
    }


    private async validateEventUpdateData(eventData: EventUpsertRequestDto, userId: number): Promise<{
      isValid: boolean;
      messages: string[];
      validatedData?: {
        existingEvent: any;
        company: any;
        location: any;
        eventTypeData: any;
        rehostAnalysis: any;
        contactValidation?: any;
        categoryData?: any;
        salesValidation?: any;
        isCurrentEdition: boolean;
      };
    }> {
      const messages: string[] = [];
      let validatedData: any = {};

      try {
        // Step 1: Validate user
        const userValidation = await this.validationService.validateUser(userId);
        if (!userValidation.isValid) {
          messages.push(userValidation.message ?? 'User validation failed');
        }

        // Step 2: Validate event exists and ID
        if (typeof eventData.eventId !== 'number') {
          messages.push('Event id is required for update');
        } else {
          const eventValidation = await this.validationService.validateEventExists(eventData.eventId);
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

        // Step 3: Validate edition access if edition specified
        if (eventData.editionId) {
          const editionExists = await this.prisma.event_edition.findFirst({
            where: {
              id: eventData.editionId,
              event: eventData.eventId
            }
          });

          if (!editionExists) {
            messages.push('Invalid edition ID for this event');
          }
        }

        // Step 4: Check user permissions
        const authValidation = await this.validationService.validateUserAuthorization(
          userId,
          eventData.eventId!
        );

        if (!authValidation.isValid) {
          messages.push(authValidation.message ?? 'Not authorized to change the event details');
        } else {
          this.logger.log(
            `User ${userId} authorized for event ${eventData.eventId} via ${authValidation.authType}`
          );
        }

        // Step 5: Determine if working with current edition
        const isCurrentEdition = this.isCurrentEdition(eventData, existingEvent);
        validatedData.isCurrentEdition = isCurrentEdition;

        // Step 6: Analyze rehost scenario
        validatedData.rehostAnalysis = this.analyzeRehostScenario(eventData, existingEvent);

        // Step 7: Validate dates if provided
        if (eventData.startDate && eventData.endDate) {
          const isPastEdition = !isCurrentEdition;
          
          const dateValidation = this.validateDates(
            eventData.startDate,
            eventData.endDate,
            existingEvent.event_audience,
            isPastEdition
          );
          
          if (!dateValidation.isValid) {
            messages.push(dateValidation.message ?? 'Date validation failed');
          }

          // Only check for date conflicts with current edition updates
          if (isCurrentEdition) {
            const excludeEditionId = validatedData.rehostAnalysis.isRehost ? undefined : existingEvent.event_edition;
            const conflictValidation = await this.validationService.validateDateConflicts(
              eventData.eventId!,
              eventData.startDate,
              eventData.endDate,
              excludeEditionId
            );
            if (!conflictValidation.isValid) {
              messages.push(conflictValidation.message ?? 'Date conflict validation failed');
            }
          }
        }

        // Step 8: Validate website format if provided
        if (eventData.website) {
          const website = eventData.website;
          if (!this.validationService.validateWebsiteFormat(website ?? '')) {
            messages.push('website is not in correct format');
          }
        }

        // Step 9: Validate company if provided
        let company = null;
        if (eventData.company) {
          const companyValidation = await this.validationService.validateCompany(eventData.company);
          if (!companyValidation.isValid) {
            messages.push(companyValidation.message ?? 'Company validation failed');
          } else {
            company = companyValidation.company;
          }
        }
        validatedData.company = company;

        // Step 10: Validate location if provided
        let location: any = null;
        if (eventData.venue || eventData.city) {
          location = await this.validateUpdateLocation(eventData);
          if (!location || !location.isValid) {
            messages.push(location?.message ?? 'Location validation failed');
          }
        }
        validatedData.location = location;

        // Step 11: Process event type changes
        let eventTypeData: any = null;
        if (eventData.type) {
          eventTypeData = await this.processEventTypeUpdateWithUrl(eventData, existingEvent);
          if (!eventTypeData || !eventTypeData.isValid) {
            messages.push(eventTypeData?.message ?? 'Event type validation failed');
          }
        }
        validatedData.eventTypeData = eventTypeData;

        // Step 12: Validate categories if provided
        if (eventData.category && eventData.category.length > 0) {
          const categoryValidation = await this.validationService.resolveCategoriesByUrl(eventData.category);
          if (!categoryValidation.isValid) {
            messages.push(categoryValidation.message ?? 'Category validation failed');
          } else {
            validatedData.categoryData = categoryValidation;
          }
        }

        // Step 13: Validate sales data if provided
        if (eventData.salesAction || eventData.salesActionBy || eventData.salesStatus || eventData.salesRemark) {
          if (eventData.salesAction) {
            const actionValidation = this.validationService.validateSalesAction(eventData.salesAction);
            if (!actionValidation.isValid) {
              messages.push(actionValidation.message!);
            }

            if (!eventData.salesActionBy) {
              messages.push('salesActionBy is required when salesAction is provided');
            } else {
              const userValidation = await this.validationService.validateSalesActionBy(eventData.salesActionBy);
              if (!userValidation.isValid) {
                messages.push(userValidation.message!);
              } else {
                validatedData.salesValidation = {
                  actionValid: true,
                  userValid: true,
                  user: userValidation.user,
                };
              }
            }
          } else if (eventData.salesActionBy) {
            messages.push('salesAction is required when salesActionBy is provided');
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
      
      console.log('REHOST ANALYSIS:');
      console.log('- Current Edition End:', currentEdition?.end_date);
      console.log('- Current Time:', now);
      console.log('- New Start Date:', eventData.startDate);
      console.log('- New End Date:', eventData.endDate);
      
      // Must have both current edition and new dates to analyze
      if (!currentEdition?.end_date || !eventData.startDate || !eventData.endDate) {
        console.log(' Missing data for rehost analysis');
        return { isRehost: false, scenario: 'no_date_change' };
      }

      const currentEditionEnded = new Date(currentEdition.end_date) < now;
      const newStartDate = new Date(eventData.startDate);
      const currentEndDate = new Date(currentEdition.end_date);
      const newStartAfterCurrentEnd = newStartDate > currentEndDate;
      
      console.log('- Current Edition Ended:', currentEditionEnded);
      console.log('- New Start > Current End:', newStartAfterCurrentEnd);
      
      // LEGACY LOGIC: rehost only if edition ended AND new dates are after current end
      const isRehost = currentEditionEnded && newStartAfterCurrentEnd;
      
      console.log('IS REHOST:', isRehost);
      
      return {
        isRehost,
        needsNewEdition: isRehost,
        scenario: isRehost ? 'rehost' : 'regular_update'
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
    if (eventData.venue === "0") {
      return { isValid: true, removeVenue: true };
    }

    const venueId = eventData.venue;
    if (venueId && venueId !== "0") {
      if (typeof venueId === 'string') {
        // Handle URL-based venue resolution
        const venueValidation = await this.validationService.resolveVenueByUrl(venueId);
        if (!venueValidation.isValid) {
          return {
            isValid: false,
            message: venueValidation.message,
          };
        }
        
        const venue = venueValidation.venue;
        
        // Based on your schema, venue has direct relationships to both city and country
        let city = venue.city_venue_cityTocity;
        let country = venue.country_venue_countryTocountry;
        
        // If country is not loaded via venue, try to get it from city
        if (!country && city && city.country_city_countryTocountry) {
          country = city.country_city_countryTocountry;
        }
        
        // Fallback: if still no country, fetch it directly
        if (!country) {
          if (venue.country) {
            country = await this.prisma.country.findUnique({
              where: { id: venue.country }
            });
          } else if (city && city.country) {
            country = await this.prisma.country.findUnique({
              where: { id: city.country }
            });
          }
        }
        
        if (!city || !country) {
          return {
            isValid: false,
            message: 'Unable to resolve city or country for the venue'
          };
        }
        
        return {
          isValid: true,
          venue: venue,
          city: city,
          country: country
        };
      } else {
        // Handle numeric venue ID
        const numericVenueId = typeof venueId === 'string' ? parseInt(venueId) : venueId;
        const venueValidation = await this.validationService.validateVenue(numericVenueId);
        if (!venueValidation.isValid) {
          return venueValidation;
        }
        
        const venue = venueValidation.venue;
        let city = venue.city_venue_cityTocity;
        let country = venue.country_venue_countryTocountry;
        
        // If country is not loaded via venue, try to get it from city
        if (!country && city && city.country_city_countryTocountry) {
          country = city.country_city_countryTocountry;
        }
        
        // Fallback: if still no country, fetch it directly
        if (!country) {
          if (venue.country) {
            country = await this.prisma.country.findUnique({
              where: { id: venue.country }
            });
          } else if (city && city.country) {
            country = await this.prisma.country.findUnique({
              where: { id: city.country }
            });
          }
        }
        
        if (!city || !country) {
          return {
            isValid: false,
            message: 'Unable to resolve city or country for the venue'
          };
        }
        
        return {
          isValid: true,
          venue: venue,
          city: city,
          country: country
        };
      }
    }

    // Handle city-only resolution
    if (eventData.city) {
      if (typeof eventData.city === 'string') {
        const cityResult = await this.validationService.resolveCityByUrl(eventData.city);
        if (!cityResult.isValid) {
          return {
            isValid: false,
            message: cityResult.message,
          };
        }
        
        const city = cityResult.city;
        let country = city.country_city_countryTocountry;
        
        // Fallback if country relationship not loaded
        if (!country && city.country) {
          country = await this.prisma.country.findUnique({
            where: { id: city.country }
          });
        }
        
        if (!country) {
          return {
            isValid: false,
            message: 'Unable to resolve country for the city'
          };
        }
        
        return {
          isValid: true,
          city: city,
          country: country
        };
      } else {
        const cityId = typeof eventData.city === 'string' ? parseInt(eventData.city) : eventData.city;
        const cityValidation = await this.validationService.validateCity(cityId);
        if (!cityValidation.isValid) {
          return {
            isValid: false,
            message: cityValidation.message,
          };
        }
        
        const city = cityValidation.city;
        let country = city.country_city_countryTocountry;
        
        // Fallback if country relationship not loaded
        if (!country && city.country) {
          country = await this.prisma.country.findUnique({
            where: { id: city.country }
          });
        }
        
        return {
          isValid: true,
          city: city,
          country: country
        };
      }
    }

    return { isValid: true };
  }

    private async processEventTypeUpdateWithUrl(eventData: EventUpsertRequestDto, existingEvent: any): Promise<{
      isValid: boolean;
      message?: string;
      eventType?: number;
      subEventType?: number | null;
      eventTypeArray?: number[];
      eventAudience?: string;
    }> {
      try {
        // Check if user is trying to change from/to business floor 
        const eventTypeInput = eventData.type;
        if (eventTypeInput && Array.isArray(eventTypeInput)) {
          const isCurrentlyBusinessFloor = existingEvent.event_type === 10;
          
          // Resolve the new event type URLs to get their IDs
          const urlResult = await this.validationService.validateEventTypesWithUrl(eventTypeInput);
          if (!urlResult.isValid) {
            return { isValid: false, message: urlResult.message };
          }
          
          const newEventTypeIds = urlResult.eventTypeArray || [];
          const isNewBusinessFloor = newEventTypeIds.includes(10);
          
          if ((isCurrentlyBusinessFloor && !isNewBusinessFloor) || 
              (!isCurrentlyBusinessFloor && isNewBusinessFloor)) {
            return { isValid: false, message: 'you can not change the event type' };
          }
        }

        // Process new event type using URL validation
        let eventTypeValidation: any;
        if (eventTypeInput && Array.isArray(eventTypeInput)) {
          eventTypeValidation = await this.validationService.validateEventTypesWithUrl(eventTypeInput);
        }

        if (!eventTypeValidation || !eventTypeValidation.isValid) {
          return { isValid: false, message: eventTypeValidation?.message || 'Event type validation failed' };
        }

        return {
          isValid: true,
          eventType: eventTypeValidation.eventType,
          subEventType: eventTypeValidation.subEventType,
          eventTypeArray: eventTypeValidation.eventTypeArray,
          eventAudience: eventTypeValidation.eventAudience
        };

      } catch (error) {
        return { isValid: false, message: 'Event type validation failed' };
      }
    }
  
  private async updateEventTypesStandalone(eventId: number, eventTypeIds: number[], userId: number, prisma?: any) {
    const db = prisma || this.prisma;
    await db.event_type_event.updateMany({
      where: { event_id: eventId },
      data: { 
        published: 0,
        modified_by: userId 
      }
    });
  
    // Add/update event types
    for (const typeId of eventTypeIds) {
      const existing = await db.event_type_event.findFirst({
        where: {
          eventtype_id: typeId,
          event_id: eventId
        }
      });
  
      if (existing) {
        await db.event_type_event.update({
          where: { id: existing.id },
          data: { 
            published: 1,
            modified_by: userId 
          }
        });
      } else {
        await db.event_type_event.create({
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
  
    private async processAttachments(
      eventData: EventUpsertRequestDto,
      eventId: number,
      editionId: number,
      userId: number,
      prisma: any
    ): Promise<void> {
      // Process intro video
      if (eventData.introVideo) {
        await this.commonService.processIntroVideo(
          eventId,
          editionId,
          eventData.introVideo,
          userId
        );
      }

      // Process event documents
      if (eventData.docs) {
        await this.commonService.processEventDocuments(
          eventId,
          editionId,
          eventData.docs,
          userId
        );
      }

      // Process brochure
      if (eventData.brochure) {
        await this.commonService.processAttachment(
          eventId,
          editionId,
          eventData.brochure,
          'brochure',
          userId
        );
      }

      if (eventData.logo) {
        await this.commonService.processAttachment(
          eventId,
          editionId,
          eventData.logo,
          'logo',
          userId
        );
      }

      if (eventData.wrapper) {
        await this.commonService.processAttachment(
          eventId,
          editionId,
          eventData.wrapper,
          'wrapper',
          userId
        );
      }

      // Process OG image
      if (eventData.ogImage) {
        await this.commonService.processAttachment(
          eventId,
          editionId,
          eventData.ogImage,
          'event_og_image',
          userId
        );
      }

      // Process customization
      if (eventData.customization) {
        await this.commonService.processCustomization(
          eventId,
          editionId,
          eventData.customization,
          userId
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

    private async processSalesData(
      eventData: EventUpsertRequestDto,
      editionId: number,
      userId: number,
      prisma?: any
    ): Promise<{ valid: boolean; message?: string }> {
      const db = prisma || this.prisma;
      
      try {
        // Only process if salesAction is provided
        if (!eventData.salesAction) {
          return { valid: true };
        }

        // Validate salesAction format
        const actionValidation = this.validationService.validateSalesAction(eventData.salesAction);
        if (!actionValidation.isValid) {
          return { valid: false, message: actionValidation.message };
        }

        // Validate salesActionBy user exists (required when salesAction is provided)
        if (!eventData.salesActionBy) {
          return { 
            valid: false, 
            message: 'salesActionBy is required when salesAction is provided' 
          };
        }

        const userValidation = await this.validationService.validateSalesActionBy(eventData.salesActionBy);
        if (!userValidation.isValid) {
          return { valid: false, message: userValidation.message };
        }

        // Update the edition with sales data
        const updateData: any = {
          sales_action: new Date(eventData.salesAction),
          sales_action_by: eventData.salesActionBy,
          modified: new Date(),
          modifiedby: userId,
        };

        if (eventData.salesStatus) {
          updateData.sales_status = eventData.salesStatus;
        }

        if (eventData.salesRemark) {
          updateData.sales_remark = eventData.salesRemark;
        }

        await db.event_edition.update({
          where: { id: editionId },
          data: updateData
        });

        // Update event_update table if sales_status is provided
        if (eventData.salesStatus) {
          await this.updateEventUpdateSalesStatus(
            eventData.eventId!,
            editionId,
            eventData.salesStatus,
            db
          );
        }

        return { valid: true };
      } catch (error) {
        this.logger.error(`Failed to process sales data:`, error);
        return { 
          valid: false, 
          message: 'Failed to process sales data' 
        };
      }
    }

    private async updateEventUpdateSalesStatus(
      eventId: number,
      editionId: number,
      salesStatus: string,
      prisma?: any
    ): Promise<void> {
      const db = prisma || this.prisma;
      
      try {
        // Use compound unique constraint properly
        const eventUpdate = await db.event_update.findFirst({
          where: {
            event_id: eventId,
            edition: editionId,
          }
        });

        if (eventUpdate) {
          // Get the end_date for the compound unique constraint
          await db.event_update.update({
            where: {
              // Use compound unique constraint: event_id + end_date
              event_id_end_date: {
                event_id: eventId,
                end_date: eventUpdate.end_date,
              }
            },
            data: {
              sales_status: salesStatus,
              modified: new Date(),
            }
          });
          
          this.logger.log(`Updated event_update sales_status for event ${eventId}`);
        } else {
          this.logger.warn(`No event_update record found for event ${eventId}, edition ${editionId}`);
        }
      } catch (error) {
        this.logger.error(`Failed to update event_update sales status:`, error);
      }
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
  
    private shouldSendVisitorEsMessage(eventData: EventUpsertRequestDto): boolean {
      return !!(
        eventData.city || 
        eventData.venue || 
        // eventData.status || 
        eventData.visibility
        // eventData.published !== undefined 
        // eventData.online_event !== undefined
      );
    }
  
    private shouldSendPriorityMessage(eventData: EventUpsertRequestDto): boolean {
      return !!(
        eventData.startDate || 
        eventData.endDate || 
        eventData.type || 
        eventData.visibility
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

  async createEvent(createEventDto: CreateEventRequestDto, userId: number, req?: any): Promise<CreateEventResponseDto> {

    const validationResult = await this.performAllValidations(createEventDto, userId);

    if (!validationResult.isValid) {
      return createErrorResponse(validationResult.messages, validationResult.errors) as CreateEventResponseDto;
    }

    // Extract validated data
    const {
      dateProcessing,
      eventTypeValidation,
      dateValidation,
      locationData,
      categoryData,
      companyData,
      mainEventData
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
          companyData,
          userId,
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
          edition: undefined,
          company: companyData?.company?.id,
          changesMadeBy: userId,
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
            categoryData,
            userId,
            prisma
          );
        }

        let productCategoryIds: number[] = [];
        if (createEventDto.product) {
          try {
            const productResult = await this.commonService.processEventProducts(
              event.id,
              validatedEditionId,
              createEventDto.product,
              userId,
              prisma
            );
            productCategoryIds = productResult.categoryIds;

            // Merge product categories with user categories
            if (createEventDto.category && categoryData?.categoryIds) {
              const allCategories = [...categoryData.categoryIds, ...productCategoryIds];
              const uniqueCategories = [...new Set(allCategories)];
              
              // Update event categories with merged list
              await this.commonService.processEventCategories(
                event.id,
                uniqueCategories,
                userId,
                undefined,
                undefined,
                prisma
              );
            } else if (productCategoryIds.length > 0) {
              // Only save product categories if no user categories
              await this.commonService.saveProductCategories(
                event.id,
                productCategoryIds,
                userId,
                prisma
              );
            }

            this.logger.log(`Processed ${Object.keys(JSON.parse(createEventDto.product)).length} products for event ${event.id}`);
          } catch (error) {
            this.logger.error('Product processing failed:', error);
            throw new Error(`Product processing failed: ${error.message}`);
          }
        }

        // Create Event Data entries
        await this.createEventDataEntries(
          event.id,
          validatedEditionId,
          createEventDto,
          userId,
          prisma
        );

        // Create Contact Entry
        await this.createContactEntry(event.id, userId, prisma);

        await this.createUserEventMapping(event.id, createEventDto, mainEventData, userId, prisma);

        // await this.createEventSettings(event.id, createEventDto, prisma);

        // Create Default Questionnaire
        await this.createDefaultQuestionnaire(event.id, prisma);

        // Handle Event Type Mappings
        await this.createEventTypeAssociations(
          event.id,
          eventTypeValidation.eventTypeArray,
          userId,
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
        userId,
        {
          // description: createEventDto.description,
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
      eventId: eventData.id,
      editionId: editionData.editionId,
    }, 'inserted') as CreateEventResponseDto;

    } catch (postError) {
      this.logger.warn('Post-transaction operations failed', {
        error: postError.message,
        eventId: eventData.id,
      });

      // Still return success since core event was created
      return createSuccessResponse({
        eventId: eventData.id,
        editionId: editionData.editionId,
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


    private async performAllValidations(dto: CreateEventRequestDto, userId: number): Promise<{
      isValid: boolean;
      messages: string[];
      errors: string[];
      validatedData?: {
        dateProcessing: any;
        eventTypeValidation: any;
        dateValidation: any;
        locationData: any;
        categoryData?: any;
        companyData?: any;
        mainEventData?: any;
      };
    }> {
      const messages: string[] = [];
      const errors: string[] = [];
      let validatedData: any = {};

      try {
        // Step 1: Basic validations
        const userValidation = await this.validationService.validateUser(userId);
        if (!userValidation.isValid) {
          messages.push(userValidation.message ?? 'Unknown user validation error');
        }

        if (dto.mainEvent) {
          const mainEventValidation = await this.validationService.validateMainEvent(dto.mainEvent);
          if (!mainEventValidation.isValid) {
            messages.push(mainEventValidation.message ?? 'Unknown main event validation error');
          } else {
            validatedData.mainEventData = mainEventValidation;
          }
        }

        if (dto.category && dto.category.length > 0) {
          const categoryValidation = await this.validationService.resolveCategoriesByUrl(dto.category);
          if (!categoryValidation.isValid) {
            messages.push(categoryValidation.message ?? 'Unknown category validation error');
          } else {
            validatedData.categoryData = categoryValidation;
          }
        }

        // Step 2: Process and validate dates
        const dateProcessing = this.validationService.processDates(
          dto.startDate,
          dto.endDate
        );
        validatedData.dateProcessing = dateProcessing;

        // Step 3: Validate event type - only handle arrays now
        const eventTypeValidation = await this.validationService.validateEventTypesWithUrl(dto.type);

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

          const now = new Date();
          const startDate = new Date(dateProcessing.processedStartDate);
          const endDate = new Date(dateProcessing.processedEndDate);
          
          if (startDate < now || endDate < now) {
            messages.push('Event dates must be in the future for new events');
          }
        }

        // Step 5: Location validation
        const locationData = await this.resolveLocation(dto);
        if (!locationData.isValid) {
          messages.push(locationData.message ?? 'Unknown location error');
        } else {
          validatedData.locationData = locationData;
        }

        if (dto.company) {
          const companyValidation = await this.validationService.validateCompany(dto.company);
          if (!companyValidation.isValid) {
            messages.push(companyValidation.message ?? 'Unknown company validation error');
          } else {
            validatedData.companyData = companyValidation;
          }
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

  private mapEventTypeToArray(types: string[], typeVal?: string): number[] {
    let eventTypes: number[] = [];
    
    if (typeVal) {
      eventTypes = typeVal.split(',').map(Number).filter(Boolean);
    }

    const typeMapping = {
      'tradeshow': 1,
      'conference': 2,
      'workshop': 3,
      'meetup': 4,
      'business-floor': 10,
    };

    for (const type of types) {
      const mappedType = typeMapping[type];
      if (mappedType) {
        eventTypes.push(mappedType);
      }
    }

    return [...new Set(eventTypes)]; 
  }

  private async processSubVenues(
    eventId: number,
    editionId: number,
    eventData: EventUpsertRequestDto,
    userId: number,
    tx: any
  ): Promise<void> {
    try {
      // Type safety check
      if (!eventData.subVenue || typeof eventData.subVenue !== 'string') {
        this.logger.warn(`SubVenue processing skipped for event ${eventId}: invalid subVenue data`);
        return;
      }

      this.logger.log(`Starting subVenue processing for event ${eventId}, edition ${editionId}`);
      this.logger.log(`SubVenue data: ${eventData.subVenue}`);

      // Get venue ID from multiple sources
      let venueId: number | undefined;
      
      // 1. Check if venue was updated in this request
      if (eventData.venue) {
        this.logger.log(`Venue found in request data: ${eventData.venue}`);
        if (typeof eventData.venue === 'number') {
          venueId = eventData.venue;
        } else if (typeof eventData.venue === 'string' && this.isNumeric(eventData.venue)) {
          venueId = parseInt(eventData.venue);
        }
        this.logger.log(`Parsed venue ID from request: ${venueId}`);
      } else {
        this.logger.log(`No venue in request data, checking database...`);
      }
      
      // 2. If no venue in request, get from current edition
      if (!venueId) {
        this.logger.log(`Checking current edition ${editionId} for venue...`);
        const currentEdition = await tx.event_edition.findUnique({
          where: { id: editionId },
          select: { venue: true }
        });
        venueId = currentEdition?.venue || undefined;
        this.logger.log(`Current edition venue: ${venueId}`);
      }
      
      // 3. If still no venue, get from main event's current edition
      if (!venueId) {
        this.logger.log(`Checking main event ${eventId} for venue...`);
        const event = await tx.event.findUnique({
          where: { id: eventId },
          include: {
            event_edition_event_event_editionToevent_edition: {
              select: { venue: true }
            }
          }
        });
        venueId = event?.event_edition_event_event_editionToevent_edition?.venue || undefined;
        this.logger.log(`Main event current edition venue: ${venueId}`);
      }

      if (!venueId) {
        this.logger.warn(`SubVenue processing skipped for event ${eventId}: no venue found after checking all sources`);
        
        // Let's also check what data we actually have
        const debugEvent = await tx.event.findUnique({
          where: { id: eventId },
          include: {
            event_edition_event_event_editionToevent_edition: {
              select: { 
                id: true,
                venue: true,
                city: true,
                company_id: true 
              }
            }
          }
        });
        
        this.logger.log(`Debug - Event data:`, {
          eventId: debugEvent?.id,
          currentEdition: debugEvent?.event_edition_event_event_editionToevent_edition
        });
        
        return;
      }

      this.logger.log(`Using venue ID: ${venueId} for subVenue processing`);

      // Process sub-venues using CommonService
      const result = await this.commonService.processSubVenues(
        eventId,
        editionId,
        eventData.subVenue,
        venueId,
        userId,
        tx
      );

      if (result.valid) {
        this.logger.log(`Successfully processed ${result.subVenueIds?.length || 0} sub-venues for event ${eventId}`);
      } else {
        this.logger.warn(`SubVenue processing failed for event ${eventId}: ${result.message}`);
      }
    } catch (error) {
      this.logger.error(`SubVenue processing error for event ${eventId}:`, error);
      // Don't throw - this is not critical enough to fail the entire update
    }
  }

  // Add this helper method if it doesn't exist:
  private isNumeric(value: any): boolean {
    return !isNaN(Number(value)) && !isNaN(parseFloat(value.toString()));
  }

  private async processEventSettings(
    eventId: number,
    settingsData: string,
    userId: number,
    prisma?: any
  ): Promise<{ valid: boolean; message?: string }> {
    const db = prisma || this.prisma;
    
    try {
      if (!settingsData || settingsData.trim() === '') {
        return { valid: true };
      }

      // Validate using ValidationService
      const validation = this.validationService.validateEventSettings(settingsData);
      if (!validation.isValid) {
        return { valid: false, message: validation.message };
      }

      const settings = validation.settings;

      // Check if event settings already exist
      const existingSettings = await db.event_settings.findFirst({
        where: { event_id: eventId }
      });

      if (existingSettings) {
        // Update existing settings
        const updateData: any = {
          modified: new Date(),
          modified_by: userId,
        };

        // Map camelCase to snake_case and update only provided fields
        if (settings.autoApproval !== undefined) updateData.auto_approval = settings.autoApproval;
        if (settings.regStartDate) updateData.reg_start_date = new Date(settings.regStartDate);
        if (settings.regEndDate) updateData.reg_end_date = new Date(settings.regEndDate);
        if (settings.capacity !== undefined) updateData.capacity = settings.capacity;

        await db.event_settings.update({
          where: { id: existingSettings.id },
          data: updateData
        });
      } else {
        // Create new settings
        await db.event_settings.create({
          data: {
            event_id: eventId,
            created_by: userId,
            auto_approval: settings.autoApproval ?? 0,
            reg_start_date: settings.regStartDate ? new Date(settings.regStartDate) : null,
            reg_end_date: settings.regEndDate ? new Date(settings.regEndDate) : null,
            capacity: settings.capacity ?? null,
          }
        });
      }

      return { valid: true };
    } catch (error) {
      this.logger.error(`Failed to process event settings for event ${eventId}:`, error);
      return { 
        valid: false, 
        message: 'Failed to process event settings' 
      };
    }
  }

  private async resolveLocation(dto: CreateEventRequestDto) {
    try {
      let cityId: number | null = null;
      let countryId: string | null = null;
      let venueId: number | null = null;

      if (dto.venue) {
        if (typeof dto.venue === 'string') {
          const venueResult = await this.validationService.resolveVenueByUrl(dto.venue);
          if (!venueResult.isValid) {
            return {
              isValid: false,
              message: venueResult.message,
            };
          }
          
          venueId = venueResult.venue!.id;
          cityId = venueResult.venue!.city;
          countryId = venueResult.venue!.country;
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
      } 
      else if (dto.city) {
        if (typeof dto.city === 'string') {
          const cityResult = await this.validationService.resolveCityByUrl(dto.city);
          if (!cityResult.isValid) {
            return {
              isValid: false,
              message: cityResult.message,
            };
          }
          
          cityId = cityResult.city!.id;
          countryId = cityResult.city!.country;
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
      } 
      if (dto.country && typeof dto.country === 'string') {
        const countryResult = await this.validationService.resolveCountryByUrl(dto.country);
        if (!countryResult.isValid) {
          return {
            isValid: false,
            message: countryResult.message,
          };
        }
        
        if (countryId && countryId !== countryResult.country!.id) {
          return {
            isValid: false,
            message: `City and country do not match. City is in "${countryId}" but country provided is "${dto.country}"`,
          };
        }
        
        if (!cityId) {
          return {
            isValid: false,
            message: 'City is required - cannot create event with only country',
          };
        }
      }

      if (!cityId) {
        return {
          isValid: false,
          message: 'Either venue or city must be provided',
        };
      }

      if (!countryId) {
        return {
          isValid: false,
          message: 'Could not resolve country ID',
        };
      }

      // Validate that the country exists
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
    companyData: any,
    userId: number,
    prisma: any
  ) {
    // const typeMapping = {
    //   'tradeshow': { eventType: 1, subEventType: null },
    //   'conference': { eventType: 2, subEventType: null },
    //   'workshop': { eventType: 3, subEventType: null },
    //   'meetx': { eventType: 3, subEventType: 1 },
    //   'business floor': { eventType: 10, subEventType: null },
    // };

    // const { eventType, subEventType } = typeMapping[dto.type];

    const eventType = eventTypeValidation.eventType;
    const subEventType = eventTypeValidation.subEventType || null;

    // let functionality = 'open';
    // if (dto.public === 'yes') functionality = 'draft';
    // if (dto.public === 'no') functionality = 'private';
    // if (dto.functionality === 'open') {
    //   functionality = 'open';
    // } else if (dto.functionality === 'draft') {
    //   functionality = 'draft';
    // }

    if (!locationData.cityId || !locationData.countryId) {
      throw new Error(`Both city and country are required. Got city: ${locationData.cityId}, country: ${locationData.countryId}`);
    }

    const eventData = await prisma.event.create({
      data: {
        name: dto.name,                                    
        city: locationData.cityId,                         
        country: locationData.countryId,
        event_type: eventType,
        // mail_type: 1, 
        published: true,
        // adsense: false,
        created: new Date(),
        abbr_name: dto.abbrName || null,
        // zh_name: null,
        // native_name: null,
        event_edition: null,
        start_date: new Date(dateProcessing.processedStartDate),
        end_date: new Date(dateProcessing.processedEndDate),
        website: dto.website || null,
        // frequency: null,
        url: null,
        redirect_url: null,
        // membership: 0,
        // app_id: null,
        // verified: null,
        // verifiedby: null,
        // status: null,
        modified: new Date(),
        createdby: userId,
        modifiedby: null,
        wrapper: null,
        logo: null,
        // wrapper_small: null,
        // host: null,
        // hotel_id: null,
        // punchline: null,
        validation: 0,
        // onboard_date: null,
        concurrent: 0,
        // duplicate: null,
        // badge_initial_id: null,
        tags: null,
        score: 0,
        // hotel_id2: null,
        // ios_url: null,
        // android_url: null,
        brand_id: null,
        // zh_published: false,
        functionality: dto.visibility || 'draft',
        multi_city: 0,
        // remark: null,
        // group_id: null,
        sub_event_type: subEventType,
        // online_event: dto.online_event || null,
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
    
    eventUrl = `event/${eventId}`;

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
    validatedCategoryData: any, 
    userId: number,
    prisma: any
  ) {
    try {
      if (!validatedCategoryData || !validatedCategoryData.categoryIds) {
        return; 
      }

      const categoryIds = validatedCategoryData.categoryIds;

      for (const categoryId of categoryIds) {
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
    userId: number,
    prisma: any
  ) {
    try {
      const eventDataEntries: Array<{ dataType: string; title: string; value: string }> = [];

      // if (dto.description) {
      //   eventDataEntries.push({
      //     dataType: 'TEXT',
      //     title: 'desc',
      //     value: dto.description,
      //   });
      // }

      // if (dto.short_desc) {
      //   eventDataEntries.push({
      //     dataType: 'TEXT',
      //     title: 'short_desc',
      //     value: dto.short_desc,
      //   });
      // }

      // if (dto.og_image) {
      //   eventDataEntries.push({
      //     dataType: 'ATTACHMENT',
      //     title: 'event_og_image',
      //     value: dto.og_image,
      //   });
      // }

      // eventDataEntries.push({
      //   dataType: 'Bool',
      //   title: 'year_block',
      //   value: dto.yearBlock ? '1' : '0',
      // });

      // eventDataEntries.push({
      //   dataType: 'Bool',
      //   title: 'intro_block',
      //   value: dto.introBlock ? '1' : '0',
      // });

      // if (dto.customization) {
      //   const processedCustomization = await this.processCustomizationData(
      //     dto.customization, 
      //     eventId
      //   );
        
      //   eventDataEntries.push({
      //     dataType: 'JSON',
      //     title: 'customization',
      //     value: processedCustomization,
      //   });
      // }

      for (const entry of eventDataEntries) {
        await prisma.event_data.create({
          data: {
            event: eventId,
            event_edition: editionId,
            data_type: entry.dataType,
            title: entry.title,
            value: entry.value,
            published: true,
            createdby: userId,
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

  private async createUserEventMapping(eventId: number, dto: CreateEventRequestDto, mainEventData: any, userId: number, prisma: any) {
    try {
      const existingMapping = await prisma.user_event_mapping.findFirst({
        where: {
          event: mainEventData?.event?.id || eventId, // Use main event ID if provided
          user_event: mainEventData?.event ? eventId : null, // Set user_event only if main event exists
        }
      });

      if (existingMapping) {
        await prisma.user_event_mapping.update({
          where: { id: existingMapping.id },
          data: { 
            published: 1,
            modified: new Date(),
            modified_by: userId,
          }
        });
      } else {
        await prisma.user_event_mapping.create({
          data: {
            event: mainEventData?.event?.id || eventId, // Main event ID or current event ID
            user_event: mainEventData?.event ? eventId : null, // Sub-event ID if main event exists
            published:  1,
            created: new Date(),
            created_by: userId,
          }
        });
      }
    } catch (error) {
      this.logger.error('User event mapping error:', error);
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
    eventTypes: number[], 
    userId: number, 
    prisma: any
  ): Promise<void> {
    this.logger.debug(`Creating event type associations for event ${eventId}:`, eventTypes);
    
    if (!eventTypes || eventTypes.length === 0) {
      this.logger.warn(`No event types provided for event ${eventId}`);
      return;
    }

    try {
      for (const typeId of eventTypes) {
        this.logger.debug(`Processing event type ${typeId} for event ${eventId}`);
        
        // Validate that the type ID exists
        const eventType = await prisma.event_type.findUnique({
          where: { id: typeId },
          select: { id: true, parent_id: true, name: true }
        });

        if (!eventType) {
          this.logger.warn(`Event type ${typeId} not found in database`);
          continue;
        }

        this.logger.debug(`Found event type: ${eventType.name} (${typeId})`);

        const typesToCreate = [typeId];
        if (eventType.parent_id) {
          const parentIds = eventType.parent_id.split(',').map(id => parseInt(id.trim())).filter(Boolean);
          typesToCreate.push(...parentIds);
          this.logger.debug(`Adding parent types: ${parentIds}`);
        }

        // Create event_type_event records
        for (const typeToCreate of typesToCreate) {
          try {
            // FIXED: Use correct unique constraint name based on your schema
            const result = await prisma.event_type_event.upsert({
              where: {
                eventtype_id: { // This should match your actual unique constraint
                  eventtype_id: typeToCreate,
                  event_id: eventId,
                }
              },
              update: {
                modified: new Date(),
                modified_by: userId,
              },
              create: {
                eventtype_id: typeToCreate,
                event_id: eventId,
                published: 1,
                created_by: userId,
              }
            });
            
            this.logger.debug(`Created/updated event_type_event: ${typeToCreate} -> ${eventId}`);
          } catch (error) {
            // If upsert fails, try direct create (in case unique constraint is different)
            try {
              await prisma.event_type_event.create({
                data: {
                  eventtype_id: typeToCreate,
                  event_id: eventId,
                  published: 1,
                  created_by: userId,
                }
              });
              this.logger.debug(`Created event_type_event: ${typeToCreate} -> ${eventId}`);
            } catch (createError) {
              this.logger.error(`Failed to create event_type_event for type ${typeToCreate}:`, createError);
            }
          }
        }
      }

      this.logger.log(`Event type associations completed for event ${eventId}`);
    } catch (error) {
      this.logger.error(`Failed to create event type associations for event ${eventId}:`, error);
      throw error;
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