import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminCodeDecisionsController } from './admin-code-decisions.controller';
import { AdminCodeDecisionsService } from './admin-code-decisions.service';
import { AdminActiveWorkController } from './admin-active-work.controller';
import { AdminActiveWorkService } from './admin-active-work.service';
import { ChartCodeDecision } from '../../entities/chart-code-decision.entity';
import { Chart } from '../../entities/chart.entity';
import { User } from '../../entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ChartCodeDecision, Chart, User])],
  controllers: [AdminCodeDecisionsController, AdminActiveWorkController],
  providers: [AdminCodeDecisionsService, AdminActiveWorkService],
})
export class AdminModule {}
