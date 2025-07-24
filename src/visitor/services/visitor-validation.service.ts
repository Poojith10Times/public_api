import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VisitorRegistrationDto } from '../dto/visitor-registration.dto';
import { city, country, event, event_edition, user } from '@prisma/client';

export type PreparedVisitorData = VisitorRegistrationDto & {
  userId: number;
  event: event;
  edition: event_edition;
  cityDetails?: city | null;
  countryDetails?: country | null;
};

@Injectable()
export class VisitorValidationService {
  private readonly INTERNAL_SOURCE_UUIDS = [
      'placeholder-uuid-for-internal-product-1',
      'placeholder-uuid-for-internal-product-2'
    ];

  constructor(private readonly prisma: PrismaService) {}

  async validateUserAuthorization(userId: number, eventId: number): Promise<{
    isValid: boolean;
    authType?: string;
    message?: string;
  }> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, published: true }
      });

      if (!user || !user.published) {
        return {
          isValid: false,
          message: 'User not found or inactive'
        };
      }

      if (user.email?.toLowerCase() === 'eva@10times.com' || userId === 29988050) {
        return {
          isValid: true,
          authType: 'internal_access'
        };
      }

      // Check event POC (entity_type=1)
      const eventPOC = await this.prisma.contact.findFirst({
        where: {
          entity_type: 1,
          entity_id: eventId,
          user_reference: userId,
          published: 1
        }
      });

      if (eventPOC) {
        return {
          isValid: true,
          authType: 'event_poc'
        };
      }

      // Check company POC (entity_type=2) 
      const eventWithCompany = await this.prisma.event.findUnique({
        where: { id: eventId },
        select: {
          event_edition_event_event_editionToevent_edition: {
            select: { company_id: true }
          }
        }
      });

      const companyId = eventWithCompany?.event_edition_event_event_editionToevent_edition?.company_id;
      
      if (companyId) {
        const companyPOC = await this.prisma.contact.findFirst({
          where: {
            entity_type: 2,
            entity_id: companyId,
            user_reference: userId,
            published: 1
          }
        });

        if (companyPOC) {
          return {
            isValid: true,
            authType: 'company_poc'
          };
        }
      }

      return {
        isValid: false,
        message: 'Not authorized to perform this action'
      };

    } catch (error) {
      return {
        isValid: false,
        message: 'Authorization check failed'
      };
    }
  }
  
  validateSource(source: string, authType?: string): { isValid: boolean; message?: string } {
    if (authType === 'internal_access') {
      if (!this.INTERNAL_SOURCE_UUIDS.includes(source)) {
        return { isValid: false, message: 'Invalid source for internal user.' };
      }
    }
    return { isValid: true };
  }

  async validateAndPrepareData(
    data: VisitorRegistrationDto,
    user: user,
  ): Promise<{
    isValid: boolean;
    message?: string;
    data?: PreparedVisitorData;
  }> {
    // 1. Event and Edition validation
    const edition = await this.prisma.event_edition.findUnique({
      where: { id: data.editionId },
      include: { 
        event_event_event_editionToevent_edition: true 
      },
    });

    if (!edition || !edition.event_event_event_editionToevent_edition) {
      return { isValid: false, message: 'Invalid edition ID.' };
    }
    
    const event = edition.event_event_event_editionToevent_edition[0];

    if (!event) {
      return { isValid: false, message: 'Event not found for the given edition.' };
    }

    if (event.id !== data.eventId) {
      return { isValid: false, message: 'Edition does not belong to the specified event.' };
    }

    if (!event.published) {
      return { isValid: false, message: 'Event is not active.' };
    }

    // 2. Fetch city and country details if they exist
    let cityDetails: city | null = null;
    let countryDetails: country | null = null;

    if (user.city) {
      cityDetails = await this.prisma.city.findUnique({ 
        where: { id: user.city }
      });
    }

    if (user.country) {
      countryDetails = await this.prisma.country.findUnique({ 
        where: { id: user.country }
      });
    }

    // 3. Prepare combined data
    const preparedData: PreparedVisitorData = {
      ...data,
      userId: user.id,
      event: event,
      edition: edition,
      name: user.name || '',
      company: user.user_company || '',
      designation: user.designation || '',
      phone: user.phone || '',
      cityDetails: cityDetails,
      countryDetails: countryDetails,
    };

    return {
      isValid: true,
      data: preparedData,
    };
  }
}