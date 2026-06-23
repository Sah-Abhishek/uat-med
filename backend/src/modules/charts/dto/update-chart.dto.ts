import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsDateString, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { ChartStatus, Priority } from '../../../common/enums';

class ProcedureDto {
  @IsString() code: string;
  @IsOptional() @IsString() modifier?: string;
}

export class UpdateChartDto {
  // ── Identifiers ────────────────────────────────────────
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) chartNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) mrNumber?: string;

  // ── Workflow metadata ──────────────────────────────────
  @ApiPropertyOptional({ enum: Priority }) @IsOptional() @IsEnum(Priority) priority?: Priority;

  @ApiPropertyOptional({ enum: ChartStatus, description: 'Editable by coder on Complete / Incomplete / Hold transitions.' })
  @IsOptional() @IsEnum(ChartStatus) chartStatus?: ChartStatus;

  // ── Allocation (admin / manager flows) ────────────────
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() allocatedCoderId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() allocatedAuditorId?: number;

  // ── Foreign-key pickers (Coding sub-tab lookups) ──────
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() holdReasonId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() responsiblePartyId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() primaryHealthPlanId?: number;

  // Service line chosen at document upload. `null` explicitly clears it; a
  // number sets it. ValidateIf lets null through (IsInt would otherwise reject).
  @ApiPropertyOptional({ nullable: true, description: 'Service line (global lookup) id, or null to clear.' })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @Type(() => Number) @IsInt() serviceLineId?: number | null;

  // ── Dates ──────────────────────────────────────────────
  @ApiPropertyOptional({ example: '2024-02-21', description: 'Date of Service' })
  @IsOptional() @IsDateString() dos?: string;

  @ApiPropertyOptional({ example: '2024-02-21' }) @IsOptional() @IsDateString() admitDate?: string;
  @ApiPropertyOptional({ example: '2024-02-23' }) @IsOptional() @IsDateString() dischargeDate?: string;

  // ── Coding fields ──────────────────────────────────────
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(16) primaryDiagnosis?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() secondaryDiagnoses?: string[];
  @ApiPropertyOptional({ type: [ProcedureDto] }) @IsOptional() @IsArray() procedures?: ProcedureDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() emLevel?: string;

  @ApiPropertyOptional({ description: 'DRG value — persisted as numeric(12,2).' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) drgValue?: number;

  // ── Comment fields ─────────────────────────────────────
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) coderCommentsToClient?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) rejectionDenialComments?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) deficiencyComments?: string;

  // ── Escape hatch — fields not yet promoted to columns ─
  // For the Chart Info panel: disposition, facility, POA, LOS, subSpeciality.
  // For Processing Info: coderQcStatus, auditorQcStatus, auditOptionIds.
  @ApiPropertyOptional({
    type: Object,
    description: 'JSON bag for tenant-defined + not-yet-promoted fields (disposition, facility, POA, LOS, subSpeciality, coderQcStatus, auditorQcStatus, auditOptionIds).',
  })
  @IsOptional() @IsObject() customFields?: Record<string, any>;
}