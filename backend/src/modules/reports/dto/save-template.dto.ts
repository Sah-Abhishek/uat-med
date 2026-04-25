import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsObject, IsOptional, IsString, Length } from 'class-validator';

export class SaveTemplateDto {
  @ApiProperty() @IsString() @Length(1, 120) name: string;

  @ApiProperty({ type: [String] })
  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  columns: string[];

  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject()
  filters?: Record<string, any>;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isShared?: boolean;
}
