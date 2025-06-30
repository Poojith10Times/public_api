import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { patchNestJsSwagger, ZodValidationPipe } from 'nestjs-zod';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
