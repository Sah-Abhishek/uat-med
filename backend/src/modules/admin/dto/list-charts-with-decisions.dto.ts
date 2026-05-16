import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CodeReviewDecision } from '../../../common/enums';

/**
 * Filters for the chart-centric admin list. All optional, AND-combined.
 * A chart appears in the result when it has at least one decision matching
 * the filters (or any decision if no filters are set).
 */
export class ListChartsWithDecisionsDto {
  @ApiPropertyOptional({ description: 'Substring match on chart_no.' })
  @IsOptional() @IsString() chartNo?: string;

  @ApiPropertyOptional({ description: 'Filter to charts where this coder/auditor made at least one decision.' })
  @IsOptional() @Type(() => Number) @IsInt() coderId?: number;

  @ApiPropertyOptional({ enum: CodeReviewDecision, description: 'Filter to charts containing at least one decision of this type.' })
  @IsOptional() @IsEnum(CodeReviewDecision) decision?: CodeReviewDecision;

  @ApiPropertyOptional({ example: '2026-05-01', description: 'last_decided_at >= this date.' })
  @IsOptional() @IsDateString() from?: string;

  @ApiPropertyOptional({ example: '2026-05-31', description: 'last_decided_at <= this date (end-of-day).' })
  @IsOptional() @IsDateString() to?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 200 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize: number = 25;
}
