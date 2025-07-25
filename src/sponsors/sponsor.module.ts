import { Module } from '@nestjs/common';
import { SponsorController } from './sponsor.controller';
import { SponsorService } from './services/sponsor.service';
import { PrismaModule } from '../prisma/prisma.module';
import { S3Service } from '../common/s3.service';
import { UnifiedReviewService } from '../common/review.service';
import { RabbitmqService } from '../common/rabbitmq.service';

@Module({
  imports: [PrismaModule],
  controllers: [SponsorController],
  providers: [
    SponsorService,
    S3Service,
    UnifiedReviewService,
    RabbitmqService,
  ],
})
export class SponsorModule {}