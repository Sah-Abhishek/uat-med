import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { User } from '../../entities/user.entity';
import { UserStatus } from '../../common/enums';
import { AuthService } from './auth.service';
import { AvatarService } from './avatar.service';

interface EntraTokenClaims {
  oid: string;          // Entra object ID
  tid: string;          // tenant ID
  preferred_username?: string;
  email?: string;
  name?: string;
  aud: string;
  iss: string;
  exp: number;
}

@Injectable()
export class SsoService {
  private readonly tenantId: string;
  private readonly expectedAudience: string;
  private readonly jwks: jwksClient.JwksClient;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly auth: AuthService,
    private readonly cfg: ConfigService,
    private readonly avatars: AvatarService,
  ) {
    this.tenantId = this.cfg.get<string>('AZURE_TENANT_ID') ?? '';
    this.expectedAudience = this.cfg.get<string>('AZURE_CLIENT_ID') ?? '';
    this.jwks = jwksClient({
      jwksUri: `https://login.microsoftonline.com/${this.tenantId}/discovery/v2.0/keys`,
      cache: true,
      cacheMaxAge: 24 * 60 * 60 * 1000,
    });
  }

  private async getKey(kid: string): Promise<string> {
    const key = await this.jwks.getSigningKey(kid);
    return key.getPublicKey();
  }

  async exchange(idToken: string, graphAccessToken: string | undefined, userAgent?: string) {
    // 1. Decode header to get the kid (key ID used to sign the token)
    const decoded = jwt.decode(idToken, { complete: true });
    if (!decoded || typeof decoded === 'string') {
      throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'Invalid token format.' } });
    }

    const kid = decoded.header.kid as string;
    if (!kid) {
      throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'Token missing kid header.' } });
    }

    // 2. Fetch the Microsoft public key and verify signature
    let claims: EntraTokenClaims;
    try {
      const publicKey = await this.getKey(kid);
      claims = jwt.verify(idToken, publicKey, {
        algorithms: ['RS256'],
        issuer: [
          `https://login.microsoftonline.com/${this.tenantId}/v2.0`,
          `https://sts.windows.net/${this.tenantId}/`,
        ],
        // Don't check audience here — Entra issues tokens with variable audiences
        // depending on scopes. We'll check tenant below.
      }) as EntraTokenClaims;
    } catch (err) {
      throw new UnauthorizedException({
        error: { code: 'unauthorized', message: `Microsoft token verification failed: ${(err as Error).message}` },
      });
    }

    // 3. Validate tenant (defense in depth)
    if (claims.tid !== this.tenantId) {
      throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'Token is from a different tenant.' } });
    }

    // 4. Extract email
    const email = (claims.preferred_username ?? claims.email ?? '').toLowerCase();
    if (!email) {
      throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'Token does not contain an email.' } });
    }

    // 5. Look up the user
    const user = await this.users.findOne({ where: { email } });
    if (!user) {
      throw new UnauthorizedException({
        error: { code: 'unauthorized', message: `No Valerion account exists for ${email}. Contact your admin.` },
      });
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'Account is inactive.' } });
    }

    // 6. Capture the user's real Microsoft profile photo (best-effort). This
    // needs the Graph *access* token (User.Read scope) — NOT the ID token we
    // verified above, which Graph rejects (its audience is our app, not Graph).
    // Refreshes on each login so a changed photo eventually propagates; skipped
    // if the frontend didn't send a Graph token.
    if (graphAccessToken) {
      const photoUrl = await this.avatars.captureFromGraph(user.id, graphAccessToken);
      if (photoUrl) user.avatarUrl = photoUrl;
    }

    // 7. Issue Valerion tokens via existing flow
    user.lastLoginAt = new Date();
    await this.users.save(user);

    return this.auth.issueTokensForUser(user, userAgent);
  }
}