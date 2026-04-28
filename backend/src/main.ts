import 'reflect-metadata';
import * as dns from 'dns';
import * as net from 'net';

// Workaround for Node 20+'s autoSelectFamily ("Happy Eyeballs") timing out
// against TLS-required Postgres providers like Neon. Must run before TypeORM
// opens its first connection.
dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamily(false);

import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  // security / perf
  app.use(helmet());
  app.use(compression());
  app.set('trust proxy', 1);

  // CORS — allow all origins.
  // `origin: true` echoes the caller's Origin header back; works with credentials.
  // If CORS_ORIGINS is set to a non-empty, non-"*" value, we honour the allow-list instead.
  const corsEnv = (config.get<string>('CORS_ORIGINS') ?? '').trim();
  const corsOrigin =
    corsEnv === '' || corsEnv === '*'
      ? true
      : corsEnv.split(',').map((s) => s.trim()).filter(Boolean);

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'X-Response-Time-Ms'],
    maxAge: 86400,
  });

  // prefix
  const prefix = config.get<string>('APP_GLOBAL_PREFIX') ?? 'api/v1';
  app.setGlobalPrefix(prefix);

  // validation
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // interceptors & filters
  app.useGlobalInterceptors(
    new RequestIdInterceptor(),
    new ClassSerializerInterceptor(app.get(Reflector)),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger
  if (config.get<string>('ENABLE_SWAGGER_UI') === 'true') {
    const doc = new DocumentBuilder()
      .setTitle('Valerion Health API')
      .setDescription('Backend API for the Valerion medical-coding workflow platform.')
      .setVersion('2.1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearerAuth')
      .addServer(config.get<string>('APP_PUBLIC_URL') ?? 'http://localhost:8000')
      .build();
    const openApi = SwaggerModule.createDocument(app, doc);
    SwaggerModule.setup(`${prefix}/docs`, app, openApi, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  app.enableShutdownHooks();

  const port = config.get<number>('APP_PORT') ?? 8000;
  const host = config.get<string>('APP_HOST') ?? '0.0.0.0';
  await app.listen(port, host);

  // eslint-disable-next-line no-console
  console.log(`Valerion API listening on http://${host}:${port}/${prefix}`);
}

bootstrap();