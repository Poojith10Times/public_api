import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const VisitorRegistrationRequestSchema = z.object({
  eventId: z.number(),
  editionId: z.number(),
  userId: z.number().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  name: z.string().optional(),
  city: z.number().optional(),
  country: z.number().optional(),
  company: z.string().optional(),
  designation: z.string().optional(),
  interests: z.array(z.string()).optional(),
  answers: z.record(z.any()).optional(),
  source: z.string().optional(),
  badgeId: z.string().optional()
});

export class VisitorRegistrationDto extends createZodDto(
  VisitorRegistrationRequestSchema,
) {}