import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ValidationService } from './validation.service';

interface CreateEditionDto {
  edition: any;
  event: number;
  startDate: string;
  endDate: string;
  changesMadeBy: number;
  venue?: string | number;
  city?: string | number;
  company?: number;
  editionNumber?: number;
  facebookId?: string;
  twitterId?: string;
  twitterHashTags?: string;
  linkedinId?: string;
  googleId?: string;
  eventExhibitors?: number;
  eventVisitors?: number;
  areaTotal?: number;
  online_event?: number;
  website?: string;
  customFlag?: string;
  eepProcess?: number;
  removeVenue?: number;
  rehost?: number;
  oldEdition?: number;
  eventAudience?: string;
}

interface EditionResult {
  isValid: boolean;
  editionId?: number;
  message?: string;
}

@Injectable()
export class EditionService {
  private readonly logger = new Logger(EditionService.name);

  constructor(
    private prisma: PrismaService,
    private validationService: ValidationService,
  ) {}

  async createEdition(dto: CreateEditionDto, prisma?: any): Promise<EditionResult> {
    const db = prisma || this.prisma;
    
    try {
      const isNewEdition = !dto.edition || dto.rehost === 1;

      const validation = await this.validateEditionData(dto, isNewEdition, db);
      if (!validation.isValid) {
        return validation;
      }

      const dateConflictCheck = await this.checkDateConflicts(dto, isNewEdition, db);
      if (!dateConflictCheck.isValid) {
        return dateConflictCheck;
      }

      if (isNewEdition) {
        return await this.createNewEdition(dto, db);
      } else {
        return await this.updateExistingEdition(dto, db); //remove 
      }

    } catch (error) {
      this.logger.error('Edition creation/update failed', {
        error: error.message,
        stack: error.stack,
        dto,
      });
      
      return {
        isValid: false,
        message: 'Error creating edition',
      };
    }
  }

  private async validateEditionData(dto: CreateEditionDto, isNewEdition: boolean, db: any) {
    const messages: string[] = [];

    // Validate user
    const userValidation = await this.validationService.validateUser(dto.changesMadeBy);
    if (!userValidation.isValid) {
      messages.push(userValidation.message ?? 'Unknown user validation error');
    }

    // Validate website format
    if (dto.website) {
      const websiteValid = this.validateWebsiteFormat(dto.website);
      if (!websiteValid) {
        return {
          isValid: false,
          message: 'website is not in correct format',
        };
      }
    }

    if (isNewEdition) {
      if (!dto.event) {
        messages.push('event is mandatory');
      }

      if (!dto.startDate || !dto.endDate) {
        messages.push('startDate and endDate are mandatory params');
      }

      if (dto.event) {
        const event = await db.event.findUnique({
          where: { id: dto.event },
        });

        if (!event) {
          messages.push('invalid event');
        }
      }
    }

    if (dto.startDate && !this.isValidDate(dto.startDate)) {
      messages.push('please give date in valid format :YYYY-MM-DD');
    }

    if (dto.endDate && !this.isValidDate(dto.endDate)) {
      messages.push('please give date in valid format :YYYY-MM-DD');
    }

    // Validate date logic
    if (dto.startDate && dto.endDate) {
      const startDate = new Date(dto.startDate);
      const endDate = new Date(dto.endDate);

      if (endDate < startDate && 
          dto.eventAudience !== '10100' && 
          dto.eventAudience !== '11100' && 
          dto.eventAudience !== '11000') {
        messages.push('startDate should be less than endDate');
      }

      // Check if dates are in the past
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      if ((startDate < yesterday || endDate < yesterday) && 
          dto.eventAudience !== '10100' && 
          dto.eventAudience !== '11000') {
        messages.push('dates should be greater than now.');
      }
    }

    return {
      isValid: messages.length === 0,
      messages,
    };
  }

  private async checkDateConflicts(dto: CreateEditionDto, isNewEdition: boolean, db: any) {
    if (!dto.startDate || !dto.endDate || !dto.event) {
      return { isValid: true };
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    try {
      const existingEditions = await db.event_edition.findMany({
        where: {
          event: dto.event, 
          ...(isNewEdition ? {} : { id: { not: dto.edition } }),
        },
        select: {
          id: true,
          start_date: true,
          end_date: true,
        },
      });

      for (const edition of existingEditions) {
        if (!edition.start_date || !edition.end_date) {
          continue; 
        }

        const existingStart = new Date(edition.start_date);
        const existingEnd = new Date(edition.end_date);

        const hasOverlap = (
          (startDate >= existingStart && startDate <= existingEnd) ||
          (endDate >= existingStart && endDate <= existingEnd) ||
          (startDate <= existingStart && endDate >= existingEnd) ||
          (startDate.getTime() === existingStart.getTime()) ||
          (endDate.getTime() === existingEnd.getTime())
        );

        if (hasOverlap) {
          return {
            isValid: false,
            message: 'Already have an events during these Dates',
          };
        }
      }

      // Check if trying to modify expired edition
      if (!isNewEdition && dto.edition) {
        const currentEdition = await db.event_edition.findUnique({
          where: { id: dto.edition },
          select: { end_date: true },
        });

        if (currentEdition && currentEdition.end_date) {
          const now = new Date();
          const editionEndDate = new Date(currentEdition.end_date);
          
          if (editionEndDate < now) {
            return {
              isValid: false,
              message: 'you can not make changes in expired edition',
            };
          }
        }
      }

      return { isValid: true };

    } catch (error) {
      console.error('Date conflict check failed:', error);
      return {
        isValid: false,
        message: `Error checking date conflicts: ${error.message}`,
      };
    }
  }

  private async createNewEdition(dto: CreateEditionDto, db: any): Promise<EditionResult> {
    try {
      this.logger.log(`Creating new edition for event ${dto.event}`);
      
      const event = await db.event.findUnique({
        where: { id: dto.event },
        select: {
          id: true,
          city: true,
          country: true,
        },
      });

      if (!event) {
        this.logger.error(`Event ${dto.event} not found`);
        return {
          isValid: false,
          message: 'Event not found',
        };
      }

      const editionData: any = {
        event: dto.event,
        start_date: new Date(dto.startDate),
        end_date: new Date(dto.endDate),
        createdby: dto.changesMadeBy,
        created: new Date(),
        eep_process: dto.eepProcess || 2,
        published: 1,
        status: 'A',
      };

      // Handle venue 
      if (dto.venue && typeof dto.venue === 'number') {
        editionData.venue = dto.venue;
      } else if (dto.city && typeof dto.city === 'number') {
        editionData.city = dto.city;
      } else if (event) {
        editionData.city = event.city;
      }

      // Set company
      if (dto.company) {
        editionData.company_id = dto.company;
      }

      // Optional fields with null checks
      if (dto.editionNumber !== undefined) editionData.edition_number = dto.editionNumber;
      if (dto.facebookId) editionData.facebook_id = dto.facebookId;
      if (dto.twitterId) editionData.twitter_id = dto.twitterId;
      if (dto.twitterHashTags) editionData.twitter_hashtag = dto.twitterHashTags;
      if (dto.linkedinId) editionData.linkedin_id = dto.linkedinId;
      if (dto.googleId) editionData.google_id = dto.googleId;
      if (dto.eventExhibitors !== undefined) editionData.exhibitors_total = dto.eventExhibitors;
      if (dto.eventVisitors !== undefined) editionData.visitors_total = dto.eventVisitors;
      if (dto.areaTotal !== undefined) editionData.area_total = dto.areaTotal;
      if (dto.website) editionData.website = dto.website;
      if (dto.customFlag) editionData.custom_flag = dto.customFlag;
      if (dto.online_event !== undefined) {
        editionData.online_event = dto.online_event || null;
      }

      if (dto.rehost === 1 && dto.oldEdition) {
        await this.handleRehostScenario(dto, editionData, db);
      }

      const newEdition = await db.event_edition.create({
        data: editionData,
      });

      if (!newEdition || newEdition.id === undefined || newEdition.id === null) {
        this.logger.error(`Edition creation failed: received invalid result`, newEdition);
        return {
          isValid: false,
          message: `Edition creation failed: invalid result ${JSON.stringify(newEdition)}`,
        };
      }

      this.logger.log(`Successfully created new edition ${newEdition.id} for event ${dto.event}`);

      return {
        isValid: true,
        editionId: newEdition.id,
      };

    } catch (error) {
      this.logger.error('Failed to create new edition:', {
        error: error.message,
        stack: error.stack,
        dto: dto,
      });
      return {
        isValid: false,
        message: `Failed to create edition: ${error.message}`,
      };
    }
  }

  private async updateExistingEdition(dto: CreateEditionDto, db: any): Promise<EditionResult> {
    try {
      const updateData: any = {
        modified: new Date(),
        modifiedby: dto.changesMadeBy,
      };

      if (dto.startDate) updateData.start_date = new Date(dto.startDate);
      if (dto.endDate) updateData.end_date = new Date(dto.endDate);
      if (dto.editionNumber) updateData.edition_number = dto.editionNumber;
      if (dto.facebookId) updateData.facebook_id = dto.facebookId;
      if (dto.twitterId) updateData.twitter_id = dto.twitterId;
      if (dto.twitterHashTags) updateData.twitter_hashtag = dto.twitterHashTags;
      if (dto.linkedinId) updateData.linkedin_id = dto.linkedinId;
      if (dto.googleId) updateData.google_id = dto.googleId;
      if (dto.eventExhibitors) updateData.exhibitors_total = dto.eventExhibitors;
      if (dto.eventVisitors) updateData.visitors_total = dto.eventVisitors;
      if (dto.areaTotal) updateData.area_total = dto.areaTotal;
      if (dto.website) updateData.website = dto.website;
      if (dto.eepProcess) updateData.eep_process = dto.eepProcess;

      if (dto.removeVenue === 1) {
        updateData.venue = null;
      } else if (dto.venue && typeof dto.venue === 'number') {
        updateData.venue = dto.venue;
      }

      if (dto.company) {
        updateData.company_id = dto.company;
      }

      if (dto.online_event !== undefined) {
        updateData.online_event = dto.online_event || null;
      }

      const updatedEdition = await db.event_edition.update({
        where: { id: dto.edition },
        data: updateData,
      });

      this.logger.log(`Updated edition ${dto.edition} for event ${dto.event}`);

      return {
        isValid: true,
        editionId: updatedEdition.id,
      };

    } catch (error) {
      this.logger.error('Failed to update edition', error);
      return {
        isValid: false,
        message: `Failed to update edition: ${error.message}`,
      };
    }
  }

  private async handleRehostScenario(dto: CreateEditionDto, editionData: any, db: any) {
    try {
      const oldEdition = await db.event_edition.findUnique({
        where: { id: dto.oldEdition },
      });

      if (oldEdition) {
        // Copy data from old edition if not provided in new data
        if (!dto.editionNumber) {
          editionData.edition_number = (oldEdition.edition_number || 0) + 1;
        }
        if (!dto.venue) editionData.venue = oldEdition.venue;
        if (!dto.company) editionData.company_id = oldEdition.company_id;
        if (!dto.facebookId) editionData.facebook_id = oldEdition.facebook_id;
        if (!dto.twitterId) editionData.twitter_id = oldEdition.twitter_id;
        if (!dto.twitterHashTags) editionData.twitter_hashtag = oldEdition.twitter_hashtag;
        if (!dto.linkedinId) editionData.linkedin_id = oldEdition.linkedin_id;
        if (!dto.googleId) editionData.google_id = oldEdition.google_id;
        if (!dto.eventExhibitors) editionData.exhibitors_total = oldEdition.exhibitors_total;
        if (!dto.eventVisitors) editionData.visitors_total = oldEdition.visitors_total;
        if (!dto.areaTotal) editionData.area_total = oldEdition.area_total;
      }
    } catch (error) {
      this.logger.warn('Failed to copy data from old edition', error);
    }
  }

  private isValidDate(dateString: string): boolean {
    const regex = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$/;
    return regex.test(dateString);
  }

  private validateWebsiteFormat(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      const urlWithoutQuery = `${parsedUrl.protocol}//${parsedUrl.host}`;
      const regex = /^(https?:\/\/)?(?!.*(?:http:\/\/.*http:\/\/|https:\/\/.*https:\/\/))?(?!www{3,})(www\.)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,15}([\/\w\.\-\?\&\:\=\#\@\+\%]*)*$/;
      return regex.test(urlWithoutQuery);
    } catch {
      return false;
    }
  }
}