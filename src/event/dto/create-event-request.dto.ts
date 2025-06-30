import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// handles both full dates and partial dates
const dateValidation = z.string().refine((date) => {
  // Check for YYYY-MM format
  if (/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(date)) {
    return true;
  }
  // Check for YYYY-MM-DD format
  if (/^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$/.test(date)) {
    return true;
  }
  return false;
}, {
  message: 'Date must be in YYYY-MM-DD or YYYY-MM format',
});

// Website format validation
const websiteValidation = z.string().refine((url) => {
  const parsedUrl = new URL(url);
  const urlWithoutQuery = `${parsedUrl.protocol}//${parsedUrl.host}`;
  const regex = /^(https?:\/\/)?(?!.*(?:http:\/\/.*http:\/\/|https:\/\/.*https:\/\/))?(?!www{3,})(www\.)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,15}([\/\w\.\-\?\&\:\=\#\@\+\%]*)*$/;
  return regex.test(urlWithoutQuery);
}, {
  message: 'Website is not in correct format',
});

// Category validation - should be JSON array with max 2 items
const categoryValidation = z.string().transform((val, ctx) => {
  try {
    const parsed = JSON.parse(val);
    if (!Array.isArray(parsed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Category should be a JSON array',
      });
      return z.NEVER;
    }
    
    if (parsed.length > 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select at most 2 categories',
      });
      return z.NEVER;
    }
    
    // Check if all items are numeric
    const allNumeric = parsed.every(item => typeof item === 'number' && Number.isInteger(item));
    if (!allNumeric) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Category should contain only numeric values',
      });
      return z.NEVER;
    }
    
    return parsed as number[];
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid category format',
    });
    return z.NEVER;
  }
});

export const CreateEventRequestSchema = z.object({
  // Required fields
  changesMadeBy: z.number({
    required_error: 'changesMadeBy cannot be empty',
    invalid_type_error: 'changesMadeBy must be a number',
  }),
  
  name: z.string().min(1, 'name cannot be empty'),
  
  type: z.enum(['tradeshow', 'conference', 'workshop', 'meetx', 'business floor'], {
    errorMap: () => ({ message: 'type can be tradeshow/conference/workshop/meetx/business floor' }),
  }),
  
  category: categoryValidation,
  
  startDate: dateValidation.refine((date) => date !== '', {
    message: 'startDate cannot be empty',
  }),
  
  endDate: dateValidation.refine((date) => date !== '', {
    message: 'endDate cannot be empty',
  }),

  // Conditional required fields
  description: z.string().optional(),
  
  public: z.enum(['yes', 'no'], {
    errorMap: () => ({ message: 'public can be yes or no' }),
  }).optional(),

  // Optional fields
  mainEvent: z.number().optional(),
  abbrName: z.string().optional(),
  website: websiteValidation.optional(),
  venue: z.union([z.string(), z.number()]).optional(),
  city: z.union([z.string(), z.number()]).optional(),
  country: z.string().optional(),
  online_event: z.number().optional(),
  publish: z.union([z.literal(1), z.literal(2)]).optional(),
  functionality: z.string().optional(),
  eventAudience: z.string().optional(),
  from: z.string().optional(),
  fromDashboard: z.number().optional(),
  company: z.number().optional(),
  editionNumber: z.number().optional(),
  facebookId: z.string().optional(),
  twitterId: z.string().optional(),
  twitterHashTags: z.string().optional(),
  linkedinId: z.string().optional(),
  googleId: z.string().optional(),
  eventExhibitors: z.number().optional(),
  eventVisitors: z.number().optional(),
  areaTotal: z.number().optional(),
  short_desc: z.string().optional(),
  og_image: z.string().optional(),
  yearBlock: z.boolean().optional(),
  introBlock: z.boolean().optional(),
  customization: z.string().optional(),
  autoApproval: z.number().optional(),
  regStartDate: z.string().optional(),
  regEndDate: z.string().optional(),
  capacity: z.number().optional(),
  remark: z.string().optional(),
  content: z.string().optional(),
  type_val: z.string().optional(),
}).refine((data) => {
  // Custom validation: venue OR city is mandatory
  if (!data.venue && !data.city) {
    return false;
  }
  return true;
}, {
  message: 'venue/city placeId one of them is mandatory',
  path: ['venue'],
}).refine((data) => {
  // Custom validation: description required unless from="manage" or public is set
  if (!data.description && data.from !== 'manage' && !['yes', 'no'].includes(data.public || '')) {
    return false;
  }
  return true;
}, {
  message: 'description cannot be empty',
  path: ['description'],
}).refine((data) => {
  // Custom validation: public field required unless fromDashboard=1
  if (data.fromDashboard !== 1 && !data.public) {
    return false;
  }
  return true;
}, {
  message: 'public cannot be empty',
  path: ['public'],
});

export class CreateEventRequestDto extends createZodDto(CreateEventRequestSchema) {}