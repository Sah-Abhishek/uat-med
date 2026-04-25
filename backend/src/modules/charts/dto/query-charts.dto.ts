import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { PageParamsDto } from '../../../common/dto/page-params.dto';
import { ChartMilestone, ChartStatus, Priority } from '../../../common/enums';

export class QueryChartsDto extends PageParamsDto {
  @ApiPropertyOptional({ enum: Priority }) @IsOptional() @IsEnum(Priority) priority?: Priority;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() worklistId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() serialFrom?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() serialTo?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() allocatedUserId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() primarySpecialityId?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() chartNo?: string;
  @ApiPropertyOptional({ enum: ChartStatus }) @IsOptional() @IsEnum(ChartStatus) chartStatus?: ChartStatus;
  @ApiPropertyOptional({ enum: ChartMilestone }) @IsOptional() @IsEnum(ChartMilestone) milestone?: ChartMilestone;
  @ApiPropertyOptional() @IsOptional() @IsDateString() receivedDateFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() receivedDateTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfServiceFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfServiceTo?: string;
}
