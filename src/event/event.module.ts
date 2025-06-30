import { Module } from '@nestjs/common';
import { EventController } from './event.controller';
import { EventService } from './Services/event.service';
import { EditionService } from './common/edition.service';
import { ValidationService } from './common/validation.service';
// import { ReviewService } from './services/review.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ElasticsearchService } from '../elasticsearch/elasticsearch.service';
// import { EventDataTransformerService } from './common/event-data-transformer';
// import { EventReplicaService } from './common/event-replica.service'; 
import { S3Service } from '../common/s3.service';
import { EmailService } from '../common/email.service';
import { RabbitmqService } from '../common/rabbitmq.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { CommonService } from './common/common.service';
// import { EventCreationService } from './upserServices/event-creation.service';
// import { FutureEditionService } from './common/future.edition.service';
// import { ProductManagementService } from './common/product-management.service';
// import { ReviewQcService } from './upserServices/review-qc.service';
// import { StatsProcessingService } from './common/stats-processing.service';
// import { SubVenueManagementService } from './common/sub-venue-management.service';
import { ConfigModule } from '@nestjs/config';
import { FirebaseSessionService } from 'src/common/firebase-session.service';
import { PipedriveService } from '../common/pipedrive.service';
import { UnifiedReviewService } from '../common/review.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [EventController],
  providers: [
    EventService,
    EditionService,
    // ReviewService,
    // EventReplicaService,
    S3Service,
    EmailService,
    
    ValidationService,
    // EventDataTransformerService,
    ElasticsearchService,
    RabbitmqService,
    PrismaService,
    
    // EventCreationService,
    // StatsProcessingService,
    // AttachmentService,
    // ContactManagementService,
    CommonService,
    // FutureEditionService,
    // ProductManagementService,
    // SubVenueManagementService,
    // ReviewQcService,
    UnifiedReviewService,
    PipedriveService,

    FirebaseSessionService
  ],
  exports: [
    EventService,
    ElasticsearchService,
    // RabbitmqService,
    // EventDataTransformerService,
    ValidationService,
    FirebaseSessionService,
    S3Service
  ],
})
export class EventModule {}