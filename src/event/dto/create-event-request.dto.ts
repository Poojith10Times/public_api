import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const dateValidation = z.string().refine((date) => {
  // YYYY-MM format
  if (/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(date)) {
    return true;
  }
  // YYYY-MM-DD format
  if (/^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$/.test(date)) {
    return true;
  }
  return false;
}, {
  message: 'Date must be in YYYY-MM-DD or YYYY-MM format',
});

const websiteValidation = z.string().refine((url) => {
  const parsedUrl = new URL(url);
  const urlWithoutQuery = `${parsedUrl.protocol}//${parsedUrl.host}`;
  const regex = /^(https?:\/\/)?(?!.*(?:http:\/\/.*http:\/\/|https:\/\/.*https:\/\/))?(?!www{3,})(www\.)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,15}([\/\w\.\-\?\&\:\=\#\@\+\%]*)*$/;
  return regex.test(urlWithoutQuery);
}, {
  message: 'Website is not in correct format',
});

const websiteValidationAlt = z.string().refine((url) => {
  if (!url || url.trim() === '') return false;
  
  // Basic format check without URL constructor
  const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/i;
  return urlPattern.test(url);
}, {
  message: 'Website is not in correct format (e.g., example.com or https://example.com)',
});

const categoryValidation = z.array(z.string())
  .max(2, 'Select at most 2 categories')
  .optional();

export const CreateEventRequestSchema = z.object({
  
  name: z.string().min(1, 'name cannot be empty'),
  type: z.array(z.string()).min(1, 'type cannot be empty'),
  category: categoryValidation,
  startDate: dateValidation.refine((date) => date !== '', {
    message: 'startDate cannot be empty',
  }),
  endDate: dateValidation.refine((date) => date !== '', {
    message: 'endDate cannot be empty',
  }),
  mainEvent: z.string().optional(), 
  abbrName: z.string().optional(),
  website: websiteValidationAlt.optional(),
  venue: z.union([z.string(), z.number()]).optional(),
  city: z.union([z.string(), z.number()]).optional(),
  country: z.string().optional(),
  visibility: z.enum(['private', 'draft']).optional(), 
  product: z.string().optional(),
  company: z.string().optional(),

}).refine((data) => {
  if (!data.venue && !data.city) {
    return false;
  }
  return true;
}, {
  message: 'venue/city placeId one of them is mandatory',
  path: ['venue'],
});
export class CreateEventRequestDto extends createZodDto(CreateEventRequestSchema) {}