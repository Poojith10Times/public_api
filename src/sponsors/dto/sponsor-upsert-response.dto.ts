import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SponsorUpsertResponseSchema = z.object({
  status: z.object({
    code: z.number(),
    message: z.string(),
  }),
  data: z
    .object({
      sponsorId: z.number(),
    })
    .optional(),
});

export class SponsorUpsertResponseDto extends createZodDto(SponsorUpsertResponseSchema) {}