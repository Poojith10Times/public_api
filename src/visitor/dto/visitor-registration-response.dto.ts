import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const VisitorRegistrationResponseSchema = z.object({
  status: z.object({
    code: z.number(),
    message: z.string(),
  }),
  data: z
    .object({
      visitorId: z.number(),
      userId: z.number(),
    })
    .optional(),
});

export class VisitorRegistrationResponseDto extends createZodDto(
  VisitorRegistrationResponseSchema,
) {}