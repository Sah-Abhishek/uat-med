import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsIn, IsInt, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AllocationRangeDto {
  @ApiProperty({ description: 'Starting serial number (inclusive).' })
  @Type(() => Number) @IsInt() @Min(1)
  from: number;

  @ApiProperty({ description: 'Ending serial number (inclusive).' })
  @Type(() => Number) @IsInt() @Min(1)
  to: number;

  @ApiProperty() @Type(() => Number) @IsInt()
  assigneeId: number;

  @ApiProperty({ enum: ['CODER', 'AUDITOR'] }) @IsIn(['CODER', 'AUDITOR'])
  role: 'CODER' | 'AUDITOR';
}

export class AllocateWorklistDto {
  @ApiProperty({ type: [AllocationRangeDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => AllocationRangeDto)
  allocations: AllocationRangeDto[];
}
