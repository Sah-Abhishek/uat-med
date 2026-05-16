import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const APPLIES_TO = ['ICD-CM', 'ICD-PCS', 'CPT', 'ALL'] as const;
const PRIORITY = ['HIGH', 'NORMAL'] as const;

export class ListRulesQueryDto {
  @ApiPropertyOptional({ enum: PRIORITY })
  @IsOptional() @IsIn([...PRIORITY])
  priority?: 'HIGH' | 'NORMAL';

  @ApiPropertyOptional({ enum: APPLIES_TO })
  @IsOptional() @IsIn([...APPLIES_TO])
  applies_to?: 'ICD-CM' | 'ICD-PCS' | 'CPT' | 'ALL';

  @ApiPropertyOptional()
  @IsOptional() @Type(() => Boolean) @IsBoolean()
  include_inactive?: boolean;
}

export class CreateRuleDto {
  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsString() @MinLength(10) @MaxLength(2000)
  rule_text: string;

  @ApiProperty({ enum: APPLIES_TO })
  @IsIn([...APPLIES_TO])
  applies_to: 'ICD-CM' | 'ICD-PCS' | 'CPT' | 'ALL';

  @ApiProperty({ enum: PRIORITY })
  @IsIn([...PRIORITY])
  priority: 'HIGH' | 'NORMAL';
}
