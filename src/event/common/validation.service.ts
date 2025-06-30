import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ValidationService {
  constructor(private readonly prisma: PrismaService) {}

  async validateUser(userId: number): Promise<{
    isValid: boolean;
    user?: any;
    message?: string;
  }> {
    try {
      const user = await this.prisma.user.findFirst({
        where: {
          id: userId,
          published: true,
        },
      });

      if (!user) {
        return {
          isValid: false,
          message: 'Invalid user or user not published',
        };
      }

      return {
        isValid: true,
        user,
      };
    } catch (error) {
      console.error(`ValidationService: User validation error:`, error);
      return {
        isValid: false,
        message: `Error validating user: ${error.message}`,
      };
    }
  }

  /**
   * Validate event exists for updates
   */
  async validateEventExists(eventId: number): Promise<{
    isValid: boolean;
    event?: any;
    message?: string;
  }> {
    try {
      const event = await this.prisma.event.findUnique({
        where: { 
          id: eventId,
          published: { not: null }
        },
        include: {
          event_edition_event_event_editionToevent_edition: true,
          city_event_cityTocity: true,
          country_event_countryTocountry: true,
        }
      });

      if (!event) {
        return {
          isValid: false,
          message: 'Event not found',
        };
      }

      return {
        isValid: true,
        event,
      };
    } catch (error) {
      return {
        isValid: false,
        message: 'Event validation failed',
      };
    }
  }

  async validateMainEvent(mainEventId: number): Promise<{
    isValid: boolean;
    event?: any;
    message?: string;
  }> {
    try {
      const event = await this.prisma.event.findUnique({
        where: { id: mainEventId },
      });

      if (!event) {
        return {
          isValid: false,
          message: 'Invalid main event',
        };
      }

      return {
        isValid: true,
        event,
      };
    } catch (error) {
      return {
        isValid: false,
        message: 'Error validating main event',
      };
    }
  }

  async validateEventType(inputEventType: number[]): Promise<{
    isValid: boolean;
    eventAudience?: string;
    message?: string;
  }> {
    try {
      const eventTypesRaw = await this.prisma.event_type.findMany({
        select: {
          id: true,
          event_audience: true,
        },
      });

      const grouped: Record<string, number[]> = {};

      for (const et of eventTypesRaw) {
        if (!grouped[et.event_audience]) {
          grouped[et.event_audience] = [];
        }
        grouped[et.event_audience].push(et.id);
      }

      const eventTypes = Object.entries(grouped).map(([eventAudience, ids]) => ({
        typeByAudience: ids.join(','),
        eventAudience,
      }));

      let set1: number[] = [];
      let set2: number[] = [];

      eventTypes.forEach((row) => {
        const types = row.typeByAudience.split(',').map(Number);
        if (row.eventAudience === '11000') {
          set1 = types;
        } else {
          set2 = [...types, 3];
        }
      });

      const intersectionSet1 = inputEventType.filter((type) => set1.includes(type));
      if (intersectionSet1.length === inputEventType.length) {
        return {
          isValid: true,
          eventAudience: "11000",
        };
      }

      const intersectionSet2 = inputEventType.filter((type) => set2.includes(type));
      if (intersectionSet2.length === inputEventType.length) {
        return {
          isValid: true,
          eventAudience: "10100",
        };
      }

      return {
        isValid: false,
        message: 'Invalid Type',
      };
    } catch (error) {
      return {
        isValid: false,
        message: 'Error validating event type',
      };
    }
  }


  validateEventTypeStatic(eventTypes: number[]): {
    isValid: boolean;
    eventAudience?: string;
    message?: string;
  } {
    const type1Array = [1, 2, 3]; // 11000 audience
    const type2Array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // 10100 audience
    
    const intersection1 = eventTypes.filter(type => type1Array.includes(type));
    const intersection2 = eventTypes.filter(type => type2Array.includes(type));
    
    if (intersection1.length === eventTypes.length) {
      return { isValid: true, eventAudience: '11000' };
    } else if (intersection2.length === eventTypes.length) {
      return { isValid: true, eventAudience: '10100' };
    } else {
      return { isValid: false, message: 'Invalid Type' };
    }
  }

  async validateCategories(categoryIds: number[]): Promise<{
    isValid: boolean;
    message?: string;
  }> {
    try {
      if (categoryIds.length > 2) {
        return {
          isValid: false,
          message: 'select atmost 2 category',
        };
      }

      const categories = await this.prisma.category.findMany({
        where: {
          id: { in: categoryIds },
          is_group: true,
        }
      });

      if (categories.length !== categoryIds.length) {
        const invalidIds = categoryIds.filter(id => !categories.find(cat => cat.id === id));
        return {
          isValid: false,
          message: `invalid category: ${invalidIds.join(', ')}`,
        };
      }

      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        message: 'Error validating categories',
      };
    }
  }

  async validateCompany(companyId: number): Promise<{
    isValid: boolean;
    company?: any;
    message?: string;
  }> {
    try {
      const company = await this.prisma.company.findUnique({
        where: { id: companyId },
      });

      if (!company) {
        return {
          isValid: false,
          message: 'Invalid company',
        };
      }

      return {
        isValid: true,
        company,
      };
    } catch (error) {
      return {
        isValid: false,
        message: 'Company validation failed',
      };
    }
  }

  /**
   * Validate venue exists
   */
  async validateVenue(venueId: number): Promise<{
    isValid: boolean;
    venue?: any;
    message?: string;
  }> {
    try {
      const venue = await this.prisma.venue.findUnique({
        where: { id: venueId },
        include: {
          city_venue_cityTocity: {
            include: {
              area_values: true
            }
          }
        }
      });

      if (!venue) {
        return {
          isValid: false,
          message: 'Invalid venue',
        };
      }

      return {
        isValid: true,
        venue,
      };
    } catch (error) {
      return {
        isValid: false,
        message: 'Venue validation failed',
      };
    }
  }

  /**
   * Validate city exists
   */
  async validateCity(cityId: number): Promise<{
    isValid: boolean;
    city?: any;
    message?: string;
  }> {
    try {
      const city = await this.prisma.city.findUnique({
        where: { id: cityId },
        include: {
          area_values: true 
        }
      });

      if (!city) {
        return {
          isValid: false,
          message: 'invalid city',
        };
      }

      return {
        isValid: true,
        city,
      };
    } catch (error) {
      return {
        isValid: false,
        message: 'City validation failed',
      };
    }
  }

  /**
   * Validate country exists
   */
  async validateCountry(countryId: string): Promise<{
    isValid: boolean;
    country?: any;
    message?: string;
  }> {
    try {
      const country = await this.prisma.country.findUnique({
        where: { id: countryId },
      });

      if (!country) {
        return {
          isValid: false,
          message: 'Invalid country',
        };
      }

      return {
        isValid: true,
        country,
      };
    } catch (error) {
      return {
        isValid: false,
        message: 'Country validation failed',
      };
    }
  }


  processDates(startDate: string, endDate: string): {
    processedStartDate: string;
    processedEndDate: string;
    dateNotConfirmed: boolean;
    customFlag?: string;
  } {
    let processedStartDate = startDate;
    let processedEndDate = endDate;
    let dateNotConfirmed = false;
    let customFlag: string | undefined;

    // Check if startDate is in YYYY-MM format
    if (/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(startDate)) {
      const startMonth = startDate.split('-')[1];
      const tempDate = `${startDate}-28`;
      const lastDayOfMonth = new Date(new Date(tempDate).getFullYear(), new Date(tempDate).getMonth() + 1, 0);
      processedStartDate = lastDayOfMonth.toISOString().split('T')[0];
      dateNotConfirmed = true;
    }

    // Check if endDate is in YYYY-MM format
    if (/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(endDate)) {
      const endMonth = endDate.split('-')[1];
      const tempDate = `${endDate}-28`;
      const lastDayOfMonth = new Date(new Date(tempDate).getFullYear(), new Date(tempDate).getMonth() + 1, 0);
      processedEndDate = lastDayOfMonth.toISOString().split('T')[0];
      dateNotConfirmed = true;
    }

    if (dateNotConfirmed) {
      const startMonth = startDate.split('-')[1];
      const endMonth = endDate.split('-')[1];
      
      if (startMonth !== endMonth) {
        customFlag = '101100';
      } else {
        customFlag = '100100';
      }
    }

    return {
      processedStartDate,
      processedEndDate,
      dateNotConfirmed,
      customFlag,
    };
  }

  validateDateLogic(startDate: string, endDate: string, eventAudience?: string): {
    isValid: boolean;
    message?: string;
  } {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const now = new Date();
    
    // Remove time part for comparison
    const startDateOnly = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDateOnly = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const nowDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Check if endDate is before startDate (except for certain event audiences)
    if (endDateOnly < startDateOnly && eventAudience !== '10100') {
      return {
        isValid: false,
        message: 'startDate should be less than endDate',
      };
    }

    // Check if dates are in the past (with some exceptions)
    if (eventAudience !== '10100' && eventAudience !== '11000') {
      const yesterdayDateOnly = new Date(nowDateOnly.getTime() - 24 * 60 * 60 * 1000);
      
      if (startDateOnly <= yesterdayDateOnly || endDateOnly <= yesterdayDateOnly) {
        return {
          isValid: false,
          message: 'dates should be greater than now.',
        };
      }
    }

    return { isValid: true };
  }

  validateDates(startDate: string, endDate: string, eventAudience?: string): {
    isValid: boolean;
    message?: string;
  } {
    return this.validateDateLogic(startDate, endDate, eventAudience);
  }

  async validateDateConflicts(
    eventId: number, 
    startDate: string, 
    endDate: string, 
    excludeEditionId?: number
  ): Promise<{
    isValid: boolean;
    message?: string;
  }> {
    try {
      const existingEditions = await this.prisma.event_edition.findMany({
        where: {
          event: eventId,
          ...(excludeEditionId && { id: { not: excludeEditionId } })
        },
        select: {
          id: true,
          start_date: true,
          end_date: true,
        }
      });

      const newStart = new Date(startDate);
      const newEnd = new Date(endDate);

      for (const edition of existingEditions) {
        const existingStart = edition.start_date;
        const existingEnd = edition.end_date;

        // Check for date overlaps
        if (
          existingStart &&
          existingEnd &&
          (
            (newStart.getTime() === existingStart.getTime() || newEnd.getTime() === existingEnd.getTime()) ||
            (newStart >= existingStart && newStart <= existingEnd) ||
            (newEnd >= existingStart && newEnd <= existingEnd)
          )
        ) {
          return {
            isValid: false,
            message: 'Already have an events during these Dates',
          };
        }
      }

      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        message: 'Date conflict validation failed',
      };
    }
  }

  /**
   * Validate website format
   */
  validateWebsiteFormat(url: string): boolean {
    if (!url || url === '') return true;
    
    try {
      const parsedUrl = new URL(url);
      const urlWithoutQuery = `${parsedUrl.protocol}//${parsedUrl.host}`;
      
      const regex = /^(https?:\/\/)?(?!.*(?:http:\/\/.*http:\/\/|https:\/\/.*https:\/\/))?(?!www{3,})(www\.)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,15}([\/\w\.\-\?\&\:\=\#\@\+\%]*)*$/;
      
      return regex.test(urlWithoutQuery);
    } catch {
      return false;
    }
  }

  /**
   * Validate URL uniqueness
   */
  async validateUrlUniqueness(url: string, excludeEventId?: number): Promise<{
    isValid: boolean;
    message?: string;
  }> {
    try {
      const existingUrl = await this.prisma.url.findUnique({
        where: { id: url }
      });

      if (existingUrl) {
        return {
          isValid: false,
          message: 'url exists',
        };
      }

      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        message: 'URL validation failed',
      };
    }
  }
}