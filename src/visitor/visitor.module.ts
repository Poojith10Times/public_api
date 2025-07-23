import { Module } from '@nestjs/common';
import { VisitorController } from './visitor.controller';
import { VisitorService } from './services/visitor.service';
import { UserModule } from '../user/user.module';
import { VisitorValidationService } from './services/visitor-validation.service';
import { BadgeService } from './services/badge.service';
import { QuestionnaireService } from './services/questionnaire.service';
import { EmailService } from 'src/common/email.service';
import { CommunicationService } from './services/communication.service';

@Module({
  imports: [UserModule],
  controllers: [VisitorController],
  providers: [VisitorService, VisitorValidationService, BadgeService, QuestionnaireService, EmailService, CommunicationService],
})
export class VisitorModule {}