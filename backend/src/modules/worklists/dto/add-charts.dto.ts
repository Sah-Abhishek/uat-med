import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** One manually-entered chart to add to an existing worklist. All fields are
 * optional — a chart with no chart-# / MR-# is a valid placeholder, same as the
 * blank charts produced at worklist creation. */
export class AddChartItemDto {
  @ApiPropertyOptional({ example: '19309A' })
  @IsOptional() @IsString() @Length(0, 64)
  chartNo?: string;

  @ApiPropertyOptional({ example: 'MR-1001' })
  @IsOptional() @IsString() @Length(0, 64)
  mrNumber?: string;

  @ApiPropertyOptional({ example: '2023-09-25' })
  @IsOptional() @IsDateString()
  dos?: string;

  @ApiPropertyOptional({ example: '2023-09-25' })
  @IsOptional() @IsDateString()
  admitDate?: string;

  @ApiPropertyOptional({ example: '2023-09-26' })
  @IsOptional() @IsDateString()
  dischargeDate?: string;
}

export class AddChartsDto {
  @ApiPropertyOptional({ type: [AddChartItemDto], description: 'Charts to add with details.' })
  @IsOptional() @IsArray() @ArrayMaxSize(500)
  @ValidateNested({ each: true }) @Type(() => AddChartItemDto)
  charts?: AddChartItemDto[];

  @ApiPropertyOptional({ description: 'Number of blank placeholder charts to add (no details).' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000)
  blankCount?: number;
}
