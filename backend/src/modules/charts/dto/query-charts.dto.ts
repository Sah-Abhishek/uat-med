import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { PageParamsDto } from '../../../common/dto/page-params.dto';
import { ChartMilestone, ChartStatus, Priority } from '../../../common/enums';

/**
 * AI-pipeline status, derived from `custom_fields` rather than a column.
 * Mirrors the frontend `deriveAiStatus` + the summary() tile counts:
 * pending takes precedence (QUEUED/PROCESSING), then a prior error (ERRORED),
 * then a stored prediction (DONE). 'NONE' isn't filterable — there's nothing
 * useful to narrow to — so it's intentionally omitted.
 *
 * IN_PROGRESS is the union of QUEUED + PROCESSING (any pending prediction). It
 * exists so the Productivity donut's "In progress" slice — which counts both —
 * can deep-link to the exact same set of charts in the list.
 */
export enum AiStatusFilter {
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
  ERRORED = 'ERRORED',
}

export class QueryChartsDto extends PageParamsDto {
  @ApiPropertyOptional({ enum: Priority }) @IsOptional() @IsEnum(Priority) priority?: Priority;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() worklistId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() serialFrom?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() serialTo?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() allocatedUserId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() primarySpecialityId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() clientId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() locationId?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() chartNo?: string;
  @ApiPropertyOptional({ enum: ChartStatus }) @IsOptional() @IsEnum(ChartStatus) chartStatus?: ChartStatus;
  @ApiPropertyOptional({ enum: ChartMilestone }) @IsOptional() @IsEnum(ChartMilestone) milestone?: ChartMilestone;
  @ApiPropertyOptional({ enum: AiStatusFilter }) @IsOptional() @IsEnum(AiStatusFilter) aiStatus?: AiStatusFilter;
  @ApiPropertyOptional() @IsOptional() @IsDateString() receivedDateFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() receivedDateTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfServiceFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfServiceTo?: string;
}
