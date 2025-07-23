import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { patchNestJsSwagger, ZodValidationPipe } from 'nestjs-zod';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';


async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        brokers: ['localhost:9092'], 
      },
      consumer: {
        groupId: 'public-api-consumer', 
      },
    },
  });

  await app.startAllMicroservices();


  app.enableCors({
    credentials: true,
    allowedHeaders: 'Content-Type,Authorization',
  });
  
  app.useGlobalPipes(new ZodValidationPipe());

  patchNestJsSwagger();
  const config = new DocumentBuilder()
    .setTitle(`Add Event API`)
    .setVersion('1.0')
    // .addBearerAuth(
    //   {
    //     type: 'http',
    //     scheme: 'bearer',
    //     bearerFormat: 'JWT',
    //     name: 'Authorization',
    //     in: 'header',
    //   }
    // )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`api/docs`, app, document, {
    yamlDocumentUrl: `api/yaml`,
    swaggerOptions: {
      showCommonExtensions: true,

    }
  });

  const port = process.env.PORT || 2000;
  await app.listen(port);
}
bootstrap();
