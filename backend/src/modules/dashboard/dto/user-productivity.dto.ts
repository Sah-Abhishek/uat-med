import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query for /dashboard/user-productivity — per-user productivity view.
 * `userId` and `date` are required; the rest are optional scopers/pagination.
 */
export class UserProductivityQueryDto {
  @ApiProperty()
  @Type(() => Number) @IsInt() @Min(1)
  userId!: number;

  /** ISO date (YYYY-MM-DD) — the "as-of" day for assigned / same-day / carry-over. */
  @ApiProperty()
  @IsDateString()
  date!: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() clientId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() locationId?: number;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 200 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize?: number = 25;
}
