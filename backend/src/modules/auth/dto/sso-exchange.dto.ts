import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SsoExchangeDto {
  @ApiProperty({ description: 'Microsoft-issued access token from MSAL.' })
  @IsString() @MinLength(32)
  accessToken: string;
}