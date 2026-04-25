import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportTemplate } from '../../entities/report-template.entity';
import { Chart } from '../../entities/chart.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ReportTemplate, Chart])],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
