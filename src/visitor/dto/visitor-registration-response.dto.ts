import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const QuestionSchema = z.object({
  id: z.number(),
  question: z.string(),
  answer_type: z.number(),
  is_mandatory: z.boolean(),
  options: z.array(z.string()).optional().nullable(),
});

export const VisitorRegistrationResponseSchema = z.object({
  status: z.object({
    code: z.number(),
    message: z.string(),
  }),
  data: z
    .object({
      visitorId: z.number(),
      userId: z.number(),
      questions: z.array(QuestionSchema).optional(),
    })
    .optional(),
});

export class VisitorRegistrationResponseDto extends createZodDto(
  VisitorRegistrationResponseSchema,
) {}