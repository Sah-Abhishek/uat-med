import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PcsCode } from '../../entities/pcs-code.entity';
import { DrgCode } from '../../entities/drg-code.entity';
import { ReferenceCodesController } from './reference-codes.controller';
import { ReferenceCodesService } from './reference-codes.service';

/** Read-only PCS / DRG reference-code lookups (Chart Info autocompletes). */
@Module({
  imports: [TypeOrmModule.forFeature([PcsCode, DrgCode])],
  controllers: [ReferenceCodesController],
  providers: [ReferenceCodesService],
  exports: [ReferenceCodesService],
})
export class ReferenceCodesModule {}
