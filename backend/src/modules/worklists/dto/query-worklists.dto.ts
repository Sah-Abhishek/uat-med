import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { PageParamsDto } from '../../../common/dto/page-params.dto';
import { WorklistStatus } from '../../../common/enums';

export class QueryWorklistsDto extends PageParamsDto {
  @ApiPropertyOptional({ enum: WorklistStatus }) @IsOptional() @IsEnum(WorklistStatus)
  status?: WorklistStatus;

  /** Free-text search on the worklist number (case-insensitive, substring). */
  @ApiPropertyOptional({ example: '19309' }) @IsOptional() @IsString() search?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() clientId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() locationId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() primarySpecialityId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() subSpecialityId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() processId?: number;

  @ApiPropertyOptional({ example: '2023-09-01' }) @IsOptional() @IsDateString() receivedDateFrom?: string;
  @ApiPropertyOptional({ example: '2023-09-30' }) @IsOptional() @IsDateString() receivedDateTo?: string;
}
