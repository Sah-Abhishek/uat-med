import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MinLength(8)
  currentPassword: string;

  @ApiProperty({ minLength: 12, description: 'HIPAA-aligned: min 12 chars, at least 3 of upper/lower/digit/symbol.' })
  @IsString() @MinLength(12)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)|(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9])|(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9])|(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/, {
    message: 'Password must include at least three of: uppercase, lowercase, digit, symbol.',
  })
  newPassword: string;
}
