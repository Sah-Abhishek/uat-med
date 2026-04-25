import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { RequestIdInterceptor } from '../../src/common/interceptors/request-id.interceptor';

export interface TestAppOptions {
  controllers: any[];
  /** Service-layer overrides: `{ provide: WorklistsService, useValue: mockSvc }` */
  providers: any[];
}

/**
 * Builds a minimal NestJS app for e2e tests:
 *  - JwtModule with the test secret (so real JWTs can be issued by auth-helpers)
 *  - Global JwtAuthGuard + RolesGuard
 *  - Global ValidationPipe + AllExceptionsFilter + RequestIdInterceptor
 *  - The controller under test, with its service mocked via `providers`
 */
export async function buildTestApp(opts: TestAppOptions): Promise<{ app: INestApplication; moduleRef: TestingModule }> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      JwtModule.register({ secret: process.env.JWT_SECRET, signOptions: { expiresIn: '1h' } }),
    ],
    controllers: opts.controllers,
    providers: [
      Reflector,
      JwtStrategy,
      ...opts.providers,
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalInterceptors(new RequestIdInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return { app, moduleRef };
}
