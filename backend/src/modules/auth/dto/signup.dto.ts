import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class SignupDto {
  @ApiProperty({ example: 'new.user@valerionhealth.in' })
  @IsEmail()
  email: string;
}
