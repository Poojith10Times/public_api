import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { EventModule } from './event/event.module';
import { validateEnv } from './config/app.config';
import { ElasticsearchModule } from './elasticsearch/elasticsearch.module';
// import { RabbitmqModule } from './rabbitmq/rabbitmq.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    PrismaModule,
    EventModule,
    ElasticsearchModule,
    // RabbitmqModule,
    UserModule,

  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}