import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QaFiltersDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() clientId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() locationId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() specialityId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() coderId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() auditorId?: number;

  /** Comma-separated list of milestones, e.g. CODING_DONE,AUDIT_DONE. */
  @ApiPropertyOptional() @IsOptional() @IsString() milestone?: string;

  /** Facility name as stored on chart.custom_fields.facility. */
  @ApiPropertyOptional() @IsOptional() @IsString() facility?: string;

  /** ISO date (YYYY-MM-DD), inclusive. */
  @ApiPropertyOptional() @IsOptional() @IsString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() to?: string;

  /** Free-text chart # search. */
  @ApiPropertyOptional() @IsOptional() @IsString() q?: string;
}

export class QaSubmissionsQueryDto extends QaFiltersDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number = 25;
}
