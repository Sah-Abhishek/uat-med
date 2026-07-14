import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Nightly release of ALL manual priority pins.
 *
 * A manual pin (`manual_priority_at IS NOT NULL`) overrides a chart's computed
 * bucket with the stored `priority` value (see `priority-rules.ts`
 * `priorityBucketSql`): the CRITICAL bucket is entirely manual pins, and a
 * manager's Modify-Charts HIGH/MEDIUM/LOW choice is also carried as a pin until
 * the allocated user touches the chart (§7.3). This job releases every one of
 * those pins at the start of each India-business day (00:00 IST) so no manual
 * override survives into the new day; each released chart falls back to its
 * computed HIGH/MEDIUM/LOW bucket.
 *
 * "Release" nulls `manual_priority_at` ONLY and keeps the stored `priority`
 * value, so a manager can re-pin the same chart later and the action stays
 * reversible from the nightly backup. This mirrors every prior manual-pin
 * cleanup (single UPDATE nulling `manual_priority_at`, `priority` left intact).
 *
 * Controls (env-only, so prod behaviour can change without a code deploy):
 *   • PIN_CLEAR_ENABLED=false  → skip the run entirely.
 * The schedule is fixed at 00:00 Asia/Kolkata.
 */
@Injectable()
export class ManualPinClearService {
  private readonly log = new Logger(ManualPinClearService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Cron('0 0 * * *', { name: 'clear-manual-pins', timeZone: 'Asia/Kolkata' })
  async clearManualPins(): Promise<void> {
    if (process.env.PIN_CLEAR_ENABLED === 'false') {
      this.log.log(
        'Nightly manual-pin clear disabled (PIN_CLEAR_ENABLED=false); skipping.',
      );
      return;
    }

    // Snapshot + release in one transaction so the backup matches the rows
    // actually cleared, even if a manager pins/unpins concurrently.
    const released: Array<{ id: number; priority: string; manual_priority_at: string }> =
      await this.dataSource.transaction(async (manager) => {
        const rows: Array<{ id: number; priority: string; manual_priority_at: string }> =
          await manager.query(
            `SELECT id, priority, manual_priority_at
               FROM charts
              WHERE manual_priority_at IS NOT NULL
              ORDER BY id`,
          );
        if (rows.length === 0) return rows;

        const updated: Array<{ id: number }> = await manager.query(
          `UPDATE charts
              SET manual_priority_at = NULL
            WHERE manual_priority_at IS NOT NULL
            RETURNING id`,
        );
        // Guard against a snapshot/update mismatch (would mean the backup is
        // incomplete); the txn rolls back so nothing is half-cleared.
        if (updated.length !== rows.length) {
          throw new Error(
            `Manual-pin clear aborted: snapshot ${rows.length} != updated ${updated.length}`,
          );
        }
        return rows;
      });

    if (released.length === 0) {
      this.log.log('Nightly manual-pin clear: no manual pins; nothing to do.');
      return;
    }

    // Structured, always-on audit line — the released ids + original pin
    // timestamps live in the app log even if the file backup below fails, so a
    // restore is always possible (re-set manual_priority_at from these).
    this.log.log(
      `Nightly manual-pin clear: released ${released.length} manual pin(s). ` +
        `snapshot=${JSON.stringify(released)}`,
    );

    await this.writeBackup(released).catch((err) =>
      this.log.warn(
        `Nightly manual-pin clear: file backup failed (${(err as Error).message}); ` +
          `snapshot preserved in the log line above.`,
      ),
    );
  }

  /** Best-effort JSON snapshot to <cwd>/data-backups, matching the manual
   * pin-cleanup backup convention. Failure never blocks the clear. */
  private async writeBackup(
    rows: Array<{ id: number; priority: string; manual_priority_at: string }>,
  ): Promise<void> {
    const dir = path.resolve(process.cwd(), 'data-backups');
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `manual_pin_clear_${stamp}.json`);
    await fs.writeFile(file, JSON.stringify(rows, null, 2), 'utf8');
    this.log.log(`Nightly manual-pin clear: backup written to ${file} (${rows.length} rows).`);
  }
}
