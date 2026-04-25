import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Priority } from '../../../common/enums';

export class BulkIdsDto {
  @ApiProperty({ type: [Number] })
  @IsArray() @ArrayMinSize(1) @Type(() => Number) @IsInt({ each: true })
  chartIds: number[];
}

class AllocationDto {
  @ApiProperty({ enum: ['ALLOCATE_CODING', 'ALLOCATE_AUDITING', 'REALLOCATE_TO_ORIGINAL_CODER', 'NONE'] })
  @IsEnum(['ALLOCATE_CODING', 'ALLOCATE_AUDITING', 'REALLOCATE_TO_ORIGINAL_CODER', 'NONE'] as any)
  action: 'ALLOCATE_CODING' | 'ALLOCATE_AUDITING' | 'REALLOCATE_TO_ORIGINAL_CODER' | 'NONE';

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt()
  assigneeId?: number;
}

export class BulkModifyDto extends BulkIdsDto {
  @ApiPropertyOptional({ enum: Priority }) @IsOptional() @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional({ type: AllocationDto }) @IsOptional() @ValidateNested() @Type(() => AllocationDto)
  allocation?: AllocationDto;
}
