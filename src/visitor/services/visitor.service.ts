import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserService } from '../../user/services/user.service';
import { VisitorRegistrationDto } from './../dto/visitor-registration.dto';
import {
  VisitorRegistrationResponseDto,
} from './../dto/visitor-registration-response.dto';
import { UserUpsertRequestDto } from '../../user/dto/user-upsert-request.dto';
import { event_visitor, user } from '@prisma/client';
import { VisitorValidationService, PreparedVisitorData } from './visitor-validation.service';
import { BadgeService } from './badge.service';
import { QuestionnaireService } from './questionnaire.service';
import { KafkaProducerService } from '../../kafka/kafka.producer.service';
import { LeadsPushService } from './leads-push.service';

@Injectable()
export class VisitorService {
  private readonly logger = new Logger(VisitorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly validationService: VisitorValidationService,
    private readonly badgeService: BadgeService,
    private readonly questionnaireService: QuestionnaireService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly leadsPushService: LeadsPushService,
  ) {}

  async register(
    registrationData: VisitorRegistrationDto,
    requestingUserId: number,
    source: string,
    tokenUserId?: number,
  ): Promise<VisitorRegistrationResponseDto> {
    this.logger.log(
      `Visitor registration initiated by user: ${requestingUserId} from source: ${source}`,
    );

    try {
      // 1. Authentication and Authorization
      const authResult = await this.validationService.validateUserAuthorization(requestingUserId, registrationData.eventId);
      if (!authResult.isValid) {
          return { status: { code: 0, message: authResult.message || 'Authorization failed' } };
      }

      const sourceValidation = this.validationService.validateSource(source, authResult.authType);
      if (!sourceValidation.isValid) {
          return { status: { code: 0, message: sourceValidation.message || 'Invalid source' } };
      }

      let targetUserId = registrationData.userId;
      let changesMadeBy = requestingUserId; 
      if (authResult.authType === 'internal_access' && tokenUserId) {
        this.logger.log(`Internal access: Using token-user-id ${tokenUserId} for registration and as changesMadeBy.`);
        targetUserId = tokenUserId;
        changesMadeBy = tokenUserId;
      }

      // 2. Upsert User (Create or Update)
      const userUpsertDto: UserUpsertRequestDto = {
        ...registrationData,
        userId: targetUserId,
        changesMadeBy: changesMadeBy,
        source: source,
      };

      const userResponse = await this.userService.upsertUser(userUpsertDto);

      if (userResponse.status?.code === 0 || !userResponse.data?.[0]?.id) {
        return {
          status: {
            code: 0,
            message:
              userResponse.status.message?.join(', ') ||
              'Failed to create or update user',
          },
        };
      }
      
      const userId = userResponse.data[0].id;
      const user = await this.prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        return { status: { code: 0, message: 'User could not be retrieved after upsert.' }};
      }

      // SCENARIO 1: Answer Submission and Finalization
      if (registrationData.answers) {
        this.logger.log(`Processing questionnaire answers for user ${userId}`);

        const visitor = await this.prisma.event_visitor.findFirst({
            where: { user: userId, event: registrationData.eventId }
        });

        if (!visitor) {
            return { status: { code: 0, message: 'Visitor record not found. Please complete initial registration first.' }};
        }

        const questionnaireResult = await this.questionnaireService.processAnswers(visitor, registrationData.answers);

        if (!questionnaireResult.isValid) {
            return { status: { code: 0, message: questionnaireResult.message || 'Questionnaire validation failed.'}};
        }
        
        // Mark visitor as fully complete
        await this.prisma.event_visitor.update({
            where: { id: visitor.id },
            data: { completed_on: new Date() }
        });

        // Trigger final communications via Kafka
        this.kafkaProducer.sendMessage('email-notifications', { type: 'visitor-confirmation', visitorId: visitor.id });
        this.kafkaProducer.sendMessage('email-notifications', { type: 'organizer-notification', visitorId: visitor.id });
        
        return { status: { code: 1, message: 'Answers submitted successfully.' } };
      } 
      // SCENARIO 2: Initial Registration
      else {
        this.logger.log(`Processing initial registration for user ${userId}`);

        const validationResult = await this.validationService.validateAndPrepareData(registrationData, user);
        if (!validationResult.isValid) {
            return { status: { code: 0, message: validationResult.message || 'Visitor data validation failed' } };
        }

        let visitor = await this.createOrUpdateVisitor(validationResult.data!, requestingUserId);
        
        const badgeId = await this.badgeService.assignBadgeToVisitor(visitor, registrationData);
        if (badgeId) {
            visitor = await this.prisma.event_visitor.update({ where: { id: visitor.id }, data: { badge: badgeId } });
        }

        if (visitor.completed_on) {
          this.leadsPushService.pushLead(visitor).catch(err => {
              this.logger.error(`Failed to push lead for visitor ${visitor.id}`, err);
          });
      }

        const questions = await this.questionnaireService.getEventQuestions(visitor.event);

        return {
            status: { code: 1, message: 'Registration successful. Please submit answers.' },
            data: {
                visitorId: visitor.id,
                userId: user.id,
                questions: questions,
            },
        };
      }
    } catch (error) {
      this.logger.error('Error during visitor registration:', error);
      return {
        status: { code: 0, message: 'An unexpected error occurred.' },
      };
    }
  }

  private async createOrUpdateVisitor(
    data: PreparedVisitorData,
    requestingUserId: number,
  ): Promise<event_visitor> {
    const { event, edition, userId, cityDetails, countryDetails, ...visitorData } = data;

    const existingVisitor = await this.prisma.event_visitor.findFirst({
      where: {
        edition: edition.id,
        user: userId,
      },
    });
    
    const visitorPayload: any = {
        visitor_company: visitorData.company,
        visitor_designation: visitorData.designation,
        visitor_phone: visitorData.phone,
        visitor_city: cityDetails?.id || visitorData.city,
        visitor_country: countryDetails?.id,
        source: visitorData.source || 'API',
    }

    const isComplete = !!(
        visitorPayload.visitor_company &&
        visitorPayload.visitor_designation &&
        visitorPayload.visitor_city &&
        visitorPayload.visitor_country &&
        visitorPayload.visitor_phone
    );

    if (existingVisitor) {

      if (isComplete && !existingVisitor.completed_on) {
          visitorPayload.completed_on = new Date();
      }

      return this.prisma.event_visitor.update({
        where: { id: existingVisitor.id },
        data: {
            ...visitorPayload,
            modified: new Date(),
            modifiedby: requestingUserId,
        },
      });
    } else {
      if (isComplete) {
          visitorPayload.completed_on = new Date();
      }
      return this.prisma.event_visitor.create({
        data: {
          event: event.id,
          edition: edition.id,
          user: userId,
          published: true,
          created: new Date(),
          createdby: requestingUserId,
          ...visitorPayload,
        },
      });
    }
  }
}