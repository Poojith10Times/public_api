import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ResponseStatusSchema = z.object({
  code: z.number(),
  message: z.array(z.string()),
  error_message: z.array(z.string()).optional(),
  softError: z.array(z.string()).optional(),
});

// Event response data schema
export const EventResponseDataSchema = z.object({
  id: z.number(),
  edition: z.number().optional(),
  shareableUrl: z.string().optional(),
  pre_review: z.number().optional(),
  post_review: z.number().optional(),
  mailResponse: z.any().optional(),
});

export const EventUpsertResponseSchema = z.object({
  status: ResponseStatusSchema,
  data: EventResponseDataSchema.optional(),
});

export class EventUpsertResponseDto extends createZodDto(EventUpsertResponseSchema) {}

export const createSuccessResponse = (data: any, message: string = 'Success') => ({
  status: {
    code: 1,
    message: [message],
  },
  data,
});

export const createErrorResponse = (messages: string[], errorMessages?: string[]) => ({
  status: {
    code: 0,
    message: messages,
    error_message: errorMessages,
  },
});