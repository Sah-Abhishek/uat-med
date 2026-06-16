import { BadGatewayException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import * as crypto from 'crypto';

import { User } from '../../entities/user.entity';
import { Role } from '../../common/enums/roles.enum';
import { UserStatus } from '../../common/enums';
import { AiGatewayClient } from './ai-gateway.service';

/** Roles that need to be registered with the AI gateway as a `coder_id`.
 * Auditors get registered too — the gateway's role enum doesn't have an
 * AUDITOR option (per golden_dataset_api.pdf §1.2: CODER|ADMIN|VIEWER), but
 * the value is purely informational on their side, so registering all
 * reviewers as CODER keeps the door open for them to submit corrections. */
const REVIEWER_ROLES: ReadonlySet<Role> = new Set([Role.CODER, Role.AUDITOR]);

/**
 * Registers reviewer-role users with the AI gateway and persists the
 * gateway-issued UUID back into `users.public_id`. That UUID is what we send
 * as `coder_id` on every /api/review submit (see ChartsService.forwardToAiGateway).
 *
 * Two entry points:
 *  - `syncOne()` for the on-create hook in AuthService, called once per save.
 *  - `backfillAll()` for the one-shot CLI command that picks up users created
 *    before this code shipped.
 *
 * Failure handling — the gateway is best-effort during *user* creation: if the
 * call fails, the local user row still saves (a coder who can log in but
 * whose corrections don't reach Qdrant is recoverable; a coder who can't log
 * in is not). Failures are logged and a follow-up backfill call will pick
 * them up. The exception is 409 — see syncOne().
 */
@Injectable()
export class CoderRegistrationService {
  private readonly log = new Logger(CoderRegistrationService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly gateway: AiGatewayClient,
  ) {}

  /** Mint a throwaway password for gateway registration. The gateway's
   * /admin/users schema requires one, but our reviewers authenticate against
   * THIS app, never the gateway directly — so the value only has to satisfy
   * the schema. Random-per-user means there's no shared secret to leak or
   * rotate, and we never store it (the coder couldn't log into the gateway
   * with it anyway). 48 hex chars of CSPRNG output. */
  private gatewayPassword(): string {
    return crypto.randomBytes(24).toString('hex');
  }

  /** Should this user be synced to the gateway? */
  needsSync(user: User): boolean {
    return (
      REVIEWER_ROLES.has(user.role) &&
      user.status === UserStatus.ACTIVE &&
      !user.publicId
    );
  }

  /**
   * Register one user and persist their public_id. No-ops if the user already
   * has a public_id or doesn't need one.
   *
   * Returns the user with `publicId` populated when sync succeeded, or the
   * unchanged user when it didn't. Doesn't throw on gateway error — see class
   * docstring for the rationale.
   *
   * The doc (§1.4) says emails are *globally* unique and there is no
   * lookup-by-email endpoint. A 409 here means "some other tenant already
   * registered this email upstream" — we surface that loudly because it's
   * not something the next backfill run can fix on its own.
   */
  async syncOne(user: User): Promise<User> {
    if (!this.needsSync(user)) return user;

    try {
      const registered = await this.gateway.registerUser({
        name: user.fullName,
        email: user.email,
        password: this.gatewayPassword(),
        role: 'CODER',
      });
      user.publicId = registered.id;
      await this.users.update({ id: user.id }, { publicId: registered.id });
      this.log.log(
        `Registered user ${user.id} (${user.email}) with gateway → ${registered.id}`,
      );
      return user;
    } catch (err) {
      if (err instanceof ConflictException) {
        // Surface loudly — this needs human attention (collision with another
        // tenant's coder, see doc §1.4 for plus-tag workaround).
        this.log.error(
          `Gateway 409 registering user ${user.id} (${user.email}): email already taken upstream`,
        );
        throw err;
      }
      // A 422 from /admin/users is a *contract* breach (a required field we're
      // not sending), not a transient blip — it fails identically on every
      // retry and backfill, silently leaving public_id null so the user's
      // corrections never reach the gateway. Treat it distinctly from a
      // genuine defer: error-level with the gateway's response body, so the
      // next schema change is caught in hours instead of going unnoticed for
      // weeks. Still swallowed (return the user) so user creation succeeds.
      const gatewayErr = parseGatewayError(err);
      if (gatewayErr?.status === 422) {
        this.log.error(
          `Gateway 422 registering user ${user.id} (${user.email}): ` +
            `/admin/users payload no longer satisfies the gateway contract — ` +
            `${JSON.stringify(gatewayErr.body)}`,
        );
        return user;
      }
      const msg = (err as Error)?.message ?? 'unknown error';
      this.log.warn(
        `Gateway registration deferred for user ${user.id} (${user.email}): ${msg}`,
      );
      return user;
    }
  }

  /**
   * Role-agnostic variant of syncOne. Returns the user's gateway publicId,
   * registering them on the fly if they don't have one yet. Needed for
   * /api/rules (TEAMLEAD/MANAGER can author rules but aren't covered by
   * REVIEWER_ROLES, so syncOne would no-op for them and the gateway would
   * 502 on a non-UUID `created_by`).
   */
  async ensurePublicId(user: User): Promise<string> {
    if (user.publicId) return user.publicId;
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({
        error: { code: 'forbidden', message: 'User is not active; cannot register with AI gateway.' },
      });
    }
    const registered = await this.gateway.registerUser({
      name: user.fullName,
      email: user.email,
      password: this.gatewayPassword(),
      role: 'CODER',
    });
    user.publicId = registered.id;
    await this.users.update({ id: user.id }, { publicId: registered.id });
    this.log.log(
      `Registered user ${user.id} (${user.email}) with gateway on demand → ${registered.id}`,
    );
    return registered.id;
  }

  /**
   * One-shot backfill: register every ACTIVE CODER / AUDITOR that's missing
   * `public_id`. Safe to run repeatedly — `needsSync()` filters out anyone
   * already registered.
   */
  async backfillAll(): Promise<{ attempted: number; registered: number; conflicts: number; failed: number }> {
    const candidates = await this.users.find({
      where: [
        { role: Role.CODER, status: UserStatus.ACTIVE, publicId: IsNull() },
        { role: Role.AUDITOR, status: UserStatus.ACTIVE, publicId: IsNull() },
      ],
    });
    let registered = 0;
    let conflicts = 0;
    let failed = 0;
    for (const u of candidates) {
      try {
        const before = u.publicId;
        await this.syncOne(u);
        if (u.publicId && u.publicId !== before) registered++;
        else failed++;
      } catch (err) {
        if (err instanceof ConflictException) conflicts++;
        else failed++;
      }
    }
    this.log.log(
      `Backfill complete: attempted=${candidates.length} registered=${registered} conflicts=${conflicts} failed=${failed}`,
    );
    return { attempted: candidates.length, registered, conflicts, failed };
  }
}

/** Pull the upstream HTTP status and response body out of the exception the
 * gateway client throws. AiGatewayClient wraps every non-2xx/non-409 response
 * in a BadGatewayException carrying `{ error: { status, body, ... } }`; this
 * lets syncOne() distinguish a permanent contract breach (422) from a
 * transient defer without re-parsing log strings. Returns null when the error
 * isn't one of ours. */
function parseGatewayError(err: unknown): { status?: number; body?: unknown } | null {
  if (!(err instanceof BadGatewayException)) return null;
  const resp = err.getResponse();
  if (resp && typeof resp === 'object' && 'error' in resp) {
    const e = (resp as { error?: { status?: number; body?: unknown } }).error;
    return { status: e?.status, body: e?.body };
  }
  return null;
}
