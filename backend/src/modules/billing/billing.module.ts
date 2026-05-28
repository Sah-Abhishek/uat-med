import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingSettings } from '../../entities/billing-settings.entity';
import { Chart } from '../../entities/chart.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BillingSettings, Chart])],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
