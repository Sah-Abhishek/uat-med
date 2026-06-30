import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CodeAuditVerdict, CodeReviewType } from '../../../common/enums';

export class CodeAuditItemDto {
  @ApiProperty({ enum: CodeReviewType })
  @IsEnum(CodeReviewType)
  codeType: CodeReviewType;

  @ApiProperty({ description: "The coder's final code value being audited." })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  codeValue: string;

  @ApiPropertyOptional({ description: 'The chart_code_decisions row this audit judges (informational linkage).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  chartCodeDecisionId?: number;

  @ApiProperty({ enum: CodeAuditVerdict })
  @IsEnum(CodeAuditVerdict)
  verdict: CodeAuditVerdict;

  @ApiPropertyOptional({ description: 'Required when verdict is DISAGREE.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  feedbackCategory?: string;

  @ApiPropertyOptional({ description: 'Required when verdict is DISAGREE — minimum 20 characters.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  feedbackText?: string;
}

export class SubmitCodeAuditsDto {
  @ApiProperty({ type: [CodeAuditItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CodeAuditItemDto)
  audits: CodeAuditItemDto[];
}
