import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './services/user.service';
import { UserValidationService } from './common/user-validation.service';
import { UserLookupService } from './common/user-lookup.service';
import { UserProcessingService } from './common/user-processing.service';
import { PhoneValidationService } from './common/phone-validation.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { ElasticsearchService } from '../elasticsearch/elasticsearch.service';
import { RabbitmqService } from '../common/rabbitmq.service';
import { UserCommonService } from './common/userCommon.service';
import { UnifiedReviewService } from 'src/common/review.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [UserController],
  providers: [
    UserService,
    UserValidationService,
    UserLookupService,
    UserProcessingService,
    PhoneValidationService,
    ElasticsearchService,
    RabbitmqService,
    UserCommonService,
    RabbitmqService,
    UnifiedReviewService,
  ],
  exports: [
    UserService,
    UserValidationService,
    UserLookupService,
    UserProcessingService,
    PhoneValidationService,
  ],
})
export class UserModule {}