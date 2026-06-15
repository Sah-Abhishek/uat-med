import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { ChartsController } from './charts.controller';
import { ChartsService } from './charts.service';
import { AiPredictorService } from './ai-predictor.service';
import { AiPipelineWatcher } from './ai-pipeline-watcher.service';
import { DocumentStorageService } from './document-storage.service';
import { DocumentConversionService } from './document-conversion.service';
import { Chart } from '../../entities/chart.entity';
import { ChartAllocation } from '../../entities/chart-allocation.entity';
import { ChartFeedback } from '../../entities/chart-feedback.entity';
import { ChartCodeDecision } from '../../entities/chart-code-decision.entity';
import { ChartCodeDecisionDraft } from '../../entities/chart-code-decision-draft.entity';
import { ChartTimeLog } from '../../entities/chart-time-log.entity';
import { CodeReviewReason } from '../../entities/code-review-reason.entity';
import { Worklist } from '../../entities/worklist.entity';
import { User } from '../../entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Chart, ChartAllocation, ChartFeedback, ChartCodeDecision, ChartCodeDecisionDraft, ChartTimeLog, CodeReviewReason, Worklist, User]),
    // memoryStorage keeps file bytes in RAM so we can stream them straight to
    // the ICD gateway without touching disk. 50 MB matches the gateway limit.
    MulterModule.register({ storage: memoryStorage() }),
  ],
  controllers: [ChartsController],
  providers: [ChartsService, AiPredictorService, AiPipelineWatcher, DocumentStorageService, DocumentConversionService],
  exports: [DocumentStorageService, AiPredictorService, DocumentConversionService],
})
export class ChartsModule {}
