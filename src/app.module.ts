import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { EventModule } from './event/event.module';
import { validateEnv } from './config/app.config';
import { ElasticsearchModule } from './elasticsearch/elasticsearch.module';
import { UserModule } from './user/user.module';
import { VisitorModule } from './visitor/visitor.module';
import { KafkaModule } from './kafka/kafka.module';
import { SponsorModule } from './sponsors/sponsor.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    PrismaModule,
    EventModule,
    ElasticsearchModule,
    UserModule,
    VisitorModule,
    KafkaModule,
    SponsorModule, 

  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}