import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'alice@valerionhealth.in' })
  @IsEmail()
  username: string;

  @ApiProperty({ minLength: 8 })
  @IsString() @MinLength(8)
  password: string;
}
