import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsEnum } from 'class-validator';
import { AttendanceStatus } from '../../../common/enums';

export class MarkAttendanceDto {
  @ApiProperty({ example: '2026-04-18' }) @IsDateString() date: string;
  @ApiProperty({ enum: AttendanceStatus }) @IsEnum(AttendanceStatus) status: AttendanceStatus;
}
