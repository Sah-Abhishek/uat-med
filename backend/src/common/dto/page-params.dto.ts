import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PageParamsDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number) @IsInt() @Min(1) @IsOptional()
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 200 })
  @Type(() => Number) @IsInt() @Min(1) @Max(200) @IsOptional()
  pageSize: number = 20;

  @ApiPropertyOptional({ description: 'Whitelisted sort field for the endpoint.' })
  @IsString() @IsOptional()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsIn(['asc', 'desc']) @IsOptional()
  sortDir: 'asc' | 'desc' = 'asc';
}
