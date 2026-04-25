import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as path from 'path';

import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';

import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

import { AuthModule } from './modules/auth/auth.module';
import { BootstrapModule } from './database/bootstrap.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { WorklistsModule } from './modules/worklists/worklists.module';
import { ChartsModule } from './modules/charts/charts.module';
import { HccModule } from './modules/hcc/hcc.module';
import { UsersModule } from './modules/users/users.module';
import { ConfigurationsModule } from './modules/configurations/configurations.module';
import { ReportsModule } from './modules/reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: [
        path.resolve(process.cwd(), `env/.env.${process.env.NODE_ENV || 'development'}.local`),
        path.resolve(process.cwd(), `env/.env.local`),
        path.resolve(process.cwd(), `env/.env.${process.env.NODE_ENV || 'development'}`),
        path.resolve(process.cwd(), `env/.env`),
      ],
      validationSchema,
      validationOptions: { abortEarly: true, allowUnknown: true },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        host: cfg.get<string>('DB_HOST'),
        port: cfg.get<number>('DB_PORT'),
        username: cfg.get<string>('DB_USERNAME'),
        password: cfg.get<string>('DB_PASSWORD'),
        database: cfg.get<string>('DB_NAME'),
        ssl: cfg.get<string>('DB_SSL') === 'true' ? { rejectUnauthorized: false } : false,
        entities: [path.join(__dirname, 'entities', '*.entity.{ts,js}')],
        migrations: [path.join(__dirname, 'database/migrations', '*.{ts,js}')],
        synchronize: cfg.get<string>('NODE_ENV') !== 'production',
        poolSize: cfg.get<number>('DB_POOL_SIZE'),
        logging: cfg.get<string>('LOG_LEVEL') === 'debug',
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ([{
        ttl: cfg.get<number>('RATE_LIMIT_WINDOW_MS') / 1000,
        limit: cfg.get<number>('RATE_LIMIT_MAX'),
      }]),
    }),

    AuthModule,
    BootstrapModule,
    DashboardModule,
    WorklistsModule,
    ChartsModule,
    HccModule,
    UsersModule,
    ConfigurationsModule,
    ReportsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule { }