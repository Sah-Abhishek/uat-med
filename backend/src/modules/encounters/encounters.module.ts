import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EncountersController } from './encounters.controller';
import { EncountersService } from './encounters.service';
import { Chart } from '../../entities/chart.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Chart])],
  controllers: [EncountersController],
  providers: [EncountersService],
})
export class EncountersModule {}
