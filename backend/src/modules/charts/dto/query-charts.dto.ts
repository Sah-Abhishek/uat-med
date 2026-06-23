import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PageParamsDto } from '../../../common/dto/page-params.dto';
import { ChartMilestone, ChartStatus, Priority } from '../../../common/enums';

/** Coerce a single-or-array query value (?x=A or ?x[]=A&x[]=B) into an array,
 *  or undefined when absent. The multi-select chart filters send arrays; other
 *  callers still send a single value — both reach the same IN(...) match. */
const toArray = ({ value }: { value: unknown }): unknown[] | undefined =>
  value === undefined || value === null || value === ''
    ? undefined
    : Array.isArray(value)
    ? value
    : [value];
const toNumberArray = (params: { value: unknown }): number[] | undefined =>
  toArray(params)?.map((v) => Number(v));

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

/**
 * Whether the chart has been reviewed — i.e. worked upon. A chart counts as
 * reviewed once it has at least one submitted code decision
 * (chart_code_decisions); there's no column for this, so list() matches it with
 * a correlated EXISTS. YES keeps only reviewed charts, NO only untouched ones.
 */
export enum ReviewedFilter {
  YES = 'YES',
  NO = 'NO',
}

export class QueryChartsDto extends PageParamsDto {
  @ApiPropertyOptional({ enum: Priority }) @IsOptional() @IsEnum(Priority) priority?: Priority;
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @Transform(toNumberArray) @IsInt({ each: true }) worklistId?: number[];
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() serialFrom?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() serialTo?: number;
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @Transform(toNumberArray) @IsInt({ each: true }) allocatedUserId?: number[];
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @Transform(toNumberArray) @IsInt({ each: true }) primarySpecialityId?: number[];
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @Transform(toNumberArray) @IsInt({ each: true }) subSpecialityId?: number[];
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() clientId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() locationId?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() chartNo?: string;
  /** AI encounter id (stored on custom_fields.aiPrediction.encounterId). Matched
   * with a case-insensitive partial ILIKE so a fragment of the UUID still finds
   * the chart. */
  @ApiPropertyOptional() @IsOptional() @IsString() encounterId?: string;
  @ApiPropertyOptional({ enum: ChartStatus, isArray: true }) @IsOptional() @Transform(toArray) @IsEnum(ChartStatus, { each: true }) chartStatus?: ChartStatus[];
  @ApiPropertyOptional({ enum: ChartMilestone, isArray: true }) @IsOptional() @Transform(toArray) @IsEnum(ChartMilestone, { each: true }) milestone?: ChartMilestone[];
  @ApiPropertyOptional({ enum: AiStatusFilter, isArray: true }) @IsOptional() @Transform(toArray) @IsEnum(AiStatusFilter, { each: true }) aiStatus?: AiStatusFilter[];
  @ApiPropertyOptional({ enum: ReviewedFilter }) @IsOptional() @IsEnum(ReviewedFilter) reviewed?: ReviewedFilter;
  @ApiPropertyOptional() @IsOptional() @IsDateString() receivedDateFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() receivedDateTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfServiceFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfServiceTo?: string;
}
