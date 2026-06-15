import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/**
 * Query for the ICD-10-CM code typeahead. `q` is a prefix the user is typing
 * into the "Add a code" form; the autocomplete fires once it's ≥2 chars.
 */
export class SearchIcdCodesDto {
  @ApiProperty({
    description: 'Code prefix to match (case-insensitive, dot-optional). Min 2 chars.',
    example: 'E11',
    minLength: 2,
  })
  @IsString()
  @MinLength(2)
  q: string;

  @ApiPropertyOptional({
    description: 'Max rows to return.',
    minimum: 1,
    maximum: 25,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit?: number = 10;
}
