import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { v4 as uuid } from 'uuid';

import { User } from '../../entities/user.entity';
import { RefreshToken } from '../../entities/refresh-token.entity';
import { UserSignupRequest } from '../../entities/user-signup-request.entity';
import { Role } from '../../common/enums/roles.enum';
import { UserStatus } from '../../common/enums';
import { SignupDto } from './dto/signup.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

const BCRYPT_COST = 12;

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function parseTtlToSeconds(ttl: string, fallback = 900): number {
  const m = /^(\d+)([smhd])$/.exec(ttl);
  if (!m) return fallback;
  const n = parseInt(m[1], 10);
  return n * ({ s: 1, m: 60, h: 3600, d: 86400 }[m[2]]);
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(RefreshToken) private readonly refreshes: Repository<RefreshToken>,
    @InjectRepository(UserSignupRequest) private readonly signups: Repository<UserSignupRequest>,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
  ) {}

  async validatePassword(email: string, password: string): Promise<User> {
    const user = await this.users.findOne({ where: { email } });
    if (!user || !user.passwordHash) throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'Invalid credentials.' } });
    if (user.status === UserStatus.INACTIVE) throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'Account is inactive.' } });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'Invalid credentials.' } });
    user.lastLoginAt = new Date();
    await this.users.save(user);
    return user;
  }

  async issueTokensForUser(user: User, userAgent?: string) {
    const jti = uuid();
    const payload = {
      sub: String(user.id),
      email: user.email,
      role: user.role,
      clientId: user.clientId ?? null,
      locationId: user.locationId ?? null,
      jti,
    };

    const accessTtl = this.cfg.get<string>('JWT_ACCESS_TTL') ?? '15m';
    const refreshTtl = this.cfg.get<string>('JWT_REFRESH_TTL') ?? '7d';

    const accessToken = await this.jwt.signAsync(payload, { expiresIn: accessTtl });

    const refreshRaw = crypto.randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + parseTtlToSeconds(refreshTtl, 7 * 86400) * 1000);
    await this.refreshes.save(this.refreshes.create({
      userId: user.id,
      tokenHash: hashToken(refreshRaw),
      deviceLabel: userAgent?.slice(0, 120),
      issuedAt: new Date(),
      expiresAt,
    }));

    return {
      accessToken,
      tokenType: 'bearer',
      expiresIn: parseTtlToSeconds(accessTtl, 900),
      refreshToken: refreshRaw,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.fullName,
        clientId: user.clientId ?? null,
        locationId: user.locationId ?? null,
      },
    };
  }

  async refresh(raw: string) {
    const tokenHash = hashToken(raw);
    const token = await this.refreshes.findOne({ where: { tokenHash } });
    if (!token) throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'Unknown refresh token.' } });
    if (token.revokedAt) {
      // theft detection: revoke all tokens for this user
      await this.refreshes.update({ userId: token.userId }, { revokedAt: new Date() });
      throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'Refresh token reuse detected.' } });
    }
    if (token.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'Refresh token expired.' } });
    }
    const user = await this.users.findOne({ where: { id: token.userId } });
    if (!user || user.status !== UserStatus.ACTIVE) throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'User inactive.' } });

    token.revokedAt = new Date();
    await this.refreshes.save(token);

    return this.issueTokensForUser(user, token.deviceLabel);
  }

  async logout(raw: string) {
    const tokenHash = hashToken(raw);
    await this.refreshes.update({ tokenHash, revokedAt: null as any }, { revokedAt: new Date() });
    return { status: 'ok' };
  }

  async logoutAll(userId: number) {
    const result = await this.refreshes.update({ userId, revokedAt: null as any }, { revokedAt: new Date() });
    return { status: 'ok', revoked: result.affected ?? 0 };
  }

  async me(userId: number) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      clientId: user.clientId ?? null,
      locationId: user.locationId ?? null,
      primarySpecialityId: user.primarySpecialityId ?? null,
      designation: user.designation ?? null,
      avatarUrl: user.avatarUrl ?? null,
      lastLoginAt: user.lastLoginAt,
    };
  }

  async signup(dto: SignupDto) {
    const allowed = (this.cfg.get<string>('SSO_ALLOWED_EMAIL_DOMAINS') ?? '').split(',').filter(Boolean);
    if (allowed.length) {
      const domain = dto.email.split('@')[1]?.toLowerCase();
      if (!allowed.map(d => d.toLowerCase()).includes(domain)) {
        throw new BadRequestException({ error: { code: 'bad_request', message: 'Email domain is not allowed.' } });
      }
    }
    const existing = await this.signups.findOne({ where: { email: dto.email, status: 'PENDING' } });
    if (existing) return { status: 'pending', message: 'Signup request already submitted.' };
    await this.signups.save(this.signups.create({ email: dto.email, status: 'PENDING' }));
    return { status: 'pending', message: 'Signup request submitted for approval' };
  }

  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || !user.passwordHash) throw new NotFoundException();
    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'Current password is incorrect.' } });
    if (dto.currentPassword === dto.newPassword) throw new ConflictException({ error: { code: 'conflict', message: 'New password must differ from current.' } });
    user.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_COST);
    await this.users.save(user);
    return { status: 'ok' };
  }

  /** Helper used by test fixtures and seeds. */
  async createUserWithPassword(fields: {
    email: string; fullName: string; password: string; role: Role;
    clientId?: number; locationId?: number; primarySpecialityId?: number;
  }): Promise<User> {
    const passwordHash = await bcrypt.hash(fields.password, BCRYPT_COST);
    return this.users.save(this.users.create({
      email: fields.email,
      fullName: fields.fullName,
      passwordHash,
      role: fields.role,
      status: UserStatus.ACTIVE,
      clientId: fields.clientId,
      locationId: fields.locationId,
      primarySpecialityId: fields.primarySpecialityId,
    }));
  }
}
