import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WorklistsController } from './worklists.controller';
import { WorklistsService } from './worklists.service';
import { Worklist } from '../../entities/worklist.entity';
import { Chart } from '../../entities/chart.entity';
import { ChartAllocation } from '../../entities/chart-allocation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Worklist, Chart, ChartAllocation])],
  controllers: [WorklistsController],
  providers: [WorklistsService],
  exports: [WorklistsService],
})
export class WorklistsModule {}
