import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CodeReviewDecision } from '../../../common/enums';

/** Filters for GET /api/v1/admin/code-decisions. All optional, AND-combined. */
export class ListCodeDecisionsDto {
  @ApiPropertyOptional({ description: 'Filter to one chart.' })
  @IsOptional() @Type(() => Number) @IsInt() chartId?: number;

  @ApiPropertyOptional({ description: 'Filter to one local user (CODER/AUDITOR id).' })
  @IsOptional() @Type(() => Number) @IsInt() coderId?: number;

  @ApiPropertyOptional({ enum: CodeReviewDecision })
  @IsOptional() @IsEnum(CodeReviewDecision) decision?: CodeReviewDecision;

  @ApiPropertyOptional({ example: '2026-05-01', description: 'decided_at >= this date (inclusive).' })
  @IsOptional() @IsDateString() from?: string;

  @ApiPropertyOptional({ example: '2026-05-31', description: 'decided_at <= this date (inclusive, end-of-day).' })
  @IsOptional() @IsDateString() to?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 200 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize: number = 25;
}
