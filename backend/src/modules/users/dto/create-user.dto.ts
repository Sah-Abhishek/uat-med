import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEmail, IsEnum, IsInt, IsOptional, IsString, Length, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { Role } from '../../../common/enums/roles.enum';

export class CreateUserDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() @Length(1, 255) fullName: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) password: string;
  @ApiProperty({ enum: Role }) @IsEnum(Role) role: Role;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() clientId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() locationId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() primarySpecialityId?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() designation?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfBirth?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfJoining?: string;
}
