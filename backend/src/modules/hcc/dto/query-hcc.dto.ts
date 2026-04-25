import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { PageParamsDto } from '../../../common/dto/page-params.dto';
import { HccValidate } from '../../../common/enums';

export class QueryHccDto extends PageParamsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() memberId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() medicareNo?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() coderId?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() v24Icd?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() v28Icd?: string;
  @ApiPropertyOptional({ enum: HccValidate }) @IsOptional() @IsEnum(HccValidate) validate?: HccValidate;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfServiceFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfServiceTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() receivedDateFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() receivedDateTo?: string;
}
