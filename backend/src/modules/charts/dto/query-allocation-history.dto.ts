import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { PageParamsDto } from '../../../common/dto/page-params.dto';

/** Every write path that logs an allocation event (mirrors AllocationSource in
 *  allocation-log.ts). Kept as a plain array so it can drive both the DTO's
 *  @IsIn validation and the Swagger enum. */
export const ALLOCATION_SOURCES = [
  'DETAIL_SAVE',
  'BULK_ALLOCATE_CODING',
  'BULK_ALLOCATE_AUDITING',
  'BULK_REALLOCATE_TO_ORIGINAL',
  'WORKLIST_ALLOCATE',
  'SELF_ALLOCATE',
  'AUDIT_REALLOCATION',
] as const;

/**
 * Filters for the global allocation-history (audit trail) list. All optional;
 * an empty query returns the whole log, newest first, paginated.
 */
export class QueryAllocationHistoryDto extends PageParamsDto {
  /** Partial, case-insensitive match on the chart number. */
  @ApiPropertyOptional() @IsOptional() @IsString() chartNo?: string;

  @ApiPropertyOptional({ enum: ['CODER', 'AUDITOR'] })
  @IsOptional() @IsIn(['CODER', 'AUDITOR'])
  role?: 'CODER' | 'AUDITOR';

  @ApiPropertyOptional({ enum: ALLOCATION_SOURCES })
  @IsOptional() @IsIn(ALLOCATION_SOURCES as unknown as string[])
  source?: string;

  /** Match events where this user is the previous OR new holder (from OR to). */
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() userId?: number;

  /** Match events performed by this actor (the person who made the change). */
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() changedById?: number;

  /** Inclusive lower bound on the event timestamp (YYYY-MM-DD). */
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;

  /** Inclusive upper bound on the event timestamp (YYYY-MM-DD). */
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}
