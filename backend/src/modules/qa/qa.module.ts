import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QaController } from './qa.controller';
import { QaService } from './qa.service';
import { ChartCodeDecision } from '../../entities/chart-code-decision.entity';
import { Chart } from '../../entities/chart.entity';
import { Worklist } from '../../entities/worklist.entity';
import { User } from '../../entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ChartCodeDecision, Chart, Worklist, User])],
  controllers: [QaController],
  providers: [QaService],
})
export class QaModule {}
