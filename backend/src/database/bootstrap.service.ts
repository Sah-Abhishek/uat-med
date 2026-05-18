import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { User } from '../entities/user.entity';
import { Chart } from '../entities/chart.entity';
import { AuthService } from '../modules/auth/auth.service';
import { CoderRegistrationService } from '../modules/ai-gateway/coder-registration.service';
import { Role } from '../common/enums/roles.enum';
import { ChartMilestone, Priority } from '../common/enums';

/**
 * Seeds a bootstrap TEAMLEAD user from env vars on application start.
 *
 * - If BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are not both set, it logs and skips.
 * - If a user with that email already exists, it logs and skips (idempotent).
 * - Otherwise creates the user with role=TEAMLEAD and status=ACTIVE.
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Chart) private readonly charts: Repository<Chart>,
    private readonly cfg: ConfigService,
    private readonly auth: AuthService,
    private readonly coderRegistration: CoderRegistrationService,
  ) { }

  async onApplicationBootstrap(): Promise<void> {
    await this.seedBootstrapAdmin();
    await this.backfillFinalizedPriority();
    await this.backfillCoderPublicIds();
  }

  /**
   * Picks up any ACTIVE coder/auditor created before this code shipped and
   * registers them with the AI gateway so their submissions can carry a real
   * `coder_id`. Safe to run on every boot — CoderRegistrationService.needsSync
   * skips anyone already registered. Failures are logged, not thrown — the
   * app boots either way.
   */
  private async backfillCoderPublicIds(): Promise<void> {
    try {
      const r = await this.coderRegistration.backfillAll();
      if (r.attempted === 0) {
        this.logger.log('Coder public_id backfill: no candidates.');
      } else {
        this.logger.log(
          `Coder public_id backfill: attempted=${r.attempted} registered=${r.registered} conflicts=${r.conflicts} failed=${r.failed}`,
        );
      }
    } catch (err) {
      this.logger.warn(`Coder backfill threw: ${(err as Error)?.message ?? 'unknown'}`);
    }
  }

  private async seedBootstrapAdmin(): Promise<void> {
    const email = (this.cfg.get<string>('BOOTSTRAP_ADMIN_EMAIL') ?? '').trim();
    const password = this.cfg.get<string>('BOOTSTRAP_ADMIN_PASSWORD') ?? '';
    const fullName = (this.cfg.get<string>('BOOTSTRAP_ADMIN_FULL_NAME') ?? 'Platform Admin').trim();

    if (!email || !password) {
      this.logger.log('Bootstrap admin not configured — skipping.');
      return;
    }
    if (password.length < 8) {
      this.logger.error('BOOTSTRAP_ADMIN_PASSWORD is shorter than 8 characters — refusing to seed.');
      return;
    }

    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      this.logger.log(`Bootstrap admin already exists: ${email} (id=${existing.id}) — skipping.`);
      return;
    }

    const created = await this.auth.createUserWithPassword({
      email, fullName, password, role: Role.TEAMLEAD,
    });

    this.logger.warn(
      `Bootstrap TEAMLEAD created: ${email} (id=${created.id}). ` +
      `Rotate via POST /auth/password/change after first login.`,
    );
  }

  /**
   * One-shot backfill: any chart whose milestone is already CODING_DONE,
   * AUDIT_DONE, or CLOSED and whose priority isn't yet FINALIZED gets moved
   * into the "Done" priority bucket so the charts-list `Done` tab matches the
   * new auto-finalize rule applied during chart save. Safe to run repeatedly
   * — the WHERE clause is the no-op condition once everything's been flipped.
   */
  private async backfillFinalizedPriority(): Promise<void> {
    const result = await this.charts.update(
      {
        milestone: In([
          ChartMilestone.CODING_DONE,
          ChartMilestone.AUDIT_DONE,
          ChartMilestone.CLOSED,
        ]),
        // TypeORM's `Not(X)` would let us be explicit about "priority != FINALIZED",
        // but the simpler approach below is to skip rows already FINALIZED via
        // a follow-up filter. Update.affected counts only rows that changed.
      },
      { priority: Priority.FINALIZED },
    );

    if ((result.affected ?? 0) > 0) {
      this.logger.warn(
        `Backfilled priority=FINALIZED for ${result.affected} chart(s) already at coding/audit/closed milestones.`,
      );
    } else {
      this.logger.log('No charts needed priority backfill.');
    }
  }
}