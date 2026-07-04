import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query params for GET /encounters. All optional; every field is whitelisted
 * because the global ValidationPipe runs with `forbidNonWhitelisted: true`.
 */
export class QueryEncountersDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number) @IsInt() @Min(1) @IsOptional()
  page: number = 1;

  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 500 })
  @Type(() => Number) @IsInt() @Min(1) @Max(500) @IsOptional()
  pageSize: number = 100;

  @ApiPropertyOptional({ description: 'Coding-completed date on/after this day (YYYY-MM-DD).' })
  @IsDateString() @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: 'Coding-completed date on/before this day (YYYY-MM-DD).' })
  @IsDateString() @IsOptional()
  to?: string;

  @ApiPropertyOptional({ description: 'Filter by client id.' })
  @Type(() => Number) @IsInt() @IsOptional()
  clientId?: number;

  @ApiPropertyOptional({ description: 'Filter by location id.' })
  @Type(() => Number) @IsInt() @IsOptional()
  locationId?: number;

  @ApiPropertyOptional({ description: 'Filter by sub-speciality id.' })
  @Type(() => Number) @IsInt() @IsOptional()
  subSpecialityId?: number;
}
