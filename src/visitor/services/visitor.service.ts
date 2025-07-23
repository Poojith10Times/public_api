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
  ) {}

  async register(
    registrationData: VisitorRegistrationDto,
    requestingUserId: number,
    source: string,
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

      // 2. Upsert User (Create or Update)
      const userUpsertDto: UserUpsertRequestDto = {
        ...registrationData,
        changesMadeBy: requestingUserId,
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

      // 3. Validate Event and Prepare Visitor-Specific Data
      const validationResult = await this.validationService.validateAndPrepareData(
        registrationData,
        user,
      );

      if (!validationResult.isValid) {
        return {
          status: {
            code: 0,
            message: validationResult.message || 'Visitor data validation failed',
          },
        };
      }

      // 4. Create or Update EventVisitor Record
      let visitor = await this.createOrUpdateVisitor(
        validationResult.data!,
        requestingUserId,
      );

       // 5. Assign Badge
      const badgeId = await this.badgeService.assignBadgeToVisitor(visitor, registrationData);

      if (badgeId) {
        visitor = await this.prisma.event_visitor.update({
          where: { id: visitor.id },
          data: { badge: badgeId },
        });
      }

      // 6. Process Questionnaire Answers
      if (registrationData.answers) {
        const questionnaireResult = await this.questionnaireService.processAnswers(
            visitor,
            registrationData.answers,
        );

        if (!questionnaireResult.isValid) {
            // NOTE: We might choose not to fail the whole registration here,
            // but for now, we'll return the validation error.
            return {
                status: { code: 0, message: questionnaireResult.message || 'Questionnaire validation failed.'}
            }
        }
      }
      
      // 7. Send Communications via Kafka
      this.kafkaProducer.sendMessage('email-notifications', {
          type: 'visitor-confirmation',
          visitorId: visitor.id,
      });

      this.kafkaProducer.sendMessage('email-notifications', {
          type: 'organizer-notification',
          visitorId: visitor.id,
      });
      

      return {
        status: { code: 1, message: 'Success' },
        data: {
          visitorId: visitor.id,
          userId: user.id,
        },
      };
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
    
    const visitorPayload = {
        // visitor_name: visitorData.name,
        visitor_company: visitorData.company,
        visitor_designation: visitorData.designation,
        visitor_phone: visitorData.phone,
        visitor_city: cityDetails?.id || visitorData.city,
        visitor_country: countryDetails?.id,
        source: visitorData.source || 'API',
        completed_on: new Date(),
    }

    if (existingVisitor) {
      return this.prisma.event_visitor.update({
        where: { id: existingVisitor.id },
        data: {
            ...visitorPayload,
            modified: new Date(),
            modifiedby: requestingUserId,
        },
      });
    } else {
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