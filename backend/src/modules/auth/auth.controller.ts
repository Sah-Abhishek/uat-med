import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';

import { AuthService } from './auth.service';
import { SsoService } from './sso.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SsoExchangeDto } from './dto/sso-exchange.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/request-user.type';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sso: SsoService,
  ) {}

  @Public()
  @Post('signup')
  @HttpCode(201)
  @ApiOperation({ summary: 'Request access — creates a pending approval row.' })
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Public()
  @UseGuards(AuthGuard('local'))
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange credentials for tokens.' })
  login(@Body() _dto: LoginDto, @Req() req) {
    return this.auth.issueTokensForUser(req.user, req.headers['user-agent']);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate refresh token and return a new access token.' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('sso/exchange')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange a Microsoft Entra access token for a Valerion JWT.' })
  ssoExchange(@Body() dto: SsoExchangeDto, @Req() req) {
    return this.sso.exchange(dto.idToken, dto.accessToken, req.headers['user-agent']);
  }

  @ApiBearerAuth('bearerAuth')
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke the current device\'s refresh token.' })
  logout(@Body() dto: RefreshTokenDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth('bearerAuth')
  @Post('logout/all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke every refresh token belonging to the current user.' })
  logoutAll(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logoutAll(user.id);
  }

  @ApiBearerAuth('bearerAuth')
  @Get('me')
  @ApiOperation({ summary: 'Return the current user profile.' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }

  @ApiBearerAuth('bearerAuth')
  @Post('password/change')
  @HttpCode(200)
  @ApiOperation({ summary: 'Change the current user\'s password.' })
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto);
  }
}