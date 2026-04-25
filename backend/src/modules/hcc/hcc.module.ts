import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { HccController } from './hcc.controller';
import { HccService } from './hcc.service';
import { HccRecord } from '../../entities/hcc-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([HccRecord])],
  controllers: [HccController],
  providers: [HccService],
})
export class HccModule {}
