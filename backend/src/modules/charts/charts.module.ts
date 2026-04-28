import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { ChartsController } from './charts.controller';
import { ChartsService } from './charts.service';
import { AiPredictorService } from './ai-predictor.service';
import { DocumentStorageService } from './document-storage.service';
import { Chart } from '../../entities/chart.entity';
import { ChartAllocation } from '../../entities/chart-allocation.entity';
import { ChartFeedback } from '../../entities/chart-feedback.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Chart, ChartAllocation, ChartFeedback]),
    // memoryStorage keeps file bytes in RAM so we can stream them straight to
    // the ICD gateway without touching disk. 50 MB matches the gateway limit.
    MulterModule.register({ storage: memoryStorage() }),
  ],
  controllers: [ChartsController],
  providers: [ChartsService, AiPredictorService, DocumentStorageService],
})
export class ChartsModule {}
