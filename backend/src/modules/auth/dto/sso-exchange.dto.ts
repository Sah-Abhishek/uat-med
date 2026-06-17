import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class SsoExchangeDto {
  @ApiProperty({
    description:
      'Microsoft-issued ID token from MSAL — verified against Entra JWKS to authenticate the user.',
  })
  @IsString() @MinLength(32)
  idToken: string;

  @ApiPropertyOptional({
    description:
      'Microsoft Graph access token (User.Read) from MSAL — used best-effort to fetch the profile photo. ' +
      'Distinct from the ID token: Graph rejects ID tokens, so the photo fetch needs this access token.',
  })
  @IsOptional() @IsString() @MinLength(32)
  accessToken?: string;
}