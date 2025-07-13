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

  async validateVenue(venueId: number): Promise<{
    isValid: boolean;
    venue?: any;
    message?: string;
  }> {
    try {
      // First, get the venue
      const venue = await this.prisma.venue.findUnique({
        where: { id: venueId }
      });

      if (!venue) {
        return {
          isValid: false,
          message: 'Invalid venue',
        };
      }

      // Then get the city and country separately
      let city: any = null;
      let country: any = null;

      if (venue.city) {
        city = await this.prisma.city.findUnique({
          where: { id: venue.city },
          include: {
            area_values: true
          }
        });
      }

      if (venue.country) {
        country = await this.prisma.country.findUnique({
          where: { id: venue.country }
        });
      }

      // If no country from venue, try to get it from city
      if (!country && city && city.country) {
        country = await this.prisma.country.findUnique({
          where: { id: city.country }
        });
      }

      // Attach the relationships manually
      const venueWithRelations = {
        ...venue,
        city_venue_cityTocity: city,
        country_venue_countryTocountry: country
      };

      return {
        isValid: true,
        venue: venueWithRelations,
      };
    } catch (error) {
      console.error('Venue validation error:', error);
      return {
        isValid: false,
        message: 'Venue validation failed',
      };
    }
  }

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

      // Get country separately
      let country: any = null;
      if (city.country) {
        country = await this.prisma.country.findUnique({
          where: { id: city.country }
        });
      }

      // Attach country relationship
      const cityWithCountry = {
        ...city,
        country_city_countryTocountry: country
      };

      return {
        isValid: true,
        city: cityWithCountry,
      };
    } catch (error) {
      console.error('City validation error:', error);
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

  async resolveCityByUrl(cityUrl: string): Promise<{
    isValid: boolean;
    city?: any;
    message?: string;
  }> {
    try {
      const city = await this.prisma.city.findUnique({
        where: {
          url: cityUrl
        },
        include: {
          area_values: true
        }
      });

      if (!city) {
        return {
          isValid: false,
          message: `City with URL "${cityUrl}" not found`
        };
      }

      // Get country separately
      let country: any = null;
      if (city.country) {
        country = await this.prisma.country.findUnique({
          where: { id: city.country }
        });
      }

      // Attach country relationship
      const cityWithCountry = {
        ...city,
        country_city_countryTocountry: country
      };

      return {
        isValid: true,
        city: cityWithCountry
      };
    } catch (error) {
      console.error('City resolution error:', error);
      return {
        isValid: false,
        message: 'City resolution failed'
      };
    }
  }

  async resolveCountryByUrl(countryUrl: string): Promise<{
    isValid: boolean;
    country?: any;
    message?: string;
  }> {
    try {
      const country = await this.prisma.country.findUnique({
        where: {
          url: countryUrl
        }
      });

      if (!country) {
        return {
          isValid: false,
          message: `Country with URL "${countryUrl}" not found`
        };
      }

      return {
        isValid: true,
        country
      };
    } catch (error) {
      return {
        isValid: false,
        message: 'Country resolution failed'
      };
    }
  }

  async resolveVenueByUrl(venueUrl: string): Promise<{
    isValid: boolean;
    venue?: any;
    message?: string;
  }> {
    try {
      // First, get the venue
      const venue = await this.prisma.venue.findUnique({
        where: {
          url: venueUrl
        }
      });

      if (!venue) {
        return {
          isValid: false,
          message: `Venue with URL "${venueUrl}" not found`
        };
      }

      // Then get the city and country separately
      let city: any = null;
      let country: any = null;

      if (venue.city) {
        city = await this.prisma.city.findUnique({
          where: { id: venue.city },
          include: {
            area_values: true
          }
        });
      }

      if (venue.country) {
        country = await this.prisma.country.findUnique({
          where: { id: venue.country }
        });
      }

      // If no country from venue, try to get it from city
      if (!country && city && city.country) {
        country = await this.prisma.country.findUnique({
          where: { id: city.country }
        });
      }

      // Attach the relationships manually
      const venueWithRelations = {
        ...venue,
        city_venue_cityTocity: city,
        country_venue_countryTocountry: country
      };

      return {
        isValid: true,
        venue: venueWithRelations
      };
    } catch (error) {
      console.error('Venue resolution error:', error);
      return {
        isValid: false,
        message: 'Venue resolution failed'
      };
    }
  }

  async resolveCompanyByUrl(companyUrl: string): Promise<{
    isValid: boolean;
    company?: any;
    message?: string;
    }> {
    try {
      const company = await this.prisma.company.findUnique({
        where: {
          url: companyUrl
        }
      });

      if (!company) {
        return {
          isValid: false,
          message: `Company with URL "${companyUrl}" not found`
        };
      }

      return {
        isValid: true,
        company
      };
    } catch (error) {
      return {
        isValid: false,
        message: 'Company resolution failed'
      };
    }
  }

  async validateCompany(companyInput: number | string): Promise<{
    isValid: boolean;
    company?: any;
    message?: string;
  }> {
    try {
      let company;

      if (typeof companyInput === 'string') {
        // Handle URL resolution
        return await this.resolveCompanyByUrl(companyInput);
      } else {
        // Handle numeric ID (existing logic)
        company = await this.prisma.company.findUnique({
          where: { id: companyInput },
        });

        if (!company) {
          return {
            isValid: false,
            message: 'Invalid company',
          };
        }
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

  async resolveCategoriesByUrl(categoryUrls: string[]): Promise<{
    isValid: boolean;
    categories?: any[];
    categoryIds?: number[];
    message?: string;
  }> {
    try {
      if (categoryUrls.length > 2) {
        return {
          isValid: false,
          message: 'Select at most 2 categories'
        };
      }

      const resolvedCategories: any[] = [];
      const notFoundCategories: string[] = [];

      for (const categoryUrl of categoryUrls) {
        const category = await this.prisma.category.findUnique({
          where: {
            url: categoryUrl,
            is_group: true
          }
        });

        if (category) {
          resolvedCategories.push(category);
        } else {
          notFoundCategories.push(categoryUrl);
        }
      }

      if (notFoundCategories.length > 0) {
        return {
          isValid: false,
          message: `Categories with URLs not found: ${notFoundCategories.join(', ')}`
        };
      }

      return {
        isValid: true,
        categories: resolvedCategories,
        categoryIds: resolvedCategories.map(c => c.id)
      };

    } catch (error) {
      return {
        isValid: false,
        message: 'Category resolution failed'
      };
    }
  }

  async validateEventTypesWithUrl(typeInputs: string[]): Promise<{
    isValid: boolean;
    eventAudience?: string;
    eventType?: number; // Primary event type
    subEventType?: number | null;
    eventTypeArray?: number[];
    message?: string;
  }> {
    try {
      if (typeInputs.length === 0) {
        return {
          isValid: false,
          message: 'At least one event type is required'
        };
      }

      if (typeInputs.length > 10) {
        return {
          isValid: false,
          message: 'Select at most 10 event types'
        };
      }

      const resolvedTypes: number[] = [];
      const notFoundTypes: string[] = [];

      // Resolve each URL to event type ID
      for (const typeUrl of typeInputs) {
        const urlResult = await this.resolveEventTypeByUrl(typeUrl);
        
        if (urlResult.isValid && urlResult.eventType) {
          resolvedTypes.push(urlResult.eventType.id);
        } else {
          notFoundTypes.push(typeUrl);
        }
      }

      if (notFoundTypes.length > 0) {
        return {
          isValid: false,
          message: `Event types with URLs not found: ${notFoundTypes.join(', ')}`
        };
      }

      // Remove duplicates
      const uniqueResolvedTypes = [...new Set(resolvedTypes)];

      // Validate the resolved event types using existing logic
      const typeValidation = await this.validateEventType(uniqueResolvedTypes);
      if (!typeValidation.isValid) {
        return {
          isValid: false,
          message: typeValidation.message
        };
      }

      // Handle special cases (meetup = workshop + sub_event_type = 1)
      let subEventType: number | null = null;
      if (typeInputs.includes('meetup')) {
        subEventType = 1;
      }

      return {
        isValid: true,
        eventAudience: typeValidation.eventAudience,
        eventType: uniqueResolvedTypes[0], 
        subEventType,
        eventTypeArray: uniqueResolvedTypes
      };

    } catch (error) {
      return {
        isValid: false,
        message: 'Event type validation failed'
      };
    }
  }

  async resolveEventTypeByUrl(eventTypeUrl: string): Promise<{
    isValid: boolean;
    eventType?: any;
    eventTypeId?: number;
    message?: string;
  }> {
    try {
      const eventType = await this.prisma.event_type.findFirst({
        where: {
          url: eventTypeUrl
        }
      });

      if (!eventType) {
        return {
          isValid: false,
          message: `Event type with URL "${eventTypeUrl}" not found`
        };
      }

      return {
        isValid: true,
        eventType,
        eventTypeId: eventType.id
      };
    } catch (error) {
      return {
        isValid: false,
        message: 'Event type resolution failed'
      };
    }
  }


  // user upsert auth validation
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

      if (user.email?.toLowerCase() === 'eva@10times.com') {
        return {
          isValid: true,
          authType: 'eva_access'
        };
      }

      // Step 3: Check event POC (entity_type=1)
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

      // Step 4: Check company POC (entity_type=2) 
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

      // Step 5: No authorization found
      return {
        isValid: false,
        message: 'Not authorized to change the event details'
      };

    } catch (error) {
      console.error('POC authorization validation error:', error);
      return {
        isValid: false,
        message: 'Authorization check failed'
      };
    }
  }

  private extractEmailDomain(email: string): string | null {
    try {
      const match = email.match(/^[^\s@]+@([^\s@]+\.[^\s@]+)$/);
      return match ? match[1].toLowerCase() : null;
    } catch {
      return null;
    }
  }

  async resolveMainEventByUrl(mainEventUrl: string): Promise<{
    isValid: boolean;
    event?: any;
    message?: string;
  }> {
    try {
      const mainEvent = await this.prisma.event.findUnique({
        where: {
          url: mainEventUrl,
          published: { not: null } // Ensure event is published
        }
      });

      if (!mainEvent) {
        return {
          isValid: false,
          message: `Main event with URL "${mainEventUrl}" not found`
        };
      }

      return {
        isValid: true,
        event: mainEvent
      };
    } catch (error) {
      return {
        isValid: false,
        message: 'Main event resolution failed'
      };
    }
  }

  async validateMainEvent(mainEventInput: number | string): Promise<{
    isValid: boolean;
    event?: any;
    message?: string;
  }> {
    try {
      let mainEvent;

      if (typeof mainEventInput === 'string') {
        // Handle URL resolution
        return await this.resolveMainEventByUrl(mainEventInput);
      } else {
        // Handle numeric ID (existing logic for backward compatibility)
        mainEvent = await this.prisma.event.findUnique({
          where: { id: mainEventInput },
        });

        if (!mainEvent) {
          return {
            isValid: false,
            message: 'Invalid main event',
          };
        }
      }

      return {
        isValid: true,
        event: mainEvent,
      };
    } catch (error) {
      return {
        isValid: false,
        message: 'Error validating main event',
      };
    }
  }

  validateEventSettings(settingsData: string): {
    isValid: boolean;
    settings?: any;
    message?: string;
    softError?: string;
  } {
    try {
      if (!settingsData || settingsData.trim() === '') {
        return { isValid: true };
      }

      let settings;
      try {
        settings = JSON.parse(settingsData);
      } catch (parseError) {
        return { 
          isValid: false, 
          message: 'Invalid JSON format in eventSettings' 
        };
      }

      if (typeof settings !== 'object' || settings === null) {
        return { 
          isValid: false, 
          message: 'eventSettings must be an object' 
        };
      }

      const allowedKeys = ['autoApproval', 'regStartDate', 'regEndDate', 'capacity'];
      const providedKeys = Object.keys(settings);
      const invalidKeys = providedKeys.filter(key => !allowedKeys.includes(key));
      
      if (invalidKeys.length > 0) {
        return { 
          isValid: false, 
          message: `Invalid keys in eventSettings: ${invalidKeys.join(', ')}. Allowed keys: ${allowedKeys.join(', ')}` 
        };
      }

      // Validate autoApproval
      if (settings.autoApproval !== undefined && ![0, 1].includes(settings.autoApproval)) {
        return { 
          isValid: false, 
          message: 'autoApproval must be 0 or 1' 
        };
      }

      // Validate date formats and logic
      if (settings.regStartDate && !this.isValidDate(settings.regStartDate)) {
        return { 
          isValid: false, 
          message: 'regStartDate must be in YYYY-MM-DD format' 
        };
      }

      if (settings.regEndDate && !this.isValidDate(settings.regEndDate)) {
        return { 
          isValid: false, 
          message: 'regEndDate must be in YYYY-MM-DD format' 
        };
      }

      // Validate date logic
      if (settings.regStartDate && settings.regEndDate) {
        const startDate = new Date(settings.regStartDate);
        const endDate = new Date(settings.regEndDate);
        
        if (startDate >= endDate) {
          return { 
            isValid: false, 
            message: 'regStartDate must be before regEndDate' 
          };
        }
      }

      // Validate capacity
      if (settings.capacity !== undefined) {
        if (!Number.isInteger(settings.capacity) || settings.capacity < 0) {
          return { 
            isValid: false, 
            message: 'capacity must be a non-negative integer' 
          };
        }
      }

      return { 
        isValid: true, 
        settings
      };

    } catch (error) {
      return { 
        isValid: false, 
        message: 'Event settings validation failed' 
      };
    }
  }

  private isValidDate(dateString: string): boolean {
    const regex = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$/;
    if (!regex.test(dateString)) {
      return false;
    }
    
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
  }

  async validateSalesActionBy(userId: number): Promise<{
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
          message: 'No user exist for the given salesActionBy id',
        };
      }

      return {
        isValid: true,
        user,
      };
    } catch (error) {
      return {
        isValid: false,
        message: 'Error validating salesActionBy user',
      };
    }
  }

  validateSalesAction(salesAction: string): {
    isValid: boolean;
    message?: string;
  } {
    if (!salesAction || salesAction === '') {
      return { isValid: true };
    }

    const datetimeRegex = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])( ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9])?$/;
    
    if (!datetimeRegex.test(salesAction)) {
      return {
        isValid: false,
        message: 'please give date in valid format :YYYY-MM-DD or YYYY-MM-DD HH:mm:ss',
      };
    }

    const date = new Date(salesAction);
    if (isNaN(date.getTime())) {
      return {
        isValid: false,
        message: 'Invalid date value in salesAction',
      };
    }

    return { isValid: true };
  }
}