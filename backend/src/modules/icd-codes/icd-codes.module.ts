import { Module } from '@nestjs/common';

import { IcdCodesController } from './icd-codes.controller';
import { IcdCodesService } from './icd-codes.service';

/**
 * Read-only ICD-10-CM reference lookups (code autocomplete). Owns its own
 * Postgres pool to the icd10cm database — see IcdCodesService — so it needs no
 * TypeOrmModule.forFeature wiring.
 */
@Module({
  controllers: [IcdCodesController],
  providers: [IcdCodesService],
  exports: [IcdCodesService],
})
export class IcdCodesModule {}
