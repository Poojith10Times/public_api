import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SponsorUpsertRequestSchema = z.object({
  sponsorId: z.number().optional(),
  eventId: z.number(),
  editionId: z.number().optional(),
  companyId: z.number().optional(),
  name: z.string().optional(),
  website: z.string().optional(),
  title: z.string().optional(),
  logo: z.union([z.string(), z.number()]).optional(),
  position: z.number().optional(),
  published: z.number().optional(),
  verified: z.boolean().optional(),
});

export class SponsorUpsertRequestDto extends createZodDto(SponsorUpsertRequestSchema) {}