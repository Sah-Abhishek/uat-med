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
import { CoderRegistrationService } from '../ai-gateway/coder-registration.service';

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
    private readonly coderRegistration: CoderRegistrationService,
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
        avatarUrl: user.avatarUrl ?? null,
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

  /**
   * Admin-initiated password reset. Bypasses the current-password check used
   * by the regular change-password flow — caller authorisation is enforced at
   * the controller via @Roles. Revokes every active refresh token for the
   * user so existing sessions can't survive on the previous credential.
   */
  async resetPasswordFor(userId: number, newPassword: string): Promise<{ status: 'ok'; revoked: number }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await this.users.save(user);
    const out = await this.logoutAll(userId);
    return { status: 'ok', revoked: out.revoked };
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

  /**
   * Create a user — or revive a previously-deactivated one.
   *
   * The `users` table has a unique index on `email` and no soft-delete column,
   * so a deactivated user keeps occupying their email row. Without this
   * branch, an admin who deactivates someone and then tries to recreate them
   * (with a different role, say) would crash on the constraint with the raw
   * "Unique constraint violation" message.
   *
   * Behaviour:
   *   - No existing row → insert as before.
   *   - Existing row, status = INACTIVE → reactivate and overwrite the
   *     submitted fields. Same `id` so chart_allocation / audit_log history
   *     stays linked to the same person.
   *   - Existing row, status = ACTIVE or PENDING → throw a clean 409.
   */
  async createUserWithPassword(fields: {
    email: string; fullName: string; password: string; role: Role;
    clientId?: number; locationId?: number; primarySpecialityId?: number;
    employeeId?: string; designation?: string;
    dateOfBirth?: string; dateOfJoining?: string;
  }): Promise<User> {
    const email = fields.email.trim().toLowerCase();
    const existing = await this.users.findOne({ where: { email } });

    if (existing && existing.status !== UserStatus.INACTIVE) {
      throw new ConflictException({
        error: {
          code: 'email_in_use',
          message: `A user with email ${email} already exists.`,
        },
      });
    }

    const passwordHash = await bcrypt.hash(fields.password, BCRYPT_COST);

    if (existing) {
      // Reactivate + overwrite — admin is intentionally repurposing the slot.
      existing.fullName = fields.fullName;
      existing.passwordHash = passwordHash;
      existing.role = fields.role;
      existing.status = UserStatus.ACTIVE;
      existing.clientId = fields.clientId;
      existing.locationId = fields.locationId;
      existing.primarySpecialityId = fields.primarySpecialityId;
      if (fields.employeeId !== undefined)   existing.employeeId   = fields.employeeId;
      if (fields.designation !== undefined)  existing.designation  = fields.designation;
      if (fields.dateOfBirth !== undefined)  existing.dateOfBirth  = fields.dateOfBirth;
      if (fields.dateOfJoining !== undefined) existing.dateOfJoining = fields.dateOfJoining;
      const saved = await this.users.save(existing);
      // Reactivation may have flipped role (e.g. VIEWER → CODER) — sync covers
      // that case too. No-op if the user already has a public_id.
      await this.coderRegistration.syncOne(saved);
      return saved;
    }

    const created = await this.users.save(this.users.create({
      email,
      fullName: fields.fullName,
      passwordHash,
      role: fields.role,
      status: UserStatus.ACTIVE,
      clientId: fields.clientId,
      locationId: fields.locationId,
      primarySpecialityId: fields.primarySpecialityId,
      employeeId: fields.employeeId,
      designation: fields.designation,
      dateOfBirth: fields.dateOfBirth,
      dateOfJoining: fields.dateOfJoining,
    }));
    await this.coderRegistration.syncOne(created);
    return created;
  }
}
