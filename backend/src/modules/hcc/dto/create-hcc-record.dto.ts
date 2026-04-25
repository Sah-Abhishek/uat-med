import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { HccValidate } from '../../../common/enums';

export class CreateHccRecordDto {
  @ApiProperty() @IsString() memberId: string;
  @ApiProperty() @IsString() memberName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() medicareNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dob?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() coderId?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() payor?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dos?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() reviewDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() receivedDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() v24Icd?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() v24IcdDescription?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() v24HccValue?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() v28Icd?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() v28IcdDescription?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() v28HccValue?: number;
  @ApiPropertyOptional({ enum: HccValidate }) @IsOptional() @IsEnum(HccValidate) validate?: HccValidate;
  @ApiPropertyOptional() @IsOptional() @IsString() reasonCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() source?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) reviewerNote?: string;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() customFields?: Record<string, any>;
}
