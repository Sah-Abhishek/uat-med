import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/**
 * Admin-initiated password reset payload. No `currentPassword` — the admin
 * doesn't know it. Authorisation is enforced at the controller via @Roles.
 */
export class ResetUserPasswordDto {
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
