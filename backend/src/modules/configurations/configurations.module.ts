import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigurationsController } from './configurations.controller';
import { ConfigurationsService } from './configurations.service';
import { Client } from '../../entities/client.entity';
import { Location } from '../../entities/location.entity';
import { PrimarySpeciality } from '../../entities/primary-speciality.entity';
import { SubSpeciality } from '../../entities/sub-speciality.entity';
import { Process } from '../../entities/process.entity';
import { Facility } from '../../entities/facility.entity';
import { HoldReason } from '../../entities/hold-reason.entity';
import { ResponsibleParty } from '../../entities/responsible-party.entity';
import { Disposition } from '../../entities/disposition.entity';
import { PrimaryHealthPlan } from '../../entities/primary-health-plan.entity';
import { AuditOption } from '../../entities/audit-option.entity';
import { FeedbackType } from '../../entities/feedback-type.entity';
import { AuditArea } from '../../entities/audit-area.entity';
import { AuditFeedbackReason } from '../../entities/audit-feedback-reason.entity';
import { StandardFieldConfig } from '../../entities/standard-field-config.entity';
import { CustomFieldConfig } from '../../entities/custom-field-config.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Client,
      Location,
      PrimarySpeciality,
      SubSpeciality,
      Process,
      Facility,
      HoldReason,
      ResponsibleParty,
      Disposition,
      PrimaryHealthPlan,
      AuditOption,
      FeedbackType,
      AuditArea,
      AuditFeedbackReason,
      StandardFieldConfig,
      CustomFieldConfig,
    ]),
  ],
  controllers: [ConfigurationsController],
  providers: [ConfigurationsService],
  exports: [ConfigurationsService],
})
export class ConfigurationsModule {}
