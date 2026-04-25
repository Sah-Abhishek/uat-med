import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChartsController } from './charts.controller';
import { ChartsService } from './charts.service';
import { Chart } from '../../entities/chart.entity';
import { ChartAllocation } from '../../entities/chart-allocation.entity';
import { ChartFeedback } from '../../entities/chart-feedback.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Chart, ChartAllocation, ChartFeedback])],
  controllers: [ChartsController],
  providers: [ChartsService],
})
export class ChartsModule {}
