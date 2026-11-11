import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { createCorsOriginOption } from './common/cors.util';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3001);
  const corsOriginsRaw = configService.get<string>('CORS_ORIGINS');
  const frontendUrl = configService.get<string>('FRONTEND_URL');
  const corsOrigin = createCorsOriginOption(corsOriginsRaw, frontendUrl);

  // Security headers (allow cross-origin media embedding & Swagger/SPA assets)
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Serve local-dev uploaded media assets at /uploads/*
  const uploadsDir = process.env.VERCEL
    ? path.join(os.tmpdir(), 'whatsapp-pro-uploads')
    : path.resolve(process.cwd(), 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  app.useStaticAssets(uploadsDir, { prefix: '/uploads/' });

  // Global API prefix
  app.setGlobalPrefix('api/v1');

  // CORS
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger / OpenAPI documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('WhatsApp Pro API')
    .setDescription('Production-ready WhatsApp clone REST & WebSocket API documentation')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        in: 'header',
      },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  // Serve built Web SPA static files + fallback when client/web/dist exists
  const webDistCandidates = [
    path.resolve(process.cwd(), '../client/web/dist'),
    path.resolve(process.cwd(), 'client/web/dist'),
    path.resolve(__dirname, '../../../client/web/dist'),
  ];
  const webDistDir = webDistCandidates.find((dir) =>
    fs.existsSync(path.join(dir, 'index.html')),
  );

  if (webDistDir) {
    const webIndexHtml = path.join(webDistDir, 'index.html');
    app.useStaticAssets(webDistDir);
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.use((req: Request, res: Response, next: NextFunction) => {
      if (
        req.method !== 'GET' ||
        req.path.startsWith('/api') ||
        req.path.startsWith('/socket.io') ||
        req.path.startsWith('/uploads')
      ) {
        return next();
      }
      return res.sendFile(webIndexHtml);
    });
    logger.log(`🌐 Serving Web SPA static files from ${webDistDir}`);
  }

  await app.listen(port);
  logger.log(`🚀 WhatsApp Pro Backend running on http://localhost:${port}/api/v1`);
  logger.log(`📚 Swagger docs available at http://localhost:${port}/api/docs`);
}

bootstrap();
