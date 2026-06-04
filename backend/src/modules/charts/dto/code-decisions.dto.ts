import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { CodeReviewDecision, CodeReviewType } from '../../../common/enums';

export class CodeDecisionItemDto {
  @ApiProperty({ enum: CodeReviewType })
  @IsEnum(CodeReviewType)
  codeType: CodeReviewType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  codeValue: string;

  @ApiPropertyOptional({ description: 'UUID from the orchestrator codes-with-IDs endpoint. Required for the orchestrator forward; nullable on ADD actions.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  predictedCodeId?: string;

  // 5000 is a sanity bound only — the column is `text`. The old 500 cap rejected
  // legitimately long AI orchestrator descriptions and failed the whole batch.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  originalDescription?: string;

  @ApiProperty({ enum: CodeReviewDecision })
  @IsEnum(CodeReviewDecision)
  decision: CodeReviewDecision;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  editedCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  editedDescription?: string;

  @ApiPropertyOptional({ description: 'Sequence position for ADD actions (orchestrator field).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sequencePos?: number;

  @ApiPropertyOptional({ description: 'Required when decision is REJECTED or EDITED — must match an active reason for the chart\'s (client, location, codeType, action).' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reasonDropdown?: string;

  @ApiPropertyOptional({ description: 'Required when decision is REJECTED or EDITED — minimum 20 characters.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reasonText?: string;
}

export class SubmitCodeDecisionsDto {
  @ApiProperty({ type: [CodeDecisionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CodeDecisionItemDto)
  decisions: CodeDecisionItemDto[];
}
