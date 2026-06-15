import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Chart } from '../../entities/chart.entity';
import { AiPredictorService, UploadedDocument } from './ai-predictor.service';
import { aiProcessingMs } from './charts.service';

const TICK_MS = 10_000;
// Predictions older than this are considered dead and removed so the watcher
// stops polling forever. Matches FE POLL_TIMEOUT_MS so the user-visible and
// server-side ceilings agree.
const MAX_AGE_MS = 30 * 60 * 1000;

interface PendingPrediction {
  encounterId: string;
  taskId: string;
  reportIds: string[];
  startedAt: string;
  attempts?: number;
  lastError?: string;
  // Latest gateway-reported status — drives QUEUED vs PROCESSING in the FE.
  gatewayStatus?: 'PENDING' | 'STARTED';
}

/**
 * Drives ICD predictions to completion server-side.
 *
 * Phase 1 of the encounter flow (`POST /charts/:id/process-documents`) writes
 * a `pendingPrediction` blob to the chart's `customFields` and returns. The
 * frontend then polls + finalizes — but if the user navigates away, loses
 * connectivity, or has their JWT expire mid-poll, the encounter is orphaned
 * and the chart shows uploaded files with no codes. This watcher closes that
 * gap: regardless of FE state, every pending encounter is polled and
 * finalized (or marked failed) by the backend.
 */
@Injectable()
export class AiPipelineWatcher implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AiPipelineWatcher.name);
  private timer: NodeJS.Timeout | null = null;
  // Per-chart guard — prevents overlapping ticks from racing on the same row.
  private readonly inFlight = new Set<number>();

  constructor(
    @InjectRepository(Chart) private readonly charts: Repository<Chart>,
    private readonly ai: AiPredictorService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        this.log.error(`watcher tick failed: ${(err as Error).message}`),
      );
    }, TICK_MS);
    // Don't keep the event loop alive solely for this timer.
    this.timer.unref?.();
    this.log.log(`AI pipeline watcher started (every ${TICK_MS}ms, max age ${MAX_AGE_MS}ms)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const rows = await this.charts
      .createQueryBuilder('c')
      .where(`c.custom_fields ? 'pendingPrediction'`)
      .getMany();
    if (!rows.length) return;
    await Promise.all(rows.map((c) => this.processOne(c)));
  }

  private async processOne(c: Chart): Promise<void> {
    if (this.inFlight.has(c.id)) return;
    this.inFlight.add(c.id);
    try {
      const pending = c.customFields?.pendingPrediction as PendingPrediction | undefined;
      if (!pending?.encounterId || !pending.taskId) return;

      const startedAt = Date.parse(pending.startedAt ?? '');
      const ageMs = Number.isFinite(startedAt) ? Date.now() - startedAt : MAX_AGE_MS + 1;
      if (ageMs > MAX_AGE_MS) {
        this.log.warn(
          `chart=${c.id} encounter=${pending.encounterId} aged out (${Math.round(ageMs / 1000)}s); marking failed.`,
        );
        await this.markFailed(c.id, pending, `Pipeline timed out after ${Math.round(MAX_AGE_MS / 60000)} minutes.`);
        return;
      }

      let status;
      try {
        status = await this.ai.getEncounterStatus(pending.encounterId, pending.taskId);
      } catch (err) {
        await this.recordTransientError(c.id, (err as Error).message);
        return;
      }

      if (status.status === 'SUCCESS') {
        await this.finalize(c.id, pending);
      } else if (status.status === 'FAILURE') {
        await this.markFailed(c.id, pending, status.error ?? 'Pipeline reported failure.');
      } else {
        // PENDING / STARTED — record so the FE can show queued vs processing.
        const next: 'PENDING' | 'STARTED' = status.status === 'STARTED' ? 'STARTED' : 'PENDING';
        if (pending.gatewayStatus !== next) {
          await this.recordGatewayStatus(c.id, next);
        }
      }
    } catch (err) {
      this.log.error(`chart=${c.id} watcher error: ${(err as Error).message}`);
    } finally {
      this.inFlight.delete(c.id);
    }
  }

  private async finalize(chartId: number, pending: PendingPrediction): Promise<void> {
    const result = await this.ai.finalizeEncounter(
      pending.encounterId,
      pending.reportIds ?? [],
      (pending.reportIds ?? []).length,
    );
    const completedAt = new Date();
    const processingMs = aiProcessingMs(pending.startedAt, completedAt);

    // Re-read so we don't stomp concurrent edits to other customFields keys.
    const fresh = await this.charts.findOne({ where: { id: chartId } });
    if (!fresh) return;

    const uploadedDocs =
      (fresh.customFields?.uploadedDocs as UploadedDocument[] | undefined) ?? [];
    // Drop any prior failure record so the chart resolves to DONE, not
    // ERRORED, after a successful re-run.
    const { pendingPrediction: _drop, aiPredictionError: _drop2, ...keepCustom } = fresh.customFields ?? {};
    fresh.customFields = {
      ...keepCustom,
      uploadedDocs,
      aiPrediction: {
        encounterId: result.encounterId,
        reportIds: result.reportIds,
        status: result.status,
        codes: result.codes,
        primary: result.primary,
        secondary: result.secondary,
        procedures: result.procedures,
        clinicalSummary: result.clinicalSummary,
        auditNotes: result.auditNotes,
        codingTips: result.codingTips,
        complianceAlerts: result.complianceAlerts,
        documentationGaps: result.documentationGaps,
        physicianQueries: result.physicianQueries,
        // Document-processing timing — startedAt preserved from the pending
        // marker (dropped just above) so the duration stays reconstructable.
        startedAt: pending.startedAt ?? null,
        completedAt: completedAt.toISOString(),
        processingMs,
        generatedAt: completedAt.toISOString(),
      },
    };
    await this.charts.save(fresh);
    this.log.log(
      `chart=${chartId} encounter=${pending.encounterId} finalized ` +
        `(${result.codes.length} codes${processingMs != null ? `, ${Math.round(processingMs / 1000)}s` : ''}).`,
    );
  }

  private async markFailed(
    chartId: number,
    pending: PendingPrediction,
    error: string,
  ): Promise<void> {
    const fresh = await this.charts.findOne({ where: { id: chartId } });
    if (!fresh) return;
    const { pendingPrediction: _drop, ...keepCustom } = fresh.customFields ?? {};
    // If a prediction for this same encounter is already stored, the run
    // actually SUCCEEDED and this pending blob is stale (resurrected by a
    // concurrent write). Just clear the marker — stamping a timeout error
    // here would flip a successful chart to ERRORED.
    if (this.alreadyFinalized(fresh, pending)) {
      this.log.warn(
        `chart=${chartId} encounter=${pending.encounterId} already finalized; clearing stale pendingPrediction instead of marking failed.`,
      );
      fresh.customFields = keepCustom;
      await this.charts.save(fresh);
      return;
    }
    fresh.customFields = {
      ...keepCustom,
      aiPredictionError: {
        encounterId: pending.encounterId,
        error,
        attempts: pending.attempts ?? 0,
        failedAt: new Date().toISOString(),
      },
    };
    await this.charts.save(fresh);
  }

  private async recordTransientError(chartId: number, error: string): Promise<void> {
    const fresh = await this.charts.findOne({ where: { id: chartId } });
    if (!fresh) return;
    const cur = fresh.customFields?.pendingPrediction as PendingPrediction | undefined;
    if (!cur || this.alreadyFinalized(fresh, cur)) return;
    await this.patchPendingPrediction(chartId, {
      ...cur,
      attempts: (cur.attempts ?? 0) + 1,
      lastError: error,
    });
  }

  private async recordGatewayStatus(
    chartId: number,
    gatewayStatus: 'PENDING' | 'STARTED',
  ): Promise<void> {
    const fresh = await this.charts.findOne({ where: { id: chartId } });
    if (!fresh) return;
    const cur = fresh.customFields?.pendingPrediction as PendingPrediction | undefined;
    if (!cur || this.alreadyFinalized(fresh, cur)) return;
    await this.patchPendingPrediction(chartId, { ...cur, gatewayStatus });
  }

  /** True when the chart already stores a successful prediction for this
   * same encounter — i.e. the run finished and `pendingPrediction` is stale. */
  private alreadyFinalized(fresh: Chart, pending: PendingPrediction): boolean {
    const doneEncounterId = (
      fresh.customFields?.aiPrediction as { encounterId?: string } | undefined
    )?.encounterId;
    return !!doneEncounterId && doneEncounterId === pending.encounterId;
  }

  /** Overwrite `pendingPrediction` via a single conditional UPDATE instead of
   * a read-modify-write save(). The `custom_fields ? 'pendingPrediction'`
   * guard makes this a no-op when a finalize (FE HTTP request or watcher)
   * commits between our read and this write — so a finished run's marker can
   * never be resurrected — and jsonb_set touches only this key, so concurrent
   * edits to other custom_fields keys are never stomped. */
  private async patchPendingPrediction(chartId: number, next: PendingPrediction): Promise<void> {
    await this.charts.query(
      `UPDATE charts
          SET custom_fields = jsonb_set(custom_fields, '{pendingPrediction}', $1::jsonb)
        WHERE id = $2 AND custom_fields ? 'pendingPrediction'`,
      [JSON.stringify(next), chartId],
    );
  }
}
