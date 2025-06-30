import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../../common/s3.service'; 
import { PipedriveService } from '../../common/pipedrive.service';
import { EventESDocument } from '../../elasticsearch/elasticsearch.service';

interface SubVenueInput {
  id?: number;
  name?: string;
}

interface StatsStructure {
  exhibitor: {
    total_count: string | number;
    total_audited: number;
    international_count: string;
    international_audited: number;
    domestic_count: string;
    domestic_audited: number;
  };
  visitor: {
    total_count: string | number;
    total_audited: number;
    international_count: string;
    international_audited: number;
    domestic_count: string;
    domestic_audited: number;
  };
  area: {
    total_area: string | number;
    total_audited: number;
    international_area: string;
    international_audited: number;
    domestic_area: string;
    domestic_audited: number;
  };
}

interface ContactData {
  email: string;
  website?: string;
  verifiedBy?: number;
}

@Injectable()
export class CommonService {
  private readonly logger = new Logger(CommonService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
    private readonly pipedriveservice: PipedriveService

  ) {}

  // Process intro video attachment
  async processIntroVideo(
    eventId: number,
    editionId: number,
    videoUrl: string,
    userId: number
  ): Promise<{ valid: boolean; message?: string; attachmentId?: number }> {
    try {
      if (videoUrl === 'delete') {
        // Delete intro video
        await this.deleteIntroVideo(eventId, editionId);
        return { valid: true, message: 'Intro video deleted' };
      }

      // Find or create attachment
      let attachment = await this.prisma.attachment.findFirst({
        where: { cdn_url: videoUrl }
      });

      if (!attachment) {
        attachment = await this.prisma.attachment.create({
          data: {
            file_type: 'video',
            value: videoUrl,
            cdn_url: videoUrl,
            published: true,
            createdby: userId,
          }
        });
      }

      // Create event data entry
      await this.upsertEventData(
        eventId,
        editionId,
        'introvideo',
        'ATTACHMENT',
        attachment.id.toString(),
        userId
      );

      return { 
        valid: true, 
        message: 'Intro video processed',
        attachmentId: attachment.id 
      };
    } catch (error) {
      return { valid: false, message: 'Failed to process intro video' };
    }
  }

  // Delete intro video and related feeds
  async deleteIntroVideo(eventId: number, editionId: number): Promise<void> {
    // Delete event data
    const introVideoData = await this.prisma.event_data.findFirst({
      where: {
        event: eventId,
        event_edition: editionId,
        title: 'intro_video'
      }
    });

    if (introVideoData) {
      await this.prisma.event_data.delete({
        where: { id: introVideoData.id }
      });

      // Delete related feed if exists
      const feedData = await this.prisma.event_feeds.findFirst({
        where: {
          event: eventId,
          edition: editionId,
          source: 'event_intro_video'
        }
      });

      if (feedData) {
        // Delete feed tags first
        await this.prisma.$executeRaw`
          DELETE FROM feed_tag WHERE feed_id = ${feedData.id}
        `;

        // Delete feed
        await this.prisma.event_feeds.delete({
          where: { id: feedData.id }
        });
      }
    }
  }

  // Process event documents
  async processEventDocuments(
    eventId: number,
    editionId: number,
    documentIds: string,
    userId: number
  ): Promise<{ valid: boolean; message?: string }> {
    try {
      // Validate attachment IDs
      const attachmentIds = documentIds.split(',').map(id => parseInt(id.trim()));
      
      const validAttachments = await this.prisma.attachment.findMany({
        where: { id: { in: attachmentIds } }
      });

      if (validAttachments.length !== attachmentIds.length) {
        return { valid: false, message: 'Some attachment IDs are invalid' };
      }

      // Create or update event data
      await this.upsertEventData(
        eventId,
        editionId,
        'event_documents',
        'TEXT',
        documentIds,
        userId
      );

      return { valid: true, message: 'Event documents processed' };
    } catch (error) {
      return { valid: false, message: 'Failed to process event documents' };
    }
  }

  // Delete event documents 
  async deleteEventDocuments(
    eventId: number,
    editionId: number,
    deleteIds: string
  ): Promise<{ valid: boolean; message?: string }> {
    try {
      const idsToDelete = deleteIds.split(',').map(id => parseInt(id.trim()));

      // Get current event documents
      const eventData = await this.prisma.event_data.findFirst({
        where: {
          event: eventId,
          event_edition: editionId,
          title: 'event_documents'
        }
      });

      if (!eventData) {
        return { valid: true, message: 'No documents found' };
      }

      const currentIds = eventData.value ? eventData.value.split(',').map(id => parseInt(id.trim())) : [];
      const updatedIds = currentIds.filter(id => !idsToDelete.includes(id));

      if (updatedIds.length === 0) {
        // Delete the event data entry if no documents left
        await this.prisma.event_data.delete({
          where: { id: eventData.id }
        });
      } else {
        // Update with remaining document IDs
        await this.prisma.event_data.update({
          where: { id: eventData.id },
          data: {
            value: updatedIds.join(','),
            modified: new Date()
          }
        });
      }

      return { valid: true, message: 'Documents deleted successfully' };
    } catch (error) {
      return { valid: false, message: 'Failed to delete documents' };
    }
  }

  // Process customization with banner image
  async processCustomization(
    eventId: number,
    editionId: number,
    customizationData: string,
    userId: number
  ): Promise<{ valid: boolean; message?: string }> {
    try {
      const customization = JSON.parse(customizationData);

      // Process banner image using S3 service
      const processedCustomization = await this.s3Service.processCustomizationBannerImage(
        customization,
        eventId
      );

      // Save customization data
      await this.upsertEventData(
        eventId,
        editionId,
        'customization',
        'ATTACHMENT',
        JSON.stringify(processedCustomization),
        userId
      );

      return { valid: true, message: 'Customization processed' };
    } catch (error) {
      return { valid: false, message: 'Failed to process customization' };
    }
  }

  // // Process base64 image and upload 
  // private async processBase64Image(
  //   base64Data: string,
  //   eventId: number,
  //   type: string
  // ): Promise<string | null> {
  //   try {
  //     // Extract image data
  //     const matches = base64Data.match(/^data:image\/([a-zA-Z]*);base64,(.+)$/);
  //     if (!matches || matches.length !== 3) {
  //       return null;
  //     }

  //     const imageType = matches[1];
  //     const imageData = matches[2];
      
  //     // Need to implement:
  //     // 1. Decode base64 to buffer
  //     // 2. Upload to S3/CDN
  //     // 3. Return the CDN URL
      
  //     const fileName = `${eventId}_${type}_${Date.now()}.${imageType}`;
  //     const cdnUrl = `https://cdn.10times.com/uploads/${fileName}`;
      
  //     return cdnUrl;
  //   } catch (error) {
  //     return null;
  //   }
  // }

  // Process other attachments (brochure, og_image, etc.)
  async processAttachment(
    eventId: number,
    editionId: number,
    attachmentId: number,
    title: string,
    userId: number
  ): Promise<{ valid: boolean; message?: string }> {
    try {
      // Validate attachment exists
      const attachment = await this.prisma.attachment.findUnique({
        where: { id: attachmentId }
      });

      if (!attachment) {
        return { valid: false, message: 'Attachment not found' };
      }

      // Save attachment reference
      await this.upsertEventData(
        eventId,
        editionId,
        title,
        'ATTACHMENT',
        attachmentId.toString(),
        userId
      );

      return { valid: true, message: `${title} processed` };
    } catch (error) {
      return { valid: false, message: `Failed to process ${title}` };
    }
  }

  // Common method to upsert event data
  private async upsertEventData(
    eventId: number,
    editionId: number,
    title: string,
    dataType: string,
    value: string,
    userId: number
  ): Promise<void> {
    const existing = await this.prisma.event_data.findFirst({
      where: {
        event: eventId,
        event_edition: editionId,
        title: title
      }
    });

    if (existing) {
      await this.prisma.event_data.update({
        where: { id: existing.id },
        data: {
          value: value,
          modifiedby: userId,
          modified: new Date(),
          published: title === 'introvideo' ? true : existing.published
        }
      });
    } else {
      await this.prisma.event_data.create({
        data: {
          event: eventId,
          event_edition: editionId,
          title: title,
          data_type: dataType,
          value: value,
          createdby: userId,
          published: title === 'introvideo' ? true : false
        }
      });
    }
  }

  // Generate wrapper image (placeholder)
  async generateWrapperImage(eventId: number): Promise<{ valid: boolean; attachmentId?: number }> {
    try {
      
      const wrapperAttachment = await this.prisma.attachment.create({
        data: {
          file_type: 'image',
          value: `wrapper_${eventId}_${Date.now()}.jpg`,
          cdn_url: `https://cdn.10times.com/wrappers/wrapper_${eventId}.jpg`,
          title: 'Auto-generated wrapper',
          published: true,
          createdby: 1, // System generated
        }
      });

      return { valid: true, attachmentId: wrapperAttachment.id };
    } catch (error) {
      return { valid: false };
    }
  }

  async validateContactEmails(
    contacts: ContactData[],
    restrictionLevel: string = 'vendor'
  ): Promise<{ valid: boolean; message?: string }> {
    try {
      const emails = contacts.map(contact => contact.email);

      // Check domain blacklist
      const blacklistedDomains = await this.prisma.blacklist_domains.findMany({
        where: {
          domain: {
            in: emails.map(email => email.split('@')[1])
          }
        }
      });

      if (blacklistedDomains.length > 0) {
        const blacklistedEmails = emails.filter(email => 
          blacklistedDomains.some(bd => email.endsWith('@' + bd.domain))
        );

        return {
          valid: false,
          message: `Sorry, ${blacklistedEmails.join(', ')} is not allowed.`
        };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, message: 'Contact validation failed' };
    }
  }

  // Add contacts to event 
  async addEventContacts(
    eventId: number,
    contactsData: string,
    userId: number
  ): Promise<{ valid: boolean; message?: string }> {
    try {
      const contacts: ContactData[] = JSON.parse(contactsData);
      const pipedriveData: Array<{ userId: number; companyId: number }> = [];

      // Get event with edition and company info
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        include: {
          event_edition_event_event_editionToevent_edition: {
            select: {
              id: true,
              company_id: true,
            }
          },
        },
      });

      if (!event) {
        return { valid: false, message: 'Event not found' };
      }

      const companyId = event.event_edition_event_event_editionToevent_edition?.company_id;
      let company: { id: number; name: string; published: boolean | null } | null = null;

      // Get company details if companyId exists
      if (companyId) {
        company = await this.prisma.company.findUnique({
          where: { id: companyId },
          select: {
            id: true,
            name: true,
            published: true,
          }
        });
      }

      for (const contactData of contacts) {
        // Find or create user
        let user = await this.prisma.user.findUnique({
          where: { email: contactData.email }
        });

        if (!user) {
          // Create new user
          user = await this.prisma.user.create({
            data: {
              email: contactData.email,
              createdby: userId,
              published: false,
            }
          });
        }

        // Check if contact already exists
        const existingContact = await this.prisma.contact.findFirst({
          where: {
            entity_type: 1,
            entity_id: eventId,
            user_reference: user.id,
          }
        });

        const metadata = {
          label: 'Event Manager',
          phone: '',
          website: contactData.website || ''
        };

        if (!existingContact) {
          // Create new contact
          await this.prisma.contact.create({
            data: {
              entity_type: 1,
              entity_id: eventId,
              user_reference: user.id,
              metadata: JSON.stringify(metadata),
              notification: 10,
              createdby: userId,
              published: 1,
              show_phone: 0,
              is_stall: false,
              is_visitor: false,
              ...(contactData.verifiedBy && {
                verified_on: new Date(),
                verified_by: contactData.verifiedBy,
              }),
            }
          });
        } else {
          // Update existing contact
          await this.prisma.contact.update({
            where: {
              id: existingContact.id,
            },
            data: {
              metadata: JSON.stringify(metadata),
              modified: new Date(),
              modifiedby: userId,
              ...(contactData.verifiedBy && {
                verified_on: new Date(),
                verified_by: contactData.verifiedBy,
              }),
            }
          });
        }

        // Prepare Pipedrive data if company exists and is published
        if (company && company.published) {
          pipedriveData.push({
            userId: user.id,
            companyId: company.id,
          });
        }
      }

      // Process Pipedrive relationships
      if (pipedriveData.length > 0) {
        const pipedriveResult = await this.pipedriveservice.insertContact(pipedriveData);
        
        if (pipedriveResult.success) {
          this.logger.log(`Pipedrive relationships processed: ${pipedriveResult.processedCount}`);
        } else {
          this.logger.warn(`Pipedrive processing failed: ${pipedriveResult.message}`);
        }
      }

      return { valid: true };
    } catch (error) {
      this.logger.error('Failed to add contacts:', error);
      return { valid: false, message: 'Failed to add contacts' };
    }
  }

  // Delete event contacts 
  async deleteEventContacts(
    eventId: number,
    contactsData: string,
    userId: number
  ): Promise<{ valid: boolean; message?: string }> {
    try {
      const contacts: { email: string }[] = JSON.parse(contactsData);

      for (const contactData of contacts) {
        const user = await this.prisma.user.findUnique({
          where: { email: contactData.email }
        });

        if (user) {
          await this.prisma.$executeRaw`
            DELETE FROM contact 
            WHERE entity_type = 1 
            AND entity_id = ${eventId} 
            AND user_reference = ${user.id}
          `;
        }
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, message: 'Failed to delete contacts' };
    }
  }

  // Create shareable URL for visitor
  async createShareableUrl(
    eventId: number,
    userId: number
  ): Promise<string | null> {
    try {
      // Check if visitor exists
      const visitor = await this.prisma.event_visitor.findFirst({
        where: {
          event_event_visitor_eventToevent: { id: eventId },
          user: userId
        }
      });

      if (visitor) {
        // Create encrypted visitor URL 
        const visitorData = `ev_${eventId}_${visitor.id}`;
        const encryptedData = Buffer.from(visitorData).toString('base64');
        return `https://10times.com/evinterest/${encryptedData}`;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async transformEventForES(eventId: number): Promise<EventESDocument> {
    try {
      this.logger.log(`Transforming event ${eventId} for Elasticsearch`);

      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        include: {
          event_edition_event_event_editionToevent_edition: {
            include: {
              venue_event_edition_venueTovenue: true,
            },
          },
          city_event_cityTocity: true,
          country_event_countryTocountry: true,
          event_category_event_category_eventToevent: {
            include: {
              category_event_category_categoryTocategory: true,
            },
          },
        },
      });

      if (!event || !event.event_edition_event_event_editionToevent_edition) {
        throw new Error(`Event ${eventId} not found for ES indexing`);
      }

      const edition = event.event_edition_event_event_editionToevent_edition;
      const venue = edition?.venue_event_edition_venueTovenue;
      const city = event.city_event_cityTocity;
      const country = event.country_event_countryTocountry;

      let company: { id: number; name: string } | null = null;
      if (edition.company_id) {
        company = await this.prisma.company.findUnique({
          where: { id: edition.company_id },
          select: { id: true, name: true }
        });
      }

      const startDate = this.formatDateForES(event.start_date);
      const endDate = this.formatDateForES(event.end_date);

      let geoLocation: { lat: number; lon: number } | null = null;
      if (venue?.geo_lat && venue?.geo_long) {
        geoLocation = { 
          lat: parseFloat(venue.geo_lat.toString()), 
          lon: parseFloat(venue.geo_long.toString()) 
        };
      } else if (city?.geo_lat && city?.geo_long) {
        geoLocation = { 
          lat: parseFloat(city.geo_lat.toString()), 
          lon: parseFloat(city.geo_long.toString()) 
        };
      }

      const eventTypeMap: Record<number, string> = {
        1: 'Tradeshow',
        2: 'Conference', 
        3: 'Workshop',
        10: 'Business Floor'
      };
      const eventTypeName = eventTypeMap[event.event_type] || 'Conference';

      const eventAudience: string[] = [];
      if (event.event_audience) {
        const audienceStr = event.event_audience.toString();
        if (audienceStr.length > 1 && audienceStr[1] === '1') {
          eventAudience.push('b2b');
        }
        if (audienceStr.length > 2 && audienceStr[2] === '1') {
          eventAudience.push('b2c');
        }
      }

      const eventTypeEvents = await this.prisma.event_type_event.findMany({
        where: { 
          event_id: eventId, 
          published: 1 
        }
      });

      const eventTypeNew = [eventTypeName];
      
      for (const ete of eventTypeEvents) {
        try {
          const eventType = await this.prisma.event_type.findUnique({
            where: { id: ete.eventtype_id },
            select: { name: true }
          });
          if (eventType?.name && !eventTypeNew.includes(eventType.name)) {
            eventTypeNew.push(eventType.name);
          }
        } catch (error) {
          this.logger.warn(`Could not fetch event_type ${ete.eventtype_id}: ${error.message}`);
        }
      }

      const categories = event.event_category_event_category_eventToevent
        .map(ec => ec.category_event_category_categoryTocategory?.name)
        .filter(Boolean) as string[];

      const eventData = await this.getEventData(eventId, edition.id);

      const editionData = await this.getEditionData(eventId);

      const esDocument: EventESDocument = {
        id: event.id,
        name: event.name,
        event_type: eventTypeName,
        start_date: startDate,
        end_date: endDate,
        published: Boolean(event.published),
        edition: edition.id,
        abbr_name: event.abbr_name || undefined,
        status: event.status || 'A',
        functionality: event.functionality || 'open',
        url: event.url || undefined,
        city: event.city,
        city_name: city?.name || '',
        country: event.country,
        country_name: country?.name || '',
        company: company?.id || undefined,
        company_name: company?.name || undefined,
        venue: edition.venue || undefined,
        venue_name: venue?.name || undefined,
        website: event.website || undefined,
        geo_location: geoLocation ?? undefined,
        event_audience: eventAudience,
        event_type_new: eventTypeNew,
        multi_city: event.multi_city || 0,
        online_event: event.online_event || undefined,
        
        categories: categories,
        description: eventData.description,
        short_desc: eventData.short_desc,
        stats: eventData.stats,
        timing: eventData.timing,
        highlights: eventData.highlights,
        social_media: {
          facebook: edition.facebook_id ?? undefined,
          twitter: edition.twitter_id ?? undefined,
          linkedin: edition.linkedin_id ?? undefined,
        },
        edition_data: editionData,
      };

      this.logger.log(`Transformed event ${eventId} for ES: ${esDocument.name}`);
      return esDocument;

    } catch (error) {
      this.logger.error(`Failed to transform event ${eventId} for ES:`, error.message);
      throw error;
    }
  }

  
  private formatDateForES(date: Date | null): string {
    if (!date) return '';
    
    return date.toISOString().split('T')[0];
  }


  private formatDateTimeForES(date: Date | null): number | undefined {
    if (!date) return undefined;
    
    return Math.floor(date.getTime() / 1000);
  }

  private async getEventData(eventId: number, editionId: number): Promise<{
    description?: string;
    short_desc?: string;
    stats?: any;
    timing?: any[];
    highlights?: string[];
  }> {
    try {
      const eventDataRecords = await this.prisma.event_data.findMany({
        where: {
          event: eventId,
          event_edition: editionId,
          published: true,
          title: {
            in: ['desc', 'short_desc', 'stats', 'timing', 'event_highlights']
          }
        }
      });

      const result: any = {};

      for (const record of eventDataRecords) {
        switch (record.title) {
          case 'desc':
            result.description = record.value;
            break;
          case 'short_desc':
            result.short_desc = record.value;
            break;
          case 'stats':
            try {
              result.stats = record.value ? JSON.parse(record.value) : undefined;
            } catch {
            }
            break;
          case 'timing':
            try {
              result.timing = record.value ? JSON.parse(record.value) : undefined;
            } catch {
              // Invalid JSON, skip
            }
            break;
          case 'event_highlights':
            try {
              result.highlights = record.value ? JSON.parse(record.value) : undefined;
            } catch {
              // Invalid JSON, skip
            }
            break;
        }
      }

      return result;
    } catch (error) {
      this.logger.warn(`Failed to get event data for ${eventId}:`, error.message);
      return {};
    }
  }

  private async getEditionData(eventId: number): Promise<any[]> {
    try {
      const editions = await this.prisma.event_edition.findMany({
        where: { event: eventId },
        include: {
          venue_event_edition_venueTovenue: {
            select: {
              id: true,
              name: true,
              city: true,
            }
          }
        },
        orderBy: { created: 'desc' }
      });

      const editionData: Array<{
        id: number;
        start_date?: string;
        end_date?: string;
        venue_id: number | null;
        venue_name?: string;
        city_id: number | null;
        city_name?: string;
        company_id: number | null;
        company_name?: string;
        edition_number: number | null;
        visitors_total: number | null;
        exhibitors_total: number | null;
        area_total: number | null;
        created?: string;
        status?: string;
        online_event: number | null;
      }> = [];

      for (const edition of editions) {
        let company: { id: number; name: string } | null = null;
        let city: { id: number; name: string } | null = null;

        if (edition.company_id) {
          company = await this.prisma.company.findUnique({
            where: { id: edition.company_id },
            select: { id: true, name: true }
          });
        }

        if (edition.city) {
          city = await this.prisma.city.findUnique({
            where: { id: edition.city },
            select: { id: true, name: true }
          });
        }

        editionData.push({
          id: edition.id,
          start_date: this.formatDateForES(edition.start_date),
          end_date: this.formatDateForES(edition.end_date),
          venue_id: edition.venue,
          venue_name: edition.venue_event_edition_venueTovenue?.name,
          city_id: edition.city,
          city_name: city?.name,
          company_id: edition.company_id,
          company_name: company?.name,
          edition_number: edition.edition_number,
          visitors_total: edition.visitors_total,
          exhibitors_total: edition.exhibitors_total,
          area_total: edition.area_total,
          created: this.formatDateTimeForES(edition.created)?.toString(),
          status: edition.status ?? undefined,
          online_event: edition.online_event,
        });
      }

      return editionData;
    } catch (error) {
      this.logger.warn(`Failed to get edition data for ${eventId}:`, error.message);
      return [];
    }
  }

  async transformEventsForES(eventIds: number[]): Promise<EventESDocument[]> {
    const results: EventESDocument[] = [];
    
    for (const eventId of eventIds) {
      try {
        const document = await this.transformEventForES(eventId);
        results.push(document);
      } catch (error) {
        this.logger.error(`Failed to transform event ${eventId}:`, error.message);
        // Continue with other events
      }
    }
    
    return results;
  }

  async needsReindexing(eventId: number, lastIndexed?: Date): Promise<boolean> {
    if (!lastIndexed) {
      return true; // Never indexed
    }

    try {
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        select: {
          modified: true,
          event_edition_event_event_editionToevent_edition: {
            select: { modified: true }
          }
        }
      });

      if (!event) {
        return false; 
      }

      if (event.modified && event.modified > lastIndexed) {
        return true;
      }

      const edition = event.event_edition_event_event_editionToevent_edition;
      if (edition?.modified && edition.modified > lastIndexed) {
        return true;
      }

      const eventDataModified = await this.prisma.event_data.findFirst({
        where: {
          event: eventId,
          modified: { gt: lastIndexed }
        },
        select: { id: true }
      });

      return !!eventDataModified;

    } catch (error) {
      this.logger.error(`Error checking reindex need for event ${eventId}:`, error.message);
      return true;
    }
  }

  async createEventReplica(eventId: number): Promise<void> {
    try {
      this.logger.log(`Creating event replica for event ${eventId}`);

      await this.prisma.event_replica.deleteMany({
        where: { event: eventId },
      });

      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        include: {
          event_edition_event_event_editionToevent_edition: {
            include: {
              venue_event_edition_venueTovenue: true,
            },
          },
          city_event_cityTocity: true,
          country_event_countryTocountry: true,
          event_category_event_category_eventToevent: {
            include: {
              category_event_category_categoryTocategory: true,
            },
          },
        },
      });

      if (!event || !event.event_edition_event_event_editionToevent_edition) {
        throw new Error(`Event ${eventId} or its edition not found`);
      }

      const edition = event.event_edition_event_event_editionToevent_edition;
      const venue = edition.venue_event_edition_venueTovenue;
      const city = event.city_event_cityTocity;
      const country = event.country_event_countryTocountry;

      // Ensure we have required dates
      if (!event.start_date || !event.end_date) {
        throw new Error(`Event ${eventId} missing required dates`);
      }

      // Create replica entries for each category
      for (const eventCategory of event.event_category_event_category_eventToevent) {
        await this.prisma.event_replica.create({
          data: {
            event: event.id,
            edition: edition.id,
            start_date: event.start_date,
            end_date: event.end_date,
            city: event.city,
            country: event.country,
            venue: edition.venue || null,
            company: edition.company_id || null,
            status: event.status || 'A',
            score: event.score || 0,
            membership: event.membership || 0,
            type: event.event_type,
            category: eventCategory.category,
            geo_lat: venue?.geo_lat || city?.geo_lat || null,
            geo_long: venue?.geo_long || city?.geo_long || null,
            published: event.published ? 1 : 0,
            event_created: edition.created,
            functionality: event.functionality || 'open',
            phy_city: event.city, 
          },
        });
      }

      await this.updatePhysicalCity(eventId, event.city);

      this.logger.log(`Created event replica for event ${eventId}`);
    } catch (error) {
      this.logger.error(`Failed to create event replica for event ${eventId}:`, error.message);
    }
  }

  private async updatePhysicalCity(eventId: number, cityId: number): Promise<void> {
    try {
      let physicalCity = cityId;

      // If event is in city ID 1 (online), find the actual physical city
      if (cityId === 1) {
        const physicalEdition = await this.prisma.event_edition.findFirst({
          where: {
            event: eventId,
            city: { not: 1 },
          },
          orderBy: { id: 'desc' },
          select: { city: true },
        });

        if (physicalEdition?.city) {
          physicalCity = physicalEdition.city;
        }
      }

      await this.prisma.event_replica.updateMany({
        where: { event: eventId },
        data: { phy_city: physicalCity },
      });

      this.logger.log(`Updated physical city to ${physicalCity} for event ${eventId}`);
    } catch (error) {
      this.logger.error(`Failed to update physical city for event ${eventId}:`, error.message);
    }
  }

  async updateEventUpdate(eventId: number, editionId: number, functionality: string, salesStatus?: string): Promise<void> {
    try {
      const existingRecord = await this.prisma.event_update.findFirst({
        where: {
          event_id: eventId,
          edition: editionId,
        },
      });

      if (existingRecord) {
        await this.prisma.event_update.updateMany({
          where: {
            event_id: eventId,
            edition: editionId,
          },
          data: {
            functionality,
            sales_status: salesStatus || null,
            modified: new Date(),
          },
        });
        this.logger.log(`Updated existing event_update for event ${eventId}, edition ${editionId}`);
      } else {
        const event = await this.prisma.event.findUnique({
          where: { id: eventId },
          include: {
            event_edition_event_event_editionToevent_edition: {
              include: {
                venue_event_edition_venueTovenue: true,
              },
            },
            city_event_cityTocity: true,
            country_event_countryTocountry: true,
          },
        });

        if (!event || !event.event_edition_event_event_editionToevent_edition) {
          throw new Error(`Event ${eventId} or its edition not found for event_update`);
        }

        const edition = event.event_edition_event_event_editionToevent_edition;
        const venue = edition.venue_event_edition_venueTovenue;
        const city = event.city_event_cityTocity;
        const country = event.country_event_countryTocountry;

        await this.prisma.event_update.create({
          data: {
            event_id: eventId,
            event_name: event.name,
            edition: editionId,
            functionality,
            sales_status: salesStatus || null,
            
            exhibitor_count: 0,
            visitor_count: 0,
            total_edition: 1,
            concurrent_field: '',
            end_date: event.end_date || new Date(),
            
            start_date: event.start_date,
            city_name: city?.name,
            country_name: country?.name,
            city_id: event.city,
            country_id: event.country,
            venue: venue?.name,
            venue_id: edition.venue,
            company_id: edition.company_id,
            event_type: event.event_type,
            geo_lat: venue?.geo_lat || city?.geo_lat,
            geo_long: venue?.geo_long || city?.geo_long,
            published: event.published,
            url: event.url,
            status: event.status,
            score: event.score,
            online_event: event.online_event,
            edition_created: edition.created,
            
            created: new Date(),
            modified: new Date(),
            last_visitor: new Date(),
            last_exhibitor: new Date('2000-01-01 00:00:00'), 
            
            total_current_ed_visitor: 0,
            total_visitor: 0,
            total_follower: 0,
            visitor_leads: 0,
            total_ratings: 0,
            avg_ratings: 0,
            total_reviews: 0,
            total_media: 0,
            total_exhibitor: 0,
            exhibitor_lead: 0,
            total_speakers: 0,
            event_score: event.score,
          },
        });
        
        this.logger.log(`Created new event_update for event ${eventId}, edition ${editionId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to update event_update for event ${eventId}:`, error.message);
    }
  }

  async processEventProducts(
    eventId: number,
    editionId: number,
    productData: string,
    userId: number
  ): Promise<{ categoryIds: number[]; softError?: string }> {
    try {
      const products = JSON.parse(productData);
      const categoryIds: number[] = [];
      let softError: string | undefined;

      // Get existing products count for validation
      const existingProducts = await this.prisma.event_products.findMany({
        where: { event: eventId },
        include: { product_event_products_productToproduct: true }
      });

      let publishedCount = existingProducts.filter(p => p.published === 1).length;
      let unpublishedCount = existingProducts.filter(p => p.published === 0).length;

      // Mark all existing products as unpublished first
      await this.prisma.event_products.updateMany({
        where: { event: eventId },
        data: { published: 0 }
      });

      const uniqueProducts = new Set<number>();

      for (const [productKey, publishedStatus] of Object.entries(products)) {
        // Validate product limits
        if (publishedStatus === '1') {
          if (publishedCount >= 10) {
            softError = "Not able to add more than 10 product";
            continue;
          }
          publishedCount++;
        } else if (publishedStatus === '0') {
          if (unpublishedCount >= 4) {
            softError = 'Not able to add more than 4 unpublished product';
            continue;
          }
          unpublishedCount++;
        }

        // Find or create product
        let product;
        if (this.isNumeric(productKey)) {
          product = await this.prisma.product.findUnique({
            where: { id: parseInt(productKey) },
            include: { category_product_categoryTocategory: true }
          });
        } else {
          product = await this.prisma.product.findFirst({
            where: { name: productKey },
            include: { category_product_categoryTocategory: true }
          });

          if (!product && productKey.length <= 50) {
            // Create new product
            product = await this.prisma.product.create({
              data: {
                name: productKey,
                created_by: userId,
                published: 1,
              },
              include: { category_product_categoryTocategory: true }
            });
          }
        }

        if (product && !uniqueProducts.has(product.id)) {
          uniqueProducts.add(product.id);

          // Create or update event product
          const existingEventProduct = await this.prisma.event_products.findFirst({
            where: {
              event: eventId,
              product: product.id
            }
          });

          if (existingEventProduct) {
            await this.prisma.event_products.update({
              where: { id: existingEventProduct.id },
              data: {
                published: parseInt(publishedStatus as string),
                edition: editionId,
                modified: new Date(),
                modifiedby: userId,
              }
            });
          } else {
            await this.prisma.event_products.create({
              data: {
                event: eventId,
                edition: editionId,
                product: product.id,
                published: parseInt(publishedStatus as string),
                createdby: userId,
              }
            });
          }

          // Add product category to event categories
          if (product.category_product_categoryTocategory && publishedStatus === '1') {
            categoryIds.push(product.category_product_categoryTocategory.id);
          }
        }
      }

      return { categoryIds, softError };
    } catch (error) {
      throw new Error('Invalid product format');
    }
  }

  async saveProductCategories(
    eventId: number,
    categoryIds: number[],
    userId: number
  ): Promise<void> {
    if (categoryIds.length === 0) return;

    // Remove existing product categories (not event categories)
    const existingProductCategories = await this.prisma.event_products.findMany({
      where: { event: eventId },
      include: {
        product_event_products_productToproduct: {
          include: { category_product_categoryTocategory: true }
        }
      }
    });

    const productCategoryIds = existingProductCategories
      .map(ep => ep.product_event_products_productToproduct?.category)
      .filter((id): id is number => id !== null && id !== undefined);

    if (productCategoryIds.length > 0) {
      await this.prisma.event_category.deleteMany({
        where: {
          event: eventId,
          category: { in: productCategoryIds }
        }
      });
    }

    // Add new product categories
    const uniqueCategoryIds = [...new Set(categoryIds)];
    
    for (const categoryId of uniqueCategoryIds) {
      const existingEventCategory = await this.prisma.event_category.findFirst({
        where: {
          event: eventId,
          category: categoryId
        }
      });

      if (!existingEventCategory) {
        await this.prisma.event_category.create({
          data: {
            event: eventId,
            category: categoryId,
            createdby: userId,
          }
        });
      }
    }
  }

  async processEventCategories(
    eventId: number,
    categoryIds: number[],
    userId: number,
    verifiedCategories?: string,
    vendorId?: number
  ): Promise<void> {
    // STEP 1: Find categories to delete 
    const categoriesToDeleteQuery = {
      where: {
        event: eventId,
        category_event_category_categoryTocategory: {
          is_group: false
        },
        ...(categoryIds.length > 0 && {
          category: {
            notIn: categoryIds
          }
        })
      }
    };

    // Get the IDs first, then delete
    const categoriesToDelete = await this.prisma.event_category.findMany({
      ...categoriesToDeleteQuery,
      select: { id: true }
    });

    // STEP 2: Delete the found categories
    if (categoriesToDelete.length > 0) {
      await this.prisma.event_category.deleteMany({
        where: {
          id: {
            in: categoriesToDelete.map(c => c.id)
          }
        }
      });
    }

    // STEP 3: Parse verified categories
    let verifiedCategoryIds: number[] = [];
    if (verifiedCategories) {
      try {
        verifiedCategoryIds = JSON.parse(verifiedCategories);
      } catch {
        // Handle parsing error silently
      }
    }

    // STEP 4: Add new categories
    for (const categoryId of categoryIds) {
      const existingEventCategory = await this.prisma.event_category.findFirst({
        where: {
          event: eventId,
          category: categoryId
        }
      });

      if (existingEventCategory) {
        // Update existing category
        const updateData: any = {
          modified: new Date(),
          modifiedby: userId,
        };

        if (verifiedCategoryIds.includes(categoryId) && vendorId) {
          updateData.verified_by = vendorId;
          updateData.verified_on = new Date();
        }

        await this.prisma.event_category.update({
          where: { id: existingEventCategory.id },
          data: updateData
        });
      } else {
        // Create new category
        const createData: any = {
          event: eventId,
          category: categoryId,
          createdby: userId,
        };

        if (verifiedCategoryIds.includes(categoryId) && vendorId) {
          createData.verified_by = vendorId;
          createData.verified_on = new Date();
        }

        await this.prisma.event_category.create({
          data: createData
        });
      }
    }
  }

  // private isNumeric(value: string): boolean {
  //   return !isNaN(Number(value)) && !isNaN(parseFloat(value));
  // }
  
  async processEventStats(
    eventId: number,
    editionId: number,
    statsData: any,
    userId: number
  ): Promise<{ valid: boolean; message?: string }> {
    try {
      let statsStructure = await this.getOrCreateStatsStructure(eventId, editionId);
      let hasChanges = false;

      // Process stats from JSON format
      if (statsData.stats) {
        const decodedStats = typeof statsData.stats === 'string' 
          ? JSON.parse(statsData.stats) 
          : statsData.stats;

        if (decodedStats.visitors !== undefined && decodedStats.visitors !== null && decodedStats.visitors !== '') {
          statsStructure.visitor.total_count = decodedStats.visitors;
          hasChanges = true;
        }

        if (decodedStats.exhibitors !== undefined && decodedStats.exhibitors !== null && decodedStats.exhibitors !== '') {
          statsStructure.exhibitor.total_count = decodedStats.exhibitors;
          hasChanges = true;
        }

        if (decodedStats.area !== undefined && decodedStats.area !== null && decodedStats.area !== '') {
          statsStructure.area.total_area = decodedStats.area;
          hasChanges = true;
        }
      }

      // Process individual visitor/exhibitor fields 
      if (statsData.eventExhibitors !== undefined && this.isNumeric(statsData.eventExhibitors)) {
        statsStructure.exhibitor.total_count = statsData.eventExhibitors;
        hasChanges = true;
      }

      if (statsData.eventVisitors !== undefined && this.isNumeric(statsData.eventVisitors)) {
        statsStructure.visitor.total_count = statsData.eventVisitors;
        hasChanges = true;
      }

      // Handle empty values (set to empty string, not null)
      if (statsData.eventExhibitors === '' || statsData.eventExhibitors === null) {
        statsStructure.exhibitor.total_count = '';
        hasChanges = true;
      }

      if (statsData.eventVisitors === '' || statsData.eventVisitors === null) {
        statsStructure.visitor.total_count = '';
        hasChanges = true;
      }

      if (hasChanges) {
        await this.saveStatsToDatabase(eventId, editionId, statsStructure, userId);
        
        await this.updateEditionTotals(editionId, statsStructure);
      }

      return { valid: true };
    } catch (error) {
      return { 
        valid: false, 
        message: 'invalid format for stats, for reference format is {"visitors":"300","exhibitors":"300","area":"200"}' 
      };
    }
  }

  private async getOrCreateStatsStructure(
    eventId: number, 
    editionId: number
  ): Promise<StatsStructure> {
    const existingStats = await this.prisma.event_data.findFirst({
      where: {
        event: eventId,
        event_edition: editionId,
        title: 'stats'
      }
    });

    if (existingStats && existingStats.value) {
      try {
        return JSON.parse(existingStats.value);
      } catch {
      }
    }

    return {
      exhibitor: {
        total_count: '',
        total_audited: 0,
        international_count: '',
        international_audited: 0,
        domestic_count: '',
        domestic_audited: 0,
      },
      visitor: {
        total_count: '',
        total_audited: 0,
        international_count: '',
        international_audited: 0,
        domestic_count: '',
        domestic_audited: 0,
      },
      area: {
        total_area: '',
        total_audited: 0,
        international_area: '',
        international_audited: 0,
        domestic_area: '',
        domestic_audited: 0,
      }
    };
  }

 
  private async saveStatsToDatabase(
    eventId: number,
    editionId: number,
    statsStructure: StatsStructure,
    userId: number
  ): Promise<void> {
    const existingStats = await this.prisma.event_data.findFirst({
      where: {
        event: eventId,
        event_edition: editionId,
        title: 'stats'
      }
    });

    const statsJson = JSON.stringify(statsStructure);

    if (existingStats) {
      await this.prisma.event_data.update({
        where: { id: existingStats.id },
        data: {
          value: statsJson,
          modifiedby: userId,
          modified: new Date(),
        }
      });
    } else {
      await this.prisma.event_data.create({
        data: {
          event: eventId,
          event_edition: editionId,
          data_type: 'JSON',
          title: 'stats',
          value: statsJson,
          createdby: userId,
        }
      });
    }
  }

  private async updateEditionTotals(
    editionId: number,
    statsStructure: StatsStructure
  ): Promise<void> {
    const updateData: any = {};

    if (statsStructure.exhibitor.total_count !== '') {
      updateData.exhibitors_total = this.isNumeric(statsStructure.exhibitor.total_count) 
        ? Number(statsStructure.exhibitor.total_count) 
        : null;
    }

    if (statsStructure.visitor.total_count !== '') {
      updateData.visitors_total = this.isNumeric(statsStructure.visitor.total_count) 
        ? Number(statsStructure.visitor.total_count) 
        : null;
    }

    if (statsStructure.area.total_area !== '') {
      updateData.area_total = this.isNumeric(statsStructure.area.total_area) 
        ? Number(statsStructure.area.total_area) 
        : null;
    }

    if (Object.keys(updateData).length > 0) {
      await this.prisma.event_edition.update({
        where: { id: editionId },
        data: updateData
      });
    }
  }


  // private isNumeric(value: any): boolean {
  //   if (value === null || value === undefined || value === '') return false;
  //   return !isNaN(Number(value)) && !isNaN(parseFloat(value.toString()));
  // }

  static validateStatsFormat(statsJson: string): boolean {
    try {
      const parsed = JSON.parse(statsJson);
      return typeof parsed === 'object' && parsed !== null;
    } catch {
      return false;
    }
  }

  async processSubVenues(
    eventId: number,
    editionId: number,
    subVenueData: string,
    venueId: number,
    userId: number
  ): Promise<{ valid: boolean; message?: string; subVenueIds?: number[] }> {
    try {
      // Validate that venue is provided
      if (!venueId) {
        return {
          valid: false,
          message: 'venue is required to map subVenue'
        };
      }

      // Validate venue exists
      const venue = await this.prisma.venue.findUnique({
        where: { id: venueId }
      });

      if (!venue) {
        return {
          valid: false,
          message: 'Invalid venue for sub-venue mapping'
        };
      }

      // Parse sub-venue data
      let subVenues: SubVenueInput[];
      try {
        subVenues = JSON.parse(subVenueData);
        if (!Array.isArray(subVenues)) {
          throw new Error('Sub-venues must be an array');
        }
      } catch {
        return {
          valid: false,
          message: 'invalid format of json'
        };
      }

      // Process each sub-venue
      const subVenueIds: number[] = [];
      
      for (const subVenueInput of subVenues) {
        const subVenueId = await this.findOrCreateSubVenue(subVenueInput, venueId);
        if (subVenueId) {
          subVenueIds.push(subVenueId);
        }
      }

      // Remove duplicates 
      const uniqueSubVenueIds = [...new Set(subVenueIds)];

      // Save to event data
      await this.saveSubVenuesToEventData(eventId, editionId, uniqueSubVenueIds, userId);

      return {
        valid: true,
        subVenueIds: uniqueSubVenueIds
      };

    } catch (error) {
      return {
        valid: false,
        message: 'Failed to process sub-venues'
      };
    }
  }

  private async findOrCreateSubVenue(
    subVenueInput: SubVenueInput,
    venueId: number
  ): Promise<number | null> {
    try {
      let subVenue: any = null;

      // First try to find by ID if numeric value provided
      if (this.isNumeric(subVenueInput)) {
        const numericValue = typeof subVenueInput === 'string' 
          ? parseInt(subVenueInput) 
          : Number(subVenueInput);

        subVenue = await this.prisma.sub_venue.findUnique({
          where: { id: numericValue }
        });
      }

      // If not found by ID, try to find by name
      if (!subVenue && (subVenueInput.name || typeof subVenueInput === 'string')) {
        const nameValue = subVenueInput.name || String(subVenueInput);
        
        subVenue = await this.prisma.sub_venue.findFirst({
          where: { 
            name: nameValue,
            venue: venueId           }
        });
      }

      if (!subVenue) {
        const nameForCreation = subVenueInput.name || String(subVenueInput);
        
        subVenue = await this.prisma.sub_venue.create({
          data: {
            name: nameForCreation,
            venue: venueId,
            published: true,
            createdby: 1,
          }
        });
      }

      return subVenue.id;

    } catch (error) {
      console.error('Error processing sub-venue:', error);
      return null;
    }
  }

  private async saveSubVenuesToEventData(
    eventId: number,
    editionId: number,
    subVenueIds: number[],
    userId: number
  ): Promise<void> {
    const subVenueJson = JSON.stringify(subVenueIds);

    // Check if sub_venue data already exists
    const existingSubVenueData = await this.prisma.event_data.findFirst({
      where: {
        event: eventId,
        event_edition: editionId,
        title: 'sub_venue'
      }
    });

    if (existingSubVenueData) {
      // Update existing
      await this.prisma.event_data.update({
        where: { id: existingSubVenueData.id },
        data: {
          value: subVenueJson,
          modifiedby: userId,
          modified: new Date(),
        }
      });
    } else {
      // Create new
      await this.prisma.event_data.create({
        data: {
          event: eventId,
          event_edition: editionId,
          data_type: 'JSON',
          title: 'sub_venue',
          value: subVenueJson,
          createdby: userId,
        }
      });
    }
  }

  private isNumeric(value: any): boolean {
    if (value === null || value === undefined) return false;
    
    if (typeof value === 'object' && value.id !== undefined) {
      return !isNaN(Number(value.id)) && !isNaN(parseFloat(value.id.toString()));
    }
    
    return !isNaN(Number(value)) && !isNaN(parseFloat(value.toString()));
  }

}