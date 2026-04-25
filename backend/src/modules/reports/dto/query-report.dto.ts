import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class SortSpecDto {
  @IsString() key: string;
  @IsIn(['asc', 'desc']) dir: 'asc' | 'desc';
}

export class QueryReportDto {
  @ApiProperty({ type: [String] })
  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  columns: string[];

  @ApiPropertyOptional({ type: Object })
  @IsOptional() @IsObject()
  filters?: Record<string, any>;

  @ApiPropertyOptional({ type: [SortSpecDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SortSpecDto)
  sort?: SortSpecDto[];

  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  pageSize?: number;
}
