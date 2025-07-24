import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { event_visitor, event_questionnaire, questionnaire } from '@prisma/client';

// A helper type to combine the two models
type FullQuestionData = event_questionnaire & {
  questionnaire: questionnaire;
};

@Injectable()
export class QuestionnaireService {
  private readonly logger = new Logger(QuestionnaireService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getEventQuestions(eventId: number) {
    const eventQuestionLinks = await this.prisma.event_questionnaire.findMany({
      where: { event_id: eventId, published: true },
    });

    if (eventQuestionLinks.length === 0) {
      return [];
    }
    
    const questionIds = eventQuestionLinks.map(q => q.question_id);
    const questions = await this.prisma.questionnaire.findMany({
        where: { id: { in: questionIds } },
    });

    // Join the data in your code
    return eventQuestionLinks.map(link => {
        const questionDetail = questions.find(q => q.id === link.question_id);
        if (!questionDetail) return null;

        return {
            id: link.question_id,
            question: questionDetail.question,
            answer_type: questionDetail.answer_type,
            is_mandatory: link.is_mandatory,
            options: JSON.parse(questionDetail.options || '[]')
        };
    }).filter(q => q !== null);
  }

  async processAnswers(
    visitor: event_visitor,
    answers: Record<string, any>,
  ): Promise<{ isValid: boolean; message?: string }> {
    
    // 1. Fetch all question links for the event
    const eventQuestionLinks = await this.prisma.event_questionnaire.findMany({
      where: { event_id: visitor.event, published: true },
    });

    if (eventQuestionLinks.length === 0) {
      this.logger.log(`No questionnaire found for event ${visitor.event}. Skipping.`);
      return { isValid: true };
    }

    // 2. Fetch the actual question details using the IDs from the links
    const questionIds = eventQuestionLinks.map(q => q.question_id);
    const questions = await this.prisma.questionnaire.findMany({
      where: { id: { in: questionIds } },
    });

    // 3. Create a Map for easy lookup, combining data from both tables
    const questionMap = new Map<number, FullQuestionData>();
    eventQuestionLinks.forEach(link => {
      const questionDetail = questions.find(q => q.id === link.question_id);
      if (questionDetail) {
        questionMap.set(link.question_id, {
          ...link,
          questionnaire: questionDetail,
        });
      }
    });

    // 4. Validate the submitted answers
    const validationResult = this.validateAnswers(answers, questionMap);
    if (!validationResult.isValid) {
      return validationResult;
    }

    // 5. Save the validated answers
    await this.saveAnswers(visitor, validationResult.validatedAnswers!);

    return { isValid: true };
  }

  private validateAnswers(
    answers: Record<string, any>,
    questionMap: Map<number, FullQuestionData>,
  ): { isValid: boolean; message?: string; validatedAnswers?: Record<number, string> } {
    const validatedAnswers: Record<number, string> = {};

    for (const q of questionMap.values()) {
        const questionId = q.question_id;
        const answer = answers[questionId];

        if (q.is_mandatory && (answer === undefined || answer === null || answer === '')) {
            return { isValid: false, message: `Answer for mandatory question '${q.questionnaire.question}' is missing.` };
        }

        if (answer !== undefined && answer !== null && answer !== '') {
            const questionDef = q.questionnaire;
            let finalAnswer = Array.isArray(answer) ? answer.join(',') : String(answer);

            // For single/multi-choice, validate against options
            // Note: answer_type in your schema is Boolean, so we'll treat true as multi-choice
            // if (questionDef.answer_type === true) { // Multi-choice
            //     const options = JSON.parse(questionDef.options || '[]').map((opt: string) => opt.trim());
            //     const submittedOptions = Array.isArray(answer) ? answer : answer.split(',');

            //     for (const opt of submittedOptions) {
            //         if (!options.includes(String(opt).trim()) && !["Other", "Please Specify"].includes(String(opt).trim())) {
            //             return { isValid: false, message: `Invalid option '${opt}' for question '${questionDef.question}'.` };
            //         }
            //     }
            // } else if (questionDef.options) { // Single-choice with options
            //      const options = JSON.parse(questionDef.options || '[]').map((opt: string) => opt.trim());
            //      if (!options.includes(finalAnswer.trim()) && !["Other", "Please Specify"].includes(finalAnswer.trim())) {
            //         return { isValid: false, message: `Invalid option '${finalAnswer}' for question '${questionDef.question}'.` };
            //      }
            // }

            switch (questionDef.answer_type) {
                case 1: // Single-Select Validation
                    const singleOptions = JSON.parse(questionDef.options || '[]').map((opt: string) => opt.trim());
                    if (!singleOptions.includes(finalAnswer.trim()) && !["Other", "Please Specify"].includes(finalAnswer.trim())) {
                        return { isValid: false, message: `Invalid option '${finalAnswer}' for question '${questionDef.question}'.` };
                    }
                    break;
                
                case 2: // Multi-Select Validation
                    const multiOptions = JSON.parse(questionDef.options || '[]').map((opt: string) => opt.trim());
                    const submittedOptions = Array.isArray(answer) ? answer : answer.split(',');

                    for (const opt of submittedOptions) {
                        if (!multiOptions.includes(String(opt).trim()) && !["Other", "Please Specify"].includes(String(opt).trim())) {
                            return { isValid: false, message: `Invalid option '${opt}' for question '${questionDef.question}'.` };
                        }
                    }
                    break;

                case 0: // Text type, no specific validation needed
                default:
                    break;
            }
             validatedAnswers[questionId] = finalAnswer;
        }
    }
    return { isValid: true, validatedAnswers };
  }

  private async saveAnswers(
    visitor: event_visitor,
    validatedAnswers: Record<number, string>,
  ): Promise<void> {
    const promises = Object.entries(validatedAnswers).map(([questionId, answer]) => {
      return this.prisma.visitor_questionnaire.upsert({
        where: {
          visitor_id_question_id: {
            visitor_id: visitor.id,
            question_id: Number(questionId),
          },
        },
        update: {
          answer: answer,
          modified: new Date(),
        },
        create: {
          event_id: visitor.event,
          visitor_id: visitor.id,
          question_id: Number(questionId),
          answer: answer,
          created: new Date(),
        },
      });
    });
    await this.prisma.$transaction(promises);
    this.logger.log(`Saved ${promises.length} answers for visitor ${visitor.id}.`);
  }
}