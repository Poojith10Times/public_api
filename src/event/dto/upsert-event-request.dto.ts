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

// Time format validation for timing
const timeValidation = z.string().refine((time) => {
  return /^(1[0-2]|0?[1-9]):[0-5][0-9] (AM|PM)$/i.test(time);
}, {
  message: 'wrong timing format',
});

// JSON array validation for categories (max 2 items)
const categoryValidation = z.string().transform((val, ctx) => {
  try {
    const parsed = JSON.parse(val);
    if (!Array.isArray(parsed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'category should be a JSON array',
      });
      return z.NEVER;
    }
    
    if (parsed.length > 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'select atmost 2 category',
      });
      return z.NEVER;
    }
    
    // Check if all items are numeric
    const allNumeric = parsed.every(item => typeof item === 'number' && Number.isInteger(item));
    if (!allNumeric) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'category should be in numeric',
      });
      return z.NEVER;
    }
    
    return parsed as number[];
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'invalid category format',
    });
    return z.NEVER;
  }
});


// Stats validation
const statsValidation = z.union([
  z.string().transform((val, ctx) => {
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed !== 'object' || parsed === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'invalid format for stats',
        });
        return z.NEVER;
      }
      return parsed;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'invalid format for stats',
      });
      return z.NEVER;
    }
  }),
  z.object({}).passthrough() 
]).optional();

// Timing validation
const timingValidation = z.union([
  z.string().transform((val, ctx) => {
    try {
      const parsed = JSON.parse(val);
      if (!Array.isArray(parsed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'wrong timing format',
        });
        return z.NEVER;
      }
      
      // Validate each timing object
      for (const timing of parsed) {
        if (!timing.Start_time || !timing.end_time) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'wrong timing format',
          });
          return z.NEVER;
        }
      }
      
      return parsed;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'wrong timing format',
      });
      return z.NEVER;
    }
  }),
  z.array(z.object({
    type: z.string().optional(),
    Start_time: z.string(),
    end_time: z.string(),
    days: z.string().optional(),
    timezone: z.string().optional(),
    timezonecountry: z.string().optional(),
  }))
]).optional();

// Event Upsert Schema
export const EventUpsertRequestSchema = z.object({

  id: z.number().optional(), // If present, it's an update
  
  // Required for creation
  changesMadeBy: z.number({
    required_error: 'changesMadeBy cannot be empty',
    invalid_type_error: 'changesMadeBy must be a number',
  }),
  
  // Event basic info
  name: z.string().optional(),
  eventAbbrname: z.string().optional(),
  abbrName: z.string().optional(),
  eventPunchline: z.string().optional(),
  punchline: z.string().optional(),
  desc: z.string().optional(),
  description: z.string().optional(),
  short_desc: z.string().optional(),
  
  // Event type and categorization
  eventType: z.union([z.string(), z.number()]).optional(),
  type: z.enum(['tradeshow', 'conference', 'workshop', 'meetx', 'business floor']).optional(),
  subEventType: z.number().optional(),
  typeVal: z.string().optional(),
  type_val: z.string().optional(),
  eventAudience: z.string().optional(),
  category: categoryValidation.optional(),
  
  // Dates
  startDate: dateValidation.optional(),
  endDate: dateValidation.optional(),
  when: z.string().optional(),
  
  // Location
  city: z.union([z.string(), z.number()]).optional(),
  venue: z.union([z.string(), z.number()]).optional(),
  venueId: z.union([z.string(), z.number()]).optional(),
  country: z.string().optional(),
  city_code: z.union([z.string(), z.number()]).optional(),
  removeVenue: z.number().optional(),
  
  // Organization
  companyId: z.union([z.string(), z.number()]).optional(),
  company: z.union([z.string(), z.number()]).optional(),
  
  // Web presence
  website: websiteValidation.optional(),
  eventWebsite: websiteValidation.optional(),
  url: z.string().optional(),
  
  // Social media
  facebookUrl: z.string().optional(),
  facebookId: z.string().optional(),
  twitterId: z.string().optional(),
  twitterHashTags: z.string().optional(),
  linkedinId: z.string().optional(),
  googleId: z.string().optional(),
  
  // Statistics
  eventExhibitors: z.number().optional(),
  eventVisitors: z.number().optional(),
  event_exhibitors: z.number().optional(),
  event_visitors: z.number().optional(),
  areaTotal: z.number().optional(),
  stats: statsValidation.optional(),
  
  // Products
  eventProducts: z.string().optional(),
  product: z.string().optional(),
  
  // Edition management
  edition: z.number().optional(),
  editionNumber: z.number().optional(),
  rehost: z.number().optional(),
  
  // Timing
  timing: timingValidation.optional(),
  o_timing1: z.array(z.string()).optional(),
  timing_start_time: z.array(z.string()).optional(),
  timing_end_time: z.array(z.string()).optional(),
  multidays_days: z.array(z.string()).optional(),
  o_timezone: z.array(z.string()).optional(),
  timezonecountry: z.array(z.string()).optional(),
  
  // Event data
  eventHighlights: z.string().optional(),
  eventDocs: z.string().optional(),
  deleteEventDocs: z.string().optional(),
  estimatedTurnout: z.string().optional(),
  
  // Media and attachments
  logo: z.number().optional(),
  wrapper: z.number().optional(),
  wrapperSmall: z.number().optional(),
  introvideo: z.string().optional(),
  stream_url: z.string().optional(),
  og_image: z.number().optional(),
  brochure: z.number().optional(),
  customization: z.string().optional(),
  
  // Settings
  published: z.number().optional(),
  status: z.enum(['U', 'P', 'C']).optional(),
  eventStatus: z.enum(['U', 'P', 'C']).optional(),
  online_event: z.number().optional(),
  onlineEvent: z.union([z.string(), z.number()]).optional(),
  multiCity: z.number().optional(),
  frequency: z.string().optional(),
  brandId: z.number().optional(),
  
  // Additional fields
  mailType: z.number().optional(),
  adsense: z.boolean().optional(),
  iosUrl: z.string().optional(),
  ios_url: z.string().optional(),
  androidUrl: z.string().optional(),
  android_url: z.string().optional(),
  oldEdition: z.number().optional(),
  removeDescription: z.literal('description').optional(),
  deleteIntroVideo: z.number().optional(),
  commonPin: z.string().optional(),
  commonEnable: z.number().optional(),
  checkinValidity: z.string().optional(),
  exhibitorProfile: z.string().optional(),
  salesAction: z.string().optional(),
  salesActionBy: z.number().optional(),
  salesStatus: z.string().optional(),
  salesRemark: z.string().optional(),
  regStartDate: z.string().optional(),
  regEndDate: z.string().optional(),
  capacity: z.number().optional(),
  autoApproval: z.number().optional(),
  exhibitor: z.string().optional(),
  
  // User and tracking
  changesMadeFrom: z.string().optional(),
  addedBy: z.number().optional(),
  qcBy: z.number().optional(),
  bypassQC: z.boolean().optional(),
  
  // Future event
  future: z.string().optional(), 
  
  // Contact management
  contactAdd: z.string().optional(), 
  contactDelete: z.string().optional(),
    
  // Creation flags
  createUrl: z.number().optional(),
  fromDashboard: z.number().optional(),
  from: z.string().optional(),
  subVenue: z.string().refine((val) => {
    if (!val) return true; 
    try {
      const parsed = JSON.parse(val);
      if (!Array.isArray(parsed)) return false;
      return parsed.every(item => 
        typeof item === 'number' || 
        typeof item === 'string' ||
        (typeof item === 'object' && item !== null && (item.id || item.name))
      );
    } catch {
      return false;
    }
  }, {
    message: 'subVenue must be a valid JSON array of sub-venue IDs or names',
  }).optional(),
  
  // Custom fields
  customFlag: z.string().optional(),
  eepProcess: z.number().optional(),
  
  // Removal operations
  remove: z.literal('description').optional(),


  // QC and Review fields
  preReviewId: z.number().optional(),
  vendorId: z.number().optional(),
  remark: z.string().optional(),
  enrichment: z.number().optional(),
  Qcstatus: z.string().optional(),
  blacklist_rule: z.number().optional(),
  verified_categories: z.string().optional(),
  functionality: z.enum(['open', 'private', 'draft']).optional(),
  restrictionLevel: z.string().optional(),

  // Additional QC workflow fields
  noMail: z.number().optional(),
  event_strength: z.string().optional(),
  expiredControl: z.number().optional(),
    
}).refine((data) => {
  // For creation (no id), validate required fields
  if (!data.id) {
    if (!data.name) return false;
    if (!data.eventType && !data.type) return false;
    if (!data.eventAbbrname && !data.abbrName) return false;
    if (!data.desc && !data.description) return false;
    if (!data.category) return false;
    if (!data.when && (!data.startDate || !data.endDate)) return false;
    if (!data.companyId && !data.company) return false;
    if (!data.venueId && !data.venue) return false;
  }
  return true;
}, {
  message: "Missing required fields for event creation"
}).refine((data) => {
  // Date validation: startDate should be less than endDate
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