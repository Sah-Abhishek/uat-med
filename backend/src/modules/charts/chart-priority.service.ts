import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Chart } from '../../entities/chart.entity';

// The only purely time-triggered transition is LOW → MEDIUM at the day
// boundary, so a daily cadence is enough in principle — but sweeping hourly
// makes that roll-over happen within an hour of midnight (instead of at an
// arbitrary boot-time-of-day) and reconciles any bucket a missed hook left
// stale. The query is a single indexed UPDATE, so the cost is negligible.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
// Let the DB connection and the rest of the app settle before the first pass.
const BOOT_DELAY_MS = 20_000;

/**
 * Keeps the auto-managed priority buckets (LOW / MEDIUM / HIGH) in sync with
 * the rules the business defined:
 *
 *   HIGH   — the chart has ANY auditor feedback (chart_feedback row). Wins over
 *            everything below.
 *   LOW    — freshly coder-allocated today (last_coder_allocated_at = today).
 *   MEDIUM — allocated before today AND never worked on, i.e. the milestone
 *            hasn't advanced past READY_TO_CODE. This is the "not worked on
 *            today → rolls over the next day" rule.
 *
 * CRITICAL and FINALIZED are never touched: CRITICAL is a manual override that
 * outranks HIGH, and FINALIZED ("Done") is terminal — mirroring the existing
 * "only auto-advance to FINALIZED, never auto-revert" rule in ChartsService.
 * Charts with no coder allocated, soft-deleted charts, and charts orphaned by a
 * soft-deleted worklist are all excluded.
 *
 * Allocation and feedback events also nudge a chart's bucket inline (see
 * ChartsService / WorklistsService) for instant feedback; this sweep is the
 * source of truth that additionally performs the time-based LOW → MEDIUM aging
 * and repairs anything an event missed.
 */
@Injectable()
export class ChartPriorityService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ChartPriorityService.name);
  private timer: NodeJS.Timeout | null = null;
  private bootTimer: NodeJS.Timeout | null = null;
  // Guards against a slow sweep overlapping the next tick.
  private running = false;

  constructor(@InjectRepository(Chart) private readonly charts: Repository<Chart>) {}

  onModuleInit() {
    this.bootTimer = setTimeout(() => {
      this.sweep().catch((e) =>
        this.log.error(`initial priority sweep failed: ${(e as Error).message}`),
      );
    }, BOOT_DELAY_MS);
    this.bootTimer.unref?.();

    this.timer = setInterval(() => {
      this.sweep().catch((e) =>
        this.log.error(`priority sweep failed: ${(e as Error).message}`),
      );
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();

    this.log.log(`Chart priority sweep scheduled (every ${SWEEP_INTERVAL_MS / 3600000}h)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
    this.timer = null;
    this.bootTimer = null;
  }

  /**
   * Recompute every managed chart's bucket in one statement and write back only
   * the rows that actually change (so `updated_at` isn't churned needlessly).
   * "Today" is the DB session's calendar day; `last_coder_allocated_at::date`
   * and `CURRENT_DATE` are compared in the same timezone, so they agree.
   * Returns the number of charts whose priority changed.
   */
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const changed: Array<{ id: string }> = await this.charts.query(`
        UPDATE charts c
        SET priority = sub.new_priority,
            updated_at = now()
        FROM (
          SELECT
            c2.id,
            CASE
              WHEN EXISTS (SELECT 1 FROM chart_feedback f WHERE f.chart_id = c2.id)
                THEN 'HIGH'
              WHEN c2.last_coder_allocated_at::date = CURRENT_DATE
                THEN 'LOW'
              WHEN c2.last_coder_allocated_at::date < CURRENT_DATE
                   AND c2.milestone IN ('READY_TO_ALLOCATE', 'READY_TO_CODE')
                THEN 'MEDIUM'
              ELSE c2.priority
            END AS new_priority
          FROM charts c2
          JOIN worklists w ON w.id = c2.worklist_id
          WHERE c2.deleted_at IS NULL
            AND w.deleted_at IS NULL
            AND c2.allocated_coder_id IS NOT NULL
            AND c2.priority NOT IN ('CRITICAL', 'FINALIZED')
        ) sub
        WHERE c.id = sub.id
          AND c.priority IS DISTINCT FROM sub.new_priority
        RETURNING c.id
      `);
      const count = Array.isArray(changed) ? changed.length : 0;
      if (count > 0) this.log.log(`Priority sweep re-bucketed ${count} chart(s).`);
      return count;
    } finally {
      this.running = false;
    }
  }
}
