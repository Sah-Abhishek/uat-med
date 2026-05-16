import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateWorklistDto {
  @ApiProperty({ example: '19309A', description: 'Unique business identifier.' })
  @IsString() @Length(1, 32)
  worklistNumber: string;

  @ApiProperty() @Type(() => Number) @IsInt() clientId: number;
  @ApiProperty() @Type(() => Number) @IsInt() locationId: number;
  @ApiProperty() @Type(() => Number) @IsInt() primarySpecialityId: number;
  @ApiProperty() @Type(() => Number) @IsInt() processId: number;

  @ApiPropertyOptional({ example: '2023-09-25' })
  @IsOptional() @IsDateString()
  dateOfService?: string;

  @ApiPropertyOptional({ example: '2023-09-26', description: 'End of the date-of-service range; pair with dateOfService.' })
  @IsOptional() @IsDateString()
  dateOfServiceTo?: string;

  @ApiProperty({ example: '2023-09-27' })
  @IsDateString()
  receivedDate: string;

  @ApiPropertyOptional({ description: 'Informational; actual count comes from the Excel upload.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  numberOfCharts?: number;
}
