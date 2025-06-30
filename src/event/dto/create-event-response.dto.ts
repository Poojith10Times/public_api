import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateEventResponseSchema = z.object({
  status: z.object({
    code: z.number(),
    message: z.array(z.string()),
    error: z.array(z.string()).optional(),
  }),
  data: z.object({
    id: z.number(),
    edition: z.number(),
    pre_review: z.number().optional(),
    post_review: z.number().optional(),
  }).optional(),
});

export class CreateEventResponseDto extends createZodDto(CreateEventResponseSchema) {}