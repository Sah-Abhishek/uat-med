import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { WorklistsController } from './worklists.controller';
import { WorklistsService } from './worklists.service';
import { WorklistBulkService } from './bulk.service';
import { Worklist } from '../../entities/worklist.entity';
import { Chart } from '../../entities/chart.entity';
import { ChartAllocation } from '../../entities/chart-allocation.entity';
import { ChartAllocationEvent } from '../../entities/chart-allocation-event.entity';
import { ChartsModule } from '../charts/charts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Worklist, Chart, ChartAllocation, ChartAllocationEvent]),
    // 50 MB matches the per-file ceiling used in the per-chart document flow.
    MulterModule.register({ storage: memoryStorage() }),
    ChartsModule,
  ],
  controllers: [WorklistsController],
  providers: [WorklistsService, WorklistBulkService],
  exports: [WorklistsService],
})
export class WorklistsModule {}
