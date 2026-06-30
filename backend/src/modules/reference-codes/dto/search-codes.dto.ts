import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/**
 * Query for the PCS / DRG code typeahead. `q` is the code prefix the user is
 * typing into a Chart Info code field; the autocomplete fires at ≥2 chars.
 */
export class SearchCodesDto {
  @ApiProperty({
    description: 'Code prefix to match (case-insensitive). Min 2 chars.',
    example: '001',
    minLength: 2,
  })
  @IsString()
  @MinLength(2)
  q: string;

  @ApiPropertyOptional({ description: 'Max rows to return.', minimum: 1, maximum: 25, default: 15 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit?: number = 15;
}
