import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { Worklist } from '../../entities/worklist.entity';
import { Chart } from '../../entities/chart.entity';
import { ChartFeedback } from '../../entities/chart-feedback.entity';
import { HccRecord } from '../../entities/hcc-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Worklist, Chart, ChartFeedback, HccRecord])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
