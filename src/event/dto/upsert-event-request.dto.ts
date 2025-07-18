import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const dateValidation = z.string().refine((date) => {
  // Check for YYYY-MM format (partial dates)
  if (/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(date)) {
    return true;
  }
  // Check for YYYY-MM-DD format (full dates)
  if (/^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$/.test(date)) {
    return true;
  }
  return false;
}, {
  message: 'Date must be in YYYY-MM-DD or YYYY-MM format',
});

// Website format validation 
const websiteValidation = z.string().refine((url) => {
  if (!url || url === '') return true;
  
  try {
    const parsedUrl = new URL(url);
    const urlWithoutQuery = `${parsedUrl.protocol}//${parsedUrl.host}`;
    const regex = /^(https?:\/\/)?(?!.*(?:http:\/\/.*http:\/\/|https:\/\/.*https:\/\/))?(?!www{3,})(www\.)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,15}([\/\w\.\-\?\&\:\=\#\@\+\%]*)*$/;
    return regex.test(urlWithoutQuery);
  } catch {
    return false;
  }
}, {
  message: 'website is not in correct format',
});



const contactValidation = z.string().refine((val) => {
  if (!val || val.trim() === '') return true;
  
  try {
    const contacts = JSON.parse(val);
    
    if (!Array.isArray(contacts)) {
      return false;
    }
    
    return contacts.every((contact, index) => {
      if (typeof contact !== 'object' || contact === null) {
        return false;
      }
      
      // EXACT keys from PHP code
      const allowedKeys = ['email', 'website', 'verifiedBy'];
      const providedKeys = Object.keys(contact);
      const invalidKeys = providedKeys.filter(key => !allowedKeys.includes(key));
      
      if (invalidKeys.length > 0) {
        return false;
      }
      
      // Email is required (from PHP code)
      if (!contact.email || typeof contact.email !== 'string') {
        return false;
      }
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(contact.email)) {
        return false;
      }
      
      // Website is optional string
      if (contact.website && typeof contact.website !== 'string') {
        return false;
      }
      
      // VerifiedBy is optional number
      if (contact.verifiedBy !== undefined && !Number.isInteger(contact.verifiedBy)) {
        return false;
      }
      
      return true;
    });
  } catch {
    return false;
  }
}, {
  message: 'contact must be valid JSON array with email (required), website (optional), verifiedBy (optional)',
}).optional();

const statsValidation = z.union([
  z.string().transform((val, ctx) => {
    if (!val || val.trim() === '') return undefined;
    
    try {
      const parsed = JSON.parse(val);
      
      if (typeof parsed !== 'object' || parsed === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'invalid format for stats, for reference format is {"visitors":"300","exhibitors":"300","area":"200"}',
        });
        return z.NEVER;
      }

      // EXACT keys from PHP code
      const allowedKeys = ['visitors', 'exhibitors', 'area'];
      const providedKeys = Object.keys(parsed);
      const invalidKeys = providedKeys.filter(key => !allowedKeys.includes(key));
      
      if (invalidKeys.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid keys in stats: ${invalidKeys.join(', ')}. Allowed keys: ${allowedKeys.join(', ')}`,
        });
        return z.NEVER;
      }

      return parsed;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'invalid format for stats, for reference format is {"visitors":"300","exhibitors":"300","area":"200"}',
      });
      return z.NEVER;
    }
  }),
  z.object({
    visitors: z.union([z.string(), z.number()]).optional(),
    exhibitors: z.union([z.string(), z.number()]).optional(),
    area: z.union([z.string(), z.number()]).optional(),
  }).strict()
]).optional();

const eventSettingsValidation = z.string().refine((settings) => {
  if (!settings || settings.trim() === '') return true;
  
  try {
    const parsed = JSON.parse(settings);
    
    if (typeof parsed !== 'object' || parsed === null) {
      return false;
    }
    
    // Strict key validation
    const allowedKeys = ['autoApproval', 'regStartDate', 'regEndDate', 'capacity'];
    const providedKeys = Object.keys(parsed);
    const invalidKeys = providedKeys.filter(key => !allowedKeys.includes(key));
    
    if (invalidKeys.length > 0) {
      return false;
    }
    
    // Validate autoApproval
    if (parsed.autoApproval !== undefined && ![0, 1].includes(parsed.autoApproval)) {
      return false;
    }
    
    // Validate date formats
    const dateRegex = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$/;
    if (parsed.regStartDate && !dateRegex.test(parsed.regStartDate)) {
      return false;
    }
    
    if (parsed.regEndDate && !dateRegex.test(parsed.regEndDate)) {
      return false;
    }
    
    // Validate capacity
    if (parsed.capacity !== undefined && (!Number.isInteger(parsed.capacity) || parsed.capacity < 0)) {
      return false;
    }
    
    // Validate date logic
    if (parsed.regStartDate && parsed.regEndDate) {
      const startDate = new Date(parsed.regStartDate);
      const endDate = new Date(parsed.regEndDate);
      if (startDate >= endDate) {
        return false;
      }
    }
    
    return true;
  } catch {
    return false;
  }
}, {
  message: 'eventSettings must be valid JSON with correct structure. Allowed keys: autoApproval (0|1), regStartDate (YYYY-MM-DD), regEndDate (YYYY-MM-DD), capacity (number)',
}).optional()

const productValidation = z.string().refine((val) => {
  if (!val || val.trim() === '') return true;
  
  try {
    const products = JSON.parse(val);
    
    // Can be object (key-value pairs) or array
    if (Array.isArray(products)) {
      // Array format - just validate each item is string or number
      return products.every(product => 
        typeof product === 'string' || typeof product === 'number'
      );
    }
    
    if (typeof products === 'object' && products !== null) {
      // Object format - validate keys and values
      for (const [productKey, publishedStatus] of Object.entries(products)) {
        if (typeof productKey !== 'string' || productKey.trim().length === 0) {
          return false;
        }
        
        if (!['0', '1'].includes(publishedStatus as string)) {
          return false;
        }
      }
      return true;
    }
    
    return false;
  } catch {
    return false;
  }
}, {
  message: 'product must be valid JSON array or object with product keys and "0"/"1" values',
}).optional();

const subVenueValidation = z.string().refine((val) => {
  if (!val || val.trim() === '') return true;
  
  try {
    const subVenues = JSON.parse(val);
    
    if (!Array.isArray(subVenues)) {
      return false;
    }
    
    return subVenues.every(subVenue => {
      // Can be string, number (as per PHP code)
      if (typeof subVenue === 'string' || typeof subVenue === 'number') {
        return subVenue.toString().trim().length > 0;
      }
      
      // Or object with id/name (inferred from PHP logic)
      if (typeof subVenue === 'object' && subVenue !== null) {
        const allowedKeys = ['id', 'name'];
        const providedKeys = Object.keys(subVenue);
        const invalidKeys = providedKeys.filter(key => !allowedKeys.includes(key));
        
        if (invalidKeys.length > 0) {
          return false;
        }
        
        return subVenue.id !== undefined || subVenue.name !== undefined;
      }
      
      return false;
    });
  } catch {
    return false;
  }
}, {
  message: 'invalid format of json',
}).optional();

const timingValidation = z.union([
  z.string().transform((val, ctx) => {
    if (!val || val.trim() === '') return undefined;
    
    try {
      const parsed = JSON.parse(val);
      
      if (!Array.isArray(parsed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'wrong timimg format',
        });
        return z.NEVER;
      }
      
      // EXACT keys from PHP code
      const allowedKeys = ['type', 'Start_time', 'end_time', 'days', 'timezone', 'timezonecountry'];
      
      for (const [index, timing] of parsed.entries()) {
        if (typeof timing !== 'object' || timing === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'wrong timimg format',
          });
          return z.NEVER;
        }
        
        const providedKeys = Object.keys(timing);
        const invalidKeys = providedKeys.filter(key => !allowedKeys.includes(key));
        
        if (invalidKeys.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid keys in timing[${index}]: ${invalidKeys.join(', ')}. Allowed keys: ${allowedKeys.join(', ')}`,
          });
          return z.NEVER;
        }
        
        // Required fields from PHP validation
        if (!timing.Start_time || !timing.end_time) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'wrong timimg format',
          });
          return z.NEVER;
        }
        
        // Exact regex from PHP code
        const timeRegex = /^(1[0-2]|0?[1-9]):[0-5][0-9] (AM|PM)$/i;
        if (!timeRegex.test(timing.Start_time) || !timeRegex.test(timing.end_time)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'wrong timimg format',
          });
          return z.NEVER;
        }
      }
      
      return parsed;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'wrong timimg format',
      });
      return z.NEVER;
    }
  }),
  z.array(z.object({
    type: z.string().optional(),
    Start_time: z.string().regex(/^(1[0-2]|0?[1-9]):[0-5][0-9] (AM|PM)$/i, 'wrong timimg format'),
    end_time: z.string().regex(/^(1[0-2]|0?[1-9]):[0-5][0-9] (AM|PM)$/i, 'wrong timimg format'),
    days: z.string().optional(),
    timezone: z.string().optional(),
    timezonecountry: z.string().optional(),
  }).strict())
]).optional();

const highlightsValidation = z.string().refine((val) => {
  if (!val || val.trim() === '') return true;
  
  try {
    const highlights = JSON.parse(val);
    
    if (!Array.isArray(highlights)) {
      return false;
    }
    
    return highlights.every((highlight, index) => {
      if (typeof highlight !== 'object' || highlight === null) {
        return false;
      }
      
      // Strict key validation
      const allowedKeys = ['title', 'description', 'icon', 'order'];
      const providedKeys = Object.keys(highlight);
      const invalidKeys = providedKeys.filter(key => !allowedKeys.includes(key));
      
      if (invalidKeys.length > 0) {
        return false;
      }
      
      // Title is required
      if (!highlight.title || typeof highlight.title !== 'string' || highlight.title.trim().length === 0) {
        return false;
      }
      
      // Optional fields type validation
      if (highlight.description !== undefined && typeof highlight.description !== 'string') {
        return false;
      }
      
      if (highlight.icon !== undefined && typeof highlight.icon !== 'string') {
        return false;
      }
      
      if (highlight.order !== undefined && !Number.isInteger(highlight.order)) {
        return false;
      }
      
      return true;
    });
  } catch {
    return false;
  }
}, {
  message: 'highlights must be valid JSON array. Each item needs title (required) and optionally: description, icon, order. No other keys allowed.',
}).optional();


export const EventUpsertRequestSchema = z.object({

  eventId: z.number(),
  name: z.string().optional(),
  abbrName: z.string().optional(),
  punchline: z.string().optional(),
  description: z.string().optional(),
  shortDesc: z.string().optional(),  
  type: z.array(z.string().min(1)).optional(), 
  category: z.array(z.string()).max(2, 'Select at most 2 categories').optional(),  
  startDate: dateValidation.optional(),
  endDate: dateValidation.optional(),
  
  city: z.union([z.string(), z.number()]).optional(),
  venue: z.union([z.string(), z.number()]).optional(),
  country: z.string().optional(),
  
  company: z.string().optional(),
  
  website: websiteValidation.optional(),
  
  facebookId: z.string().optional(),
  twitterId: z.string().optional(),
  twitterHashTags: z.string().optional(), // is it needed?
  linkedinId: z.string().optional(),
  googleId: z.string().optional(),
  
  stats: statsValidation.optional(), 
 
  product: productValidation,  
  editionId: z.number().optional(),
  
  timing: timingValidation.optional(),
  
  highlights: z.string().optional(),
  docs: z.string().optional(),
  
  logo: z.number().optional(),
  wrapper: z.number().optional(),
  wrapperSmall: z.number().optional(),
  introVideo: z.string().optional(),
  ogImage: z.number().optional(),
  brochure: z.number().optional(),
  customization: z.string().optional(),
  
  frequency: z.string().optional(),
  brand: z.number().optional(), 
  
  mailType: z.number().optional(),
  adsense: z.boolean().optional(),

  salesAction: z.string().refine((date) => {
    if (!date || date === '') return true;
      const datetimeRegex = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])( ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9])?$/;
    return datetimeRegex.test(date);
  }, {
    message: 'salesAction must be in YYYY-MM-DD or YYYY-MM-DD HH:mm:ss format',
  }).optional(),

  salesActionBy: z.number({
    invalid_type_error: 'salesActionBy must be a number',
  }).optional(),

  salesStatus: z.string().optional(),

  salesRemark: z.string().optional(),

  eventSettings: eventSettingsValidation,
  
  contact: contactValidation,

  subVenue: subVenueValidation,
  
  customFlag: z.string().optional(),
  eepProcess: z.number().optional(),
  

  visibility: z.enum(['private', 'draft']).optional(),
    
}).refine((data) => {
  if (!data.eventId) return false;
  return true;
}, {
  message: "Missing required fields for event creation"
}).refine((data) => {
  if (data.startDate && data.endDate) {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (start >= end) return false;
  }
  return true;
}, {
  message: "startDate should be less than endDate",
  path: ["endDate"]
});

export class EventUpsertRequestDto extends createZodDto(EventUpsertRequestSchema) {}