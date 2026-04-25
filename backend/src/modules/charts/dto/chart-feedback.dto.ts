import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class ChartFeedbackDto {
  @ApiProperty() @Type(() => Number) @IsInt() categoryId: number;
  @ApiProperty() @Type(() => Number) @IsInt() feedbackTypeId: number;
  @ApiProperty({ example: 'Feedback Provided' }) @IsString()
  feedbackStatus: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  comments?: string;
}

export class UpdateFeedbackDto {
  @ApiPropertyOptional({ example: 'Feedback Implemented' }) @IsOptional() @IsString()
  feedbackStatus?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) comments?: string;
}
