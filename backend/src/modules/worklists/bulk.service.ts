import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import AdmZip = require('adm-zip');

import { Chart } from '../../entities/chart.entity';
import { Worklist } from '../../entities/worklist.entity';
import { ChartMilestone, ChartStatus, Priority } from '../../common/enums';
import { DocumentStorageService } from '../charts/document-storage.service';
import { DocumentConversionService } from '../charts/document-conversion.service';
import { AiPredictorService, type ReportType, type InboundFile } from '../charts/ai-predictor.service';
import { CreateWorklistDto } from './dto/create-worklist.dto';

/** Canonical column headers the bulk-import Excel must contain (case-insensitive). */
const REQUIRED_COLUMNS = ['A/C', 'MRN', 'DOS', 'ADM', 'DSC'] as const;

interface ParsedRow {
  row: number;
  chartNo: string;
  mrNumber: string;
  dos: string;
  admitDate: string;
  dischargeDate: string;
  errors: string[];
}

export interface BulkImportPreview {
  totalRows: number;
  validRows: number;
  rows: ParsedRow[];
  errors: Array<{ row: number; field?: string; message: string }>;
}

export interface BulkImportResult {
  inserted: number;
  skipped: number;
  charts: Array<{ id: string; serialNo: number; chartNo: string; mrNumber: string }>;
  errors: Array<{ row: number; field?: string; message: string }>;
}

export interface BulkDocumentsResult {
  matched: Array<{
    chartId: string;
    chartNo: string;
    filename: string;
    matchedBy: 'folder' | 'chartNo' | 'mrNumber' | 'manual';
    storedKey: string;
  }>;
  /**
   * Files we couldn't auto-route. We still upload them to S3 under a staged
   * path so the team lead can drag-drop them onto charts without re-uploading.
   * Once assigned, the same S3 object is just referenced from the chart's
   * uploadedDocs array — no copy/move.
   */
  unmatched: Array<{
    filename: string;
    reason: 'no_token_match' | 'ambiguous_mrn';
    stagedKey: string;
    stagedUrl: string;
    mimeType: string;
    size: number;
    candidates?: Array<{ chartId: string; chartNo: string }>;
  }>;
  skipped: Array<{ filename: string; reason: string }>;
}

export interface AssignStagedResult {
  assigned: number;
  skipped: Array<{ stagedKey: string; reason: 'chart_not_in_worklist' | 'chart_not_found' }>;
}

export interface RunAiResult {
  eligible: number;
  triggered: number;
  skipped: Array<{ chartId: string; reason: 'already_done' | 'already_in_flight' | 'no_documents' | 'gateway_error'; message?: string }>;
}

export interface ClearStuckAiResult {
  cleared: number;
  /** Chart IDs whose pendingPrediction was wiped. */
  chartIds: string[];
}

export interface RetryErroredResult {
  /** Errored charts that were re-queued for the AI pipeline. */
  queued: number;
  /** Errored charts skipped — currently only those with no documents to
   * reprocess (reprocess re-reads the stored docs from object storage). */
  skipped: Array<{ chartId: string; reason: 'no_documents' }>;
}

/**
 * Cadence of the AI-dispatch reconciler loop (see `reconcileTick`). The DB is
 * the queue: every tick we scan for charts with `pendingPrediction.awaitingDispatch=true`
 * and dispatch one per worklist that isn't already running on the gateway.
 * Picking 5s balances latency (user sees Queued → Processing within seconds)
 * against DB load (two cheap indexed JSONB queries per tick).
 */
const RECONCILE_TICK_MS = 5_000;

/**
 * Global ceiling on dispatches in flight at any moment, across all worklists.
 * The reconciler still serializes per-worklist, but without a global cap a
 * 40-chart retry across 30 worklists would fire 30 parallel startEncounter()
 * calls and stampede the gateway — observed in prod as "2 succeed, 28 fail
 * with transient errors". Tune via env to match the gateway's tenant capacity.
 */
const MAX_CONCURRENT_DISPATCHES = Math.max(
  1,
  Number(process.env.AI_DISPATCH_MAX_CONCURRENT) || 2,
);

/**
 * How many transient failures we tolerate before giving up on a chart and
 * marking it permanently Errored. Each tick is one retry attempt (5s apart),
 * so 5 attempts ≈ 25s of transient-error tolerance per chart.
 */
const MAX_DISPATCH_ATTEMPTS = 5;

@Injectable()
export class WorklistBulkService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WorklistBulkService.name);
  /**
   * Chart IDs currently being dispatched to the gateway *in this process*.
   * Short-lived guard against double-dispatch when a tick fires while a
   * previous startEncounter is still in flight. The DB (the
   * `awaitingDispatch: true` flag) is the durable queue — this Set is lost on
   * restart, but the very next reconcile tick rediscovers any chart left
   * mid-dispatch from `awaitingDispatch=true` rows in the DB and resumes.
   */
  private readonly dispatching = new Set<number>();
  private reconcilerTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(Chart) private readonly charts: Repository<Chart>,
    @InjectRepository(Worklist) private readonly worklists: Repository<Worklist>,
    private readonly ds: DataSource,
    private readonly storage: DocumentStorageService,
    private readonly conversion: DocumentConversionService,
    private readonly aiPredictor: AiPredictorService,
  ) {}

  onModuleInit() {
    this.reconcilerTimer = setInterval(() => {
      this.reconcileTick().catch((err) =>
        this.log.error(`AI reconciler tick failed: ${(err as Error).message}`),
      );
    }, RECONCILE_TICK_MS);
    // Don't keep the event loop alive solely for this timer (matches the
    // AiPipelineWatcher pattern).
    this.reconcilerTimer.unref?.();
    this.log.log(`AI dispatch reconciler started (every ${RECONCILE_TICK_MS}ms)`);
  }

  onModuleDestroy() {
    if (this.reconcilerTimer) clearInterval(this.reconcilerTimer);
    this.reconcilerTimer = null;
  }

  /**
   * The reconciler loop. The DB is the queue:
   *   - `awaitingDispatch=true`         → "queued, waiting to be sent to gateway"
   *   - `pendingPrediction` with set `encounterId` → "running on gateway"
   *
   * Each tick: find every awaiting chart (oldest first), bucket by worklist,
   * and for each worklist that isn't already running a chart on the gateway,
   * dispatch the oldest one. Fire-and-forget so the tick returns quickly; the
   * `dispatching` Set keeps a second tick from re-dispatching the same chart
   * while its startEncounter is still in flight. On any thrown error we stamp
   * `aiPredictionError` on the chart so it doesn't loop forever.
   */
  private async reconcileTick(): Promise<void> {
    // 1) Find every chart awaiting dispatch (oldest first). Orphans excluded —
    // never resurrect work for a chart whose worklist was soft-deleted.
    const awaitingRows: Array<{ id: string | number; worklistId: string | number }> =
      await this.charts
        .createQueryBuilder('c')
        .select('c.id', 'id')
        .addSelect('c.worklist_id', 'worklistId')
        .where(`c.custom_fields->'pendingPrediction'->>'awaitingDispatch' = 'true'`)
        .andWhere(
          `EXISTS (SELECT 1 FROM worklists w WHERE w.id = c.worklist_id AND w.deleted_at IS NULL)`,
        )
        .orderBy(`c.custom_fields->'pendingPrediction'->>'startedAt'`, 'ASC')
        .getRawMany();
    if (awaitingRows.length === 0) return;

    // 2) Worklists with a chart already running on the gateway (post-dispatch,
    // `encounterId` set). One-dispatch-per-worklist is enforced here so the
    // gateway never sees two starts from the same worklist simultaneously.
    const inFlightRows: Array<{ worklistId: string | number }> = await this.charts
      .createQueryBuilder('c')
      .select('DISTINCT c.worklist_id', 'worklistId')
      .where(`c.custom_fields ? 'pendingPrediction'`)
      .andWhere(`COALESCE(c.custom_fields->'pendingPrediction'->>'awaitingDispatch','') != 'true'`)
      .andWhere(`COALESCE(c.custom_fields->'pendingPrediction'->>'encounterId','') != ''`)
      .getRawMany();
    const busy = new Set<number>(inFlightRows.map((r) => Number(r.worklistId)));

    // 3) Bucket awaiting charts by worklist, then dispatch the oldest one for
    // each worklist that's free.
    const byWorklist = new Map<number, number[]>();
    for (const r of awaitingRows) {
      const wid = Number(r.worklistId);
      const arr = byWorklist.get(wid) ?? [];
      arr.push(Number(r.id));
      byWorklist.set(wid, arr);
    }

    for (const [worklistId, chartIds] of byWorklist) {
      // Global concurrency cap. Per-worklist serialization is enforced by the
      // `busy` check below; this protects the gateway from a wide cross-
      // worklist stampede when many worklists each have queued work.
      if (this.dispatching.size >= MAX_CONCURRENT_DISPATCHES) break;
      if (busy.has(worklistId)) continue;
      if (chartIds.some((id) => this.dispatching.has(id))) continue;
      const chartId = chartIds[0]; // oldest, thanks to the ORDER BY above
      this.dispatching.add(chartId);
      // Fire-and-forget. Each dispatch can take seconds (S3 download + gateway
      // start); the tick must return quickly so the next one can run. Errors
      // are classified — transient (gateway 5xx/429, network) loops the chart
      // back into the queue (up to MAX_DISPATCH_ATTEMPTS); permanent errors
      // (4xx, bad payload) stamp aiPredictionError immediately.
      void this.dispatchOneChartToGateway(chartId)
        .catch(async (err) => {
          const msg = (err as Error)?.message ?? String(err);
          if (this.isTransientDispatchError(err)) {
            const willRetry = await this.recordTransientDispatchError(chartId, msg);
            if (willRetry) {
              this.log.warn(
                `AI dispatch chart=${chartId} (worklist=${worklistId}): transient (${msg}); will retry`,
              );
              return;
            }
            this.log.error(
              `AI dispatch chart=${chartId} (worklist=${worklistId}): transient exhausted after ${MAX_DISPATCH_ATTEMPTS} attempts (${msg})`,
            );
            return this.markChartGatewayError(
              chartId,
              `Gave up after ${MAX_DISPATCH_ATTEMPTS} transient failures; last error: ${msg}`,
            );
          }
          this.log.error(
            `AI dispatch chart=${chartId} (worklist=${worklistId}): permanent (${msg})`,
          );
          return this.markChartGatewayError(chartId, msg);
        })
        .finally(() => {
          this.dispatching.delete(chartId);
        });
    }
  }

  /** Heuristic: gateway 5xx/429/408, common Node network error codes, and
   * timeout/connection-reset text patterns are treated as transient (worth
   * retrying). Everything else is treated as permanent. */
  private isTransientDispatchError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { code?: string; response?: { status?: number }; message?: string };
    if (e.code && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN'].includes(e.code)) {
      return true;
    }
    const status = e.response?.status;
    if (status === 408 || status === 429 || (typeof status === 'number' && status >= 500)) {
      return true;
    }
    const msg = (e.message ?? '').toLowerCase();
    if (
      msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('socket hang up') ||
      msg.includes('network error')
    ) {
      return true;
    }
    return false;
  }

  /**
   * Record a transient failure on the chart so it stays in the queue (next
   * reconciler tick retries it). Returns false once the attempt count hits
   * `MAX_DISPATCH_ATTEMPTS`, telling the caller to give up and mark it Errored.
   */
  private async recordTransientDispatchError(chartId: number, message: string): Promise<boolean> {
    const c = await this.charts.findOne({ where: { id: chartId } });
    if (!c) return false;
    const cf = (c.customFields ?? {}) as Record<string, unknown>;
    const pending = cf.pendingPrediction as Record<string, unknown> | undefined;
    // If pendingPrediction is gone, the user/admin cleared the chart mid-dispatch —
    // don't resurrect it. Caller should also skip markChartGatewayError below.
    if (!pending) return true;
    const prevAttempts = typeof pending.attempts === 'number' ? pending.attempts : 0;
    const attempts = prevAttempts + 1;
    if (attempts >= MAX_DISPATCH_ATTEMPTS) return false;
    c.customFields = {
      ...cf,
      pendingPrediction: {
        ...pending,
        attempts,
        lastTransientError: message,
        // Belt-and-braces: ensure we stay in the queue for the next tick.
        awaitingDispatch: true,
      },
    };
    await this.charts.save(c);
    return true;
  }

  /* ── Excel preview (no writes) ─────────────────────────── */
  async preview(worklistId: number, file: Express.Multer.File): Promise<BulkImportPreview> {
    await this.ensureWorklist(worklistId);
    if (!file) throw new BadRequestException({ error: { code: 'bad_request', message: 'No file uploaded.' } });

    const { rows, headerErrors } = await this.parseExcel(file);
    const errors: BulkImportPreview['errors'] = [...headerErrors];
    for (const r of rows) {
      for (const m of r.errors) errors.push({ row: r.row, message: m });
    }
    return {
      totalRows: rows.length,
      validRows: rows.filter((r) => r.errors.length === 0).length,
      rows,
      errors,
    };
  }

  /* ── Excel import (transactional insert) ───────────────── */
  async import(worklistId: number, file: Express.Multer.File): Promise<BulkImportResult> {
    await this.ensureWorklist(worklistId);
    if (!file) throw new BadRequestException({ error: { code: 'bad_request', message: 'No file uploaded.' } });

    const { rows, headerErrors } = await this.parseExcel(file);
    if (headerErrors.length > 0) {
      throw new BadRequestException({ error: { code: 'bad_request', message: headerErrors[0].message, details: { headers: headerErrors.map((e) => e.message) } } });
    }
    const valid = rows.filter((r) => r.errors.length === 0);
    if (valid.length === 0) {
      return {
        inserted: 0,
        skipped: rows.length,
        charts: [],
        errors: rows.flatMap((r) => r.errors.map((m) => ({ row: r.row, message: m }))),
      };
    }

    return this.ds.transaction(async (manager) => {
      const cRepo = manager.getRepository(Chart);

      const maxRow = await cRepo
        .createQueryBuilder('c')
        .select('COALESCE(MAX(c.serial_no), 0)', 'max')
        .where('c.worklist_id = :w', { w: worklistId })
        .getRawOne<{ max: string | number }>();
      let serial = Number(maxRow?.max ?? 0);

      // Surface chart-number duplicates against existing rows in this worklist
      // so the team lead doesn't silently double-import the same encounters.
      const incomingChartNos = valid.map((r) => r.chartNo);
      const existing = await cRepo
        .createQueryBuilder('c')
        .where('c.worklist_id = :w', { w: worklistId })
        .andWhere('c.chart_no IN (:...nos)', { nos: incomingChartNos })
        .getMany();
      const existingSet = new Set(existing.map((c) => c.chartNo));

      const toInsert: Chart[] = [];
      const errors: BulkImportResult['errors'] = [];
      let skipped = 0;

      for (const r of valid) {
        if (existingSet.has(r.chartNo)) {
          skipped += 1;
          errors.push({ row: r.row, field: 'chartNo', message: `Chart ${r.chartNo} already exists in this worklist — skipped.` });
          continue;
        }
        serial += 1;
        const c = cRepo.create({
          worklistId,
          serialNo: serial,
          chartNo: r.chartNo,
          mrNumber: r.mrNumber,
          dos: r.dos,
          admitDate: r.admitDate,
          dischargeDate: r.dischargeDate,
          milestone: ChartMilestone.READY_TO_ALLOCATE,
          chartStatus: ChartStatus.OPEN,
          priority: Priority.MEDIUM,
          customFields: {},
        } as Partial<Chart>);
        toInsert.push(c);
      }

      const inserted = toInsert.length > 0 ? await cRepo.save(toInsert) : [];
      // Skip-with-error rows from validation still need to bubble up.
      for (const r of rows.filter((r) => r.errors.length > 0)) {
        for (const m of r.errors) errors.push({ row: r.row, message: m });
        skipped += 1;
      }

      return {
        inserted: inserted.length,
        skipped,
        charts: inserted.map((c) => ({
          id: String(c.id),
          serialNo: c.serialNo,
          chartNo: c.chartNo ?? '',
          mrNumber: c.mrNumber ?? '',
        })),
        errors,
      };
    });
  }

  /* ── Document bulk upload + matching ───────────────────── */
  async uploadDocuments(
    worklistId: number,
    files: Express.Multer.File[],
    manualMappings: Array<{ filename: string; chartId: string }> = [],
  ): Promise<BulkDocumentsResult> {
    await this.ensureWorklist(worklistId);
    if (!files || files.length === 0) {
      throw new BadRequestException({ error: { code: 'bad_request', message: 'No files uploaded.' } });
    }

    const charts = await this.charts.find({ where: { worklistId } });
    if (charts.length === 0) {
      throw new BadRequestException({
        error: { code: 'bad_request', message: 'This worklist has no charts yet — import the Excel first.' },
      });
    }

    // Build lookup maps once.
    const chartByChartNo = new Map<string, Chart>();
    const chartsByMrn = new Map<string, Chart[]>();
    for (const c of charts) {
      if (c.chartNo) chartByChartNo.set(c.chartNo.toLowerCase(), c);
      if (c.mrNumber) {
        const arr = chartsByMrn.get(c.mrNumber.toLowerCase()) ?? [];
        arr.push(c);
        chartsByMrn.set(c.mrNumber.toLowerCase(), arr);
      }
    }
    const chartById = new Map<string, Chart>();
    for (const c of charts) chartById.set(String(c.id), c);

    // 1. Expand all uploaded files: if a file is a ZIP, extract its entries
    //    while remembering the top-level folder name (used for matching).
    type Candidate = {
      filename: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
      folderHint?: string;
    };
    const candidates: Candidate[] = [];
    const skipped: BulkDocumentsResult['skipped'] = [];

    for (const f of files) {
      if (this.isZip(f)) {
        try {
          const zip = new AdmZip(f.buffer);
          for (const entry of zip.getEntries()) {
            if (entry.isDirectory) continue;
            const entryName = entry.entryName.replace(/\\/g, '/');
            const segments = entryName.split('/').filter(Boolean);
            const baseName = segments[segments.length - 1];
            // Skip macOS sidecars, dotfiles, and the __MACOSX wrapper folder.
            if (baseName.startsWith('.') || entryName.startsWith('__MACOSX/')) continue;
            // Only surface real clinical-document types — pdf/word/images/txt —
            // so the unmatched panel isn't polluted by README.md, Thumbs.db, etc.
            if (!this.isDocumentType(baseName)) {
              skipped.push({ filename: baseName, reason: 'unsupported_type' });
              continue;
            }
            const folderHint = segments.length > 1 ? segments[0] : undefined;
            candidates.push({
              filename: baseName,
              mimetype: this.guessMime(baseName),
              buffer: entry.getData(),
              size: entry.getData().length,
              folderHint,
            });
          }
        } catch (err) {
          this.log.error(`Failed to read zip ${f.originalname}: ${(err as Error).message}`);
          skipped.push({ filename: f.originalname, reason: 'unreadable_zip' });
        }
      } else {
        candidates.push({
          filename: f.originalname,
          mimetype: f.mimetype,
          buffer: f.buffer,
          size: f.size,
        });
      }
    }

    // 2. Apply manual mappings first (by filename). Manual wins.
    const manualMap = new Map<string, string>();
    for (const m of manualMappings) {
      if (m.filename && m.chartId) manualMap.set(m.filename.toLowerCase(), String(m.chartId));
    }

    const matched: BulkDocumentsResult['matched'] = [];
    const unmatched: BulkDocumentsResult['unmatched'] = [];

    for (const c of candidates) {
      // (a) manual override
      const manualId = manualMap.get(c.filename.toLowerCase());
      if (manualId && chartById.has(manualId)) {
        const chart = chartById.get(manualId)!;
        const stored = await this.persistOne(chart, c);
        matched.push({
          chartId: String(chart.id),
          chartNo: chart.chartNo ?? '',
          filename: c.filename,
          matchedBy: 'manual',
          storedKey: stored,
        });
        continue;
      }

      // (b) ZIP folder name = chartNo
      if (c.folderHint) {
        const hit = chartByChartNo.get(c.folderHint.toLowerCase());
        if (hit) {
          const stored = await this.persistOne(hit, c);
          matched.push({
            chartId: String(hit.id),
            chartNo: hit.chartNo ?? '',
            filename: c.filename,
            matchedBy: 'folder',
            storedKey: stored,
          });
          continue;
        }
      }

      // (c) filename token = chartNo
      const tokens = this.tokenize(c.filename);
      const chartHit = tokens
        .map((t) => chartByChartNo.get(t.toLowerCase()))
        .find((x): x is Chart => Boolean(x));
      if (chartHit) {
        const stored = await this.persistOne(chartHit, c);
        matched.push({
          chartId: String(chartHit.id),
          chartNo: chartHit.chartNo ?? '',
          filename: c.filename,
          matchedBy: 'chartNo',
          storedKey: stored,
        });
        continue;
      }

      // (d) filename token = mrNumber (only when unambiguous in this worklist)
      let mrnHit: Chart | undefined;
      let mrnAmbiguous = false;
      for (const t of tokens) {
        const list = chartsByMrn.get(t.toLowerCase());
        if (!list) continue;
        if (list.length === 1) {
          mrnHit = list[0];
          break;
        }
        mrnAmbiguous = true;
      }
      if (mrnHit) {
        const stored = await this.persistOne(mrnHit, c);
        matched.push({
          chartId: String(mrnHit.id),
          chartNo: mrnHit.chartNo ?? '',
          filename: c.filename,
          matchedBy: 'mrNumber',
          storedKey: stored,
        });
        continue;
      }

      // Upload to a staged S3 path so the team lead can drag-drop later
      // without re-uploading. The same object will be referenced (not copied)
      // when the file is finally assigned to a chart.
      const staged = await this.storage.upload(
        {
          buffer: c.buffer,
          originalname: c.filename,
          mimetype: c.mimetype,
          size: c.size,
        },
        `_staged/${worklistId}`,
      );
      unmatched.push({
        filename: c.filename,
        reason: mrnAmbiguous ? 'ambiguous_mrn' : 'no_token_match',
        stagedKey: staged.key,
        stagedUrl: staged.url,
        mimeType: staged.mimeType,
        size: staged.size,
      });
    }

    return { matched, unmatched, skipped };
  }

  /* ── Drag-drop assignment of staged files to charts ───── */
  async assignStaged(
    worklistId: number,
    assignments: Array<{
      stagedKey: string;
      stagedUrl: string;
      filename: string;
      mimeType: string;
      size: number;
      chartId: string | number;
    }>,
  ): Promise<AssignStagedResult> {
    await this.ensureWorklist(worklistId);
    if (!assignments || assignments.length === 0) {
      throw new BadRequestException({ error: { code: 'bad_request', message: 'No assignments provided.' } });
    }
    // Group by chart so we only load each chart once and only save it once.
    const byChart = new Map<string, typeof assignments>();
    for (const a of assignments) {
      const key = String(a.chartId);
      const list = byChart.get(key) ?? [];
      list.push(a);
      byChart.set(key, list);
    }

    const chartIds = [...byChart.keys()].map((id) => Number(id)).filter((n) => Number.isFinite(n));
    const charts = await this.charts.find({ where: { id: In(chartIds) } });
    const validById = new Map<string, Chart>();
    for (const c of charts) {
      if (c.worklistId === worklistId) validById.set(String(c.id), c);
    }

    const skipped: AssignStagedResult['skipped'] = [];
    let assigned = 0;

    for (const [chartIdStr, list] of byChart.entries()) {
      const chart = validById.get(chartIdStr);
      if (!chart) {
        for (const a of list) {
          skipped.push({
            stagedKey: a.stagedKey,
            reason: charts.some((c) => String(c.id) === chartIdStr) ? 'chart_not_in_worklist' : 'chart_not_found',
          });
        }
        continue;
      }
      const existing = (chart.customFields?.uploadedDocs as Array<Record<string, unknown>> | undefined) ?? [];
      const additions = list.map((a) => ({
        key: a.stagedKey,
        url: a.stagedUrl,
        bucket: undefined,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        uploadedAt: new Date().toISOString(),
        source: 'bulk-upload-manual',
      }));
      chart.customFields = {
        ...(chart.customFields ?? {}),
        uploadedDocs: [...existing, ...additions],
      };
      await this.charts.save(chart);
      assigned += additions.length;
    }

    return { assigned, skipped };
  }

  /* ── Create worklist + import Excel in one transaction ── */
  async createFromExcel(
    dto: CreateWorklistDto,
    file: Express.Multer.File,
    userId: number,
  ): Promise<{
    id: string;
    worklistNumber: string;
    inserted: number;
    skipped: number;
    errors: BulkImportResult['errors'];
  }> {
    if (!file) {
      throw new BadRequestException({ error: { code: 'bad_request', message: 'No Excel file uploaded.' } });
    }
    // Parse + validate Excel first — if the workbook is garbage we surface the
    // error before any database side-effects so we never leave an empty
    // worklist sitting around for the team lead to clean up.
    const { rows, headerErrors } = await this.parseExcel(file);
    if (headerErrors.length > 0) {
      throw new BadRequestException({
        error: { code: 'bad_request', message: headerErrors[0].message, details: { headers: headerErrors.map((e) => e.message) } },
      });
    }
    const valid = rows.filter((r) => r.errors.length === 0);
    if (valid.length === 0) {
      throw new BadRequestException({
        error: {
          code: 'bad_request',
          message: 'No valid rows in the Excel — every row has at least one issue. Fix the file and try again.',
          details: {
            firstFew: rows.slice(0, 5).flatMap((r) => r.errors.map((m) => `Row ${r.row}: ${m}`)),
          },
        },
      });
    }

    // Worklist-number conflict short-circuits the transaction.
    const existing = await this.worklists.findOne({ where: { worklistNumber: dto.worklistNumber } });
    if (existing) throw new ConflictException({ error: { code: 'conflict', message: 'worklistNumber already exists.' } });

    return this.ds.transaction(async (manager) => {
      const wRepo = manager.getRepository(Worklist);
      const cRepo = manager.getRepository(Chart);

      const w = wRepo.create({
        worklistNumber: dto.worklistNumber,
        clientId: dto.clientId,
        locationId: dto.locationId,
        primarySpecialityId: dto.primarySpecialityId,
        processId: dto.processId,
        dateOfService: dto.dateOfService,
        dateOfServiceTo: dto.dateOfServiceTo,
        receivedDate: dto.receivedDate,
        totalCharts: valid.length,
        createdBy: userId,
      });
      const saved = await wRepo.save(w);

      const errors: BulkImportResult['errors'] = [];
      let serial = 0;
      const toInsert: Chart[] = [];
      for (const r of valid) {
        serial += 1;
        toInsert.push(
          cRepo.create({
            worklistId: saved.id,
            serialNo: serial,
            chartNo: r.chartNo,
            mrNumber: r.mrNumber,
            dos: r.dos,
            admitDate: r.admitDate,
            dischargeDate: r.dischargeDate,
            milestone: ChartMilestone.READY_TO_ALLOCATE,
            chartStatus: ChartStatus.OPEN,
            priority: Priority.MEDIUM,
            customFields: {},
          } as Partial<Chart>),
        );
      }
      // Chunk so we don't fire a single 5000-value INSERT on big worklists.
      const CHUNK = 200;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        await cRepo.save(toInsert.slice(i, i + CHUNK));
      }

      let skipped = 0;
      for (const r of rows.filter((r) => r.errors.length > 0)) {
        for (const m of r.errors) errors.push({ row: r.row, message: m });
        skipped += 1;
      }

      return {
        id: String(saved.id),
        worklistNumber: saved.worklistNumber,
        inserted: toInsert.length,
        skipped,
        errors,
      };
    });
  }

  /* ── Bulk-trigger AI pipeline on every eligible chart ── */
  /**
   * Queues an AI prediction for every chart in the worklist that has
   * documents uploaded but hasn't been processed yet. Dispatch is fully
   * sequential: each chart is sent to the gateway only after the *previous*
   * chart has finalized (or failed). This keeps the gateway from being
   * burst-loaded and prevents the "stuck queue" that occurs when many runs
   * pile up at once.
   *
   * The endpoint returns as soon as the charts are marked queued; the
   * `AiPipelineWatcher` finalizes each run, and a per-worklist background
   * worker advances the queue.
   */
  async runAiOnWorklist(worklistId: number): Promise<RunAiResult> {
    await this.ensureWorklist(worklistId);
    const charts = await this.charts.find({ where: { worklistId } });

    const skipped: RunAiResult['skipped'] = [];
    const eligible: Chart[] = [];
    for (const c of charts) {
      const cf = (c.customFields ?? {}) as Record<string, unknown>;
      const docs = (cf.uploadedDocs as Array<{ key?: string }> | undefined) ?? [];
      if (docs.length === 0) {
        skipped.push({ chartId: String(c.id), reason: 'no_documents' });
        continue;
      }
      if (cf.aiPrediction) {
        skipped.push({ chartId: String(c.id), reason: 'already_done' });
        continue;
      }
      if (cf.pendingPrediction) {
        skipped.push({ chartId: String(c.id), reason: 'already_in_flight' });
        continue;
      }
      eligible.push(c);
    }

    // Mark every eligible chart as queued immediately. They'll show up under
    // "Queued" in the UI right away, even though dispatch happens one at a
    // time over the next several minutes. The empty encounterId + the
    // awaitingDispatch flag tell the watcher to leave these alone — it only
    // polls the gateway once a real encounter has been opened.
    const now = new Date().toISOString();
    for (const c of eligible) {
      const { aiPredictionError: _drop, ...keepCustom } = (c.customFields ?? {}) as Record<string, unknown>;
      c.customFields = {
        ...keepCustom,
        pendingPrediction: {
          encounterId: '',
          taskId: '',
          reportIds: [],
          startedAt: now,
          gatewayStatus: 'PENDING',
          awaitingDispatch: true,
        },
      };
    }
    if (eligible.length > 0) await this.charts.save(eligible);

    // The DB rows we just wrote (`awaitingDispatch: true`) ARE the queue. The
    // reconciler will pick them up on its next tick; kick it once now so the
    // first dispatch happens within ~ms instead of waiting up to a full tick.
    if (eligible.length > 0) void this.reconcileTick().catch(() => undefined);

    return {
      eligible: eligible.length,
      triggered: eligible.length,
      skipped,
    };
  }

  private async dispatchOneChartToGateway(chartId: number): Promise<boolean> {
    // Load the worklist's primary speciality so it can be forwarded to the gateway.
    const c = await this.charts.findOne({
      where: { id: chartId },
      relations: { worklist: { primarySpeciality: true } },
    });
    if (!c) return false;
    const cf = (c.customFields ?? {}) as Record<string, unknown>;
    const pending = cf.pendingPrediction as { awaitingDispatch?: boolean } | undefined;
    // The user may have hit "Clear stuck queue" while this chart was still in
    // line — its pendingPrediction will be gone. Skip silently.
    if (!pending?.awaitingDispatch) return false;

    const docs =
      (cf.uploadedDocs as Array<{ key?: string; url?: string; filename: string; mimeType?: string }> | undefined) ??
      [];
    if (docs.length === 0) {
      // Belt-and-braces: runAiOnWorklist / retryAllErroredCharts already skip
      // no-docs charts before marking them awaiting, so this only fires if a
      // chart was hand-edited or its docs were deleted post-mark. Either way,
      // mark it Errored so the reconciler doesn't loop on it forever.
      await this.markChartGatewayError(chartId, 'No documents to dispatch.');
      return false;
    }

    const inbound: InboundFile[] = [];
    for (const d of docs) {
      // Legacy uploads predate the `key` field — recover it from the URL the
      // same way ChartsService.docKey() does for per-chart reprocess. Without
      // this fallback `storage.download(undefined)` throws an AWS SDK error
      // ("No value provided for input HTTP label: Key.") which my classifier
      // marks as a permanent gateway error — even though the gateway never got
      // called and the real issue is just a missing field on this row.
      const key = d.key ?? (d.url ? this.storage.keyFromUrl(d.url) : null);
      if (!key) {
        throw new Error(
          `Cannot locate stored file for "${d.filename}" (no key and URL doesn't match this store).`,
        );
      }
      const buf = await this.storage.download(key);
      const reportType: ReportType = this.aiPredictor.mapReportType(undefined, d.filename);
      inbound.push({
        buffer: buf,
        filename: d.filename,
        mimeType: d.mimeType ?? 'application/octet-stream',
        reportType,
      });
    }
    const start = await this.aiPredictor.startEncounter(inbound, {
      mrn: c.mrNumber,
      encounterDate: c.dos ?? c.admitDate,
      facility: this.optionalString(c.customFields?.facility),
      department: this.optionalString(c.customFields?.specialty),
      // The chart's primary speciality (from its worklist) — forwarded as
      // `primary_speciality` so the gateway can apply speciality-tuned RAG.
      primarySpeciality: this.optionalString(c.worklist?.primarySpeciality?.name),
    });

    // Re-read so we don't stomp concurrent edits (e.g. user clearing the queue
    // between the find above and the save below).
    const fresh = await this.charts.findOne({ where: { id: chartId } });
    if (!fresh) return true;
    const stillPending = (fresh.customFields ?? {}) as Record<string, unknown>;
    if (!(stillPending.pendingPrediction as { awaitingDispatch?: boolean } | undefined)?.awaitingDispatch) {
      // User cleared the queue mid-dispatch; abandon the gateway run.
      this.log.warn(`Chart ${chartId} cleared mid-dispatch; orphaning encounter ${start.encounterId}.`);
      return false;
    }

    const updatedDocs = docs.map((d, i) => ({ ...d, reportId: start.reportIds[i] }));
    const { aiPredictionError: _drop, ...keepCustom } = stillPending;
    fresh.customFields = {
      ...keepCustom,
      uploadedDocs: updatedDocs,
      pendingPrediction: {
        encounterId: start.encounterId,
        taskId: start.taskId,
        reportIds: start.reportIds,
        startedAt: new Date().toISOString(),
        gatewayStatus: 'PENDING',
      },
    };
    await this.charts.save(fresh);
    return true;
  }

  private async markChartGatewayError(chartId: number, message: string): Promise<void> {
    const c = await this.charts.findOne({ where: { id: chartId } });
    if (!c) return;
    const { pendingPrediction: _drop, ...keep } = (c.customFields ?? {}) as Record<string, unknown>;
    c.customFields = {
      ...keep,
      aiPredictionError: {
        error: message,
        failedAt: new Date().toISOString(),
        source: 'bulk-queue',
      },
    };
    await this.charts.save(c);
  }

  /**
   * Wipe `pendingPrediction` from every chart in the worklist that has one
   * (and `aiPredictionError` if present). Used when an upstream gateway hangs
   * and leaves charts permanently "Queued" / "Processing" — clearing puts
   * them back to "Not started" so the team lead can re-trigger.
   *
   * Note: this does not cancel anything on the gateway. If a run actually
   * succeeds later, the finalize step will fail to find a pending record and
   * the chart stays clear — that's the intended trade-off for a manual reset.
   */
  async clearStuckAiRuns(worklistId: number): Promise<ClearStuckAiResult> {
    await this.ensureWorklist(worklistId);

    // The DB is the queue: wiping `pendingPrediction` is enough — the next
    // reconciler tick will see no `awaitingDispatch=true` rows and not try to
    // dispatch anything. A dispatch already in flight for one of these charts
    // (between startEncounter and save) re-reads the chart and aborts when it
    // finds the flag gone, so we don't write a stale encounterId back.
    const charts = await this.charts.find({ where: { worklistId } });
    const cleared: string[] = [];
    for (const c of charts) {
      const cf = (c.customFields ?? {}) as Record<string, unknown>;
      if (!cf.pendingPrediction && !cf.aiPredictionError) continue;
      const { pendingPrediction: _drop, aiPredictionError: _drop2, ...keep } = cf;
      c.customFields = keep;
      cleared.push(String(c.id));
    }
    if (cleared.length > 0) await this.charts.save(charts.filter((c) => cleared.includes(String(c.id))));
    return { cleared: cleared.length, chartIds: cleared };
  }

  /**
   * Re-queue the AI pipeline for EVERY errored chart system-wide, in one shot.
   * "Errored" mirrors charts.summary / deriveAiStatus: an `aiPredictionError`
   * with no in-flight `pendingPrediction`. Soft-deleted charts (handled by the
   * query builder's default `deleted_at IS NULL`) and charts orphaned by a
   * soft-deleted worklist are excluded — we never resurrect gateway work for a
   * worklist that 404s. Each eligible chart is cleared of its error and marked
   * `awaitingDispatch: true`; the reconciler picks them up on its next tick
   * (one per worklist at a time) and `AiPipelineWatcher` finalizes each run.
   */
  async retryAllErroredCharts(): Promise<RetryErroredResult> {
    const errored = await this.charts
      .createQueryBuilder('c')
      .where(`NOT (c.custom_fields ? 'pendingPrediction')`)
      .andWhere(`c.custom_fields ? 'aiPredictionError'`)
      // Exclude orphans: charts whose worklist was soft-deleted. The worklist
      // 404s, so it shouldn't keep consuming AI gateway runs.
      .andWhere(
        `EXISTS (SELECT 1 FROM worklists w WHERE w.id = c.worklist_id AND w.deleted_at IS NULL)`,
      )
      .getMany();

    const now = new Date().toISOString();
    const skipped: RetryErroredResult['skipped'] = [];
    const toSave: Chart[] = [];

    for (const c of errored) {
      const cf = (c.customFields ?? {}) as Record<string, unknown>;
      const docs = (cf.uploadedDocs as Array<{ key?: string }> | undefined) ?? [];
      if (docs.length === 0) {
        skipped.push({ chartId: String(c.id), reason: 'no_documents' });
        continue;
      }
      const { aiPredictionError: _drop, ...keep } = cf;
      c.customFields = {
        ...keep,
        pendingPrediction: {
          encounterId: '',
          taskId: '',
          reportIds: [],
          startedAt: now,
          gatewayStatus: 'PENDING',
          awaitingDispatch: true,
        },
      };
      toSave.push(c);
    }

    if (toSave.length > 0) await this.charts.save(toSave);
    // Same pattern as runAiOnWorklist: the DB is the queue, kick the reconciler
    // once so the first dispatches start within ms rather than waiting a tick.
    if (toSave.length > 0) void this.reconcileTick().catch(() => undefined);

    return { queued: toSave.length, skipped };
  }

  /** Trim a JSON value to a non-empty string, or undefined. */
  private optionalString(v: unknown): string | undefined {
    if (typeof v !== 'string') return undefined;
    const s = v.trim();
    return s.length === 0 ? undefined : s;
  }

  /* ── Template builder (xlsx download) ──────────────────── */
  async buildTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Charts');
    ws.columns = REQUIRED_COLUMNS.map((h) => ({ header: h, key: h, width: 22 }));
    ws.getRow(1).font = { bold: true };
    ws.addRow({ 'A/C': 'V00004965114', MRN: 'M000108961', DOS: '2/15/2026', ADM: '2/15/2026', DSC: '2/15/2026' });
    ws.addRow({ 'A/C': 'V00004965157', MRN: 'M000108906', DOS: '2/15/2026', ADM: '2/15/2026', DSC: '2/16/2026' });
    const out = (await wb.xlsx.writeBuffer()) as ArrayBuffer | Buffer;
    return Buffer.isBuffer(out) ? out : Buffer.from(out);
  }

  /* ── Internals ─────────────────────────────────────────── */
  private async ensureWorklist(id: number): Promise<Worklist> {
    const w = await this.worklists.findOne({ where: { id } });
    if (!w) throw new NotFoundException({ error: { code: 'not_found', message: 'Worklist not found.' } });
    return w;
  }

  private async parseExcel(file: Express.Multer.File): Promise<{
    rows: ParsedRow[];
    headerErrors: Array<{ row: number; field?: string; message: string }>;
  }> {
    const wb = new ExcelJS.Workbook();
    try {
      // `Buffer` is structurally compatible with the ArrayBuffer ExcelJS expects;
      // the cast satisfies the @types/node v22 generic-Buffer narrowing.
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch (err) {
      return {
        rows: [],
        headerErrors: [{ row: 0, message: `Could not parse Excel file: ${(err as Error).message}` }],
      };
    }
    const ws = wb.worksheets[0];
    if (!ws) return { rows: [], headerErrors: [{ row: 0, message: 'Workbook is empty.' }] };

    // Headers in row 1, values normalized.
    const headerRow = ws.getRow(1);
    const colIndex: Partial<Record<(typeof REQUIRED_COLUMNS)[number], number>> = {};
    headerRow.eachCell((cell, col) => {
      const raw = String(cell.value ?? '').trim().toUpperCase();
      for (const h of REQUIRED_COLUMNS) {
        if (raw === h.toUpperCase()) colIndex[h] = col;
      }
    });
    const missing = REQUIRED_COLUMNS.filter((h) => !colIndex[h]);
    if (missing.length > 0) {
      return {
        rows: [],
        headerErrors: [
          {
            row: 1,
            message: `Missing required column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}. Headers must be: ${REQUIRED_COLUMNS.join(', ')}.`,
          },
        ],
      };
    }

    const rows: ParsedRow[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (!row.hasValues) continue;
      const chartNo = this.cellString(row.getCell(colIndex['A/C']!));
      const mrn = this.cellString(row.getCell(colIndex['MRN']!));
      const dos = this.cellDate(row.getCell(colIndex['DOS']!));
      const adm = this.cellDate(row.getCell(colIndex['ADM']!));
      const dsc = this.cellDate(row.getCell(colIndex['DSC']!));

      // Trim blank rows that hold only formatting.
      if (!chartNo && !mrn && !dos.value && !adm.value && !dsc.value) continue;

      const errors: string[] = [];
      if (!chartNo) errors.push('A/C is required.');
      else if (chartNo.length > 64) errors.push('A/C must be 64 characters or fewer.');
      if (!mrn) errors.push('MRN is required.');
      else if (mrn.length > 64) errors.push('MRN must be 64 characters or fewer.');
      if (!dos.value) errors.push(`DOS is required (got "${dos.raw}").`);
      if (!adm.value) errors.push(`ADM is required (got "${adm.raw}").`);
      if (!dsc.value) errors.push(`DSC is required (got "${dsc.raw}").`);

      rows.push({
        row: r,
        chartNo,
        mrNumber: mrn,
        dos: dos.value ?? '',
        admitDate: adm.value ?? '',
        dischargeDate: dsc.value ?? '',
        errors,
      });
    }
    return { rows, headerErrors: [] };
  }

  private cellString(cell: ExcelJS.Cell): string {
    const v = cell.value;
    if (v == null) return '';
    if (typeof v === 'object' && 'text' in v) return String((v as { text: string }).text).trim();
    return String(v).trim();
  }

  /**
   * Parse a cell into ISO `YYYY-MM-DD`. Accepts Excel Date values, ISO strings,
   * and `M/D/YYYY` / `MM-DD-YYYY` strings (the format used by upstream hospital
   * exports). Returns `{ value: null, raw }` when the cell is unparseable so the
   * caller can quote the original input back to the user.
   */
  private cellDate(cell: ExcelJS.Cell): { value: string | null; raw: string } {
    const v = cell.value;
    if (v == null) return { value: null, raw: '' };
    if (v instanceof Date) return { value: v.toISOString().slice(0, 10), raw: v.toISOString() };
    const s = String(v).trim();
    if (!s) return { value: null, raw: '' };
    // M/D/YYYY or MM-DD-YYYY
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      let [, mm, dd, yyyy] = m;
      if (yyyy.length === 2) yyyy = `20${yyyy}`;
      const d = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T00:00:00Z`);
      if (!isNaN(d.getTime())) return { value: d.toISOString().slice(0, 10), raw: s };
    }
    // ISO YYYY-MM-DD
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return { value: s, raw: s };
    return { value: null, raw: s };
  }

  /** Split a filename into matcher tokens. e.g. "V001_HP.pdf" → ["V001", "HP", "pdf"]. */
  private tokenize(filename: string): string[] {
    return filename
      .split(/[\s._\-()]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }

  private isZip(f: Express.Multer.File): boolean {
    if (f.mimetype === 'application/zip' || f.mimetype === 'application/x-zip-compressed') return true;
    return /\.zip$/i.test(f.originalname);
  }

  /** Whitelist of clinical-document extensions — used to filter ZIP entries. */
  private isDocumentType(filename: string): boolean {
    const ext = filename.toLowerCase().split('.').pop() ?? '';
    return ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'txt'].includes(ext);
  }

  private guessMime(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop() ?? '';
    const map: Record<string, string> = {
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      tif: 'image/tiff',
      tiff: 'image/tiff',
      txt: 'text/plain',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      doc: 'application/msword',
    };
    return map[ext] ?? 'application/octet-stream';
  }

  /**
   * Upload one file to S3 and append it to the chart's customFields.uploadedDocs
   * array (same shape the per-chart upload endpoint writes). Returns the S3 key.
   */
  private async persistOne(
    chart: Chart,
    file: { filename: string; mimetype: string; buffer: Buffer; size: number },
  ): Promise<string> {
    // Convert Word documents to PDF before storing, so the copy the AI re-send
    // later downloads from S3 is already a PDF the gateway can ingest. Non-Word
    // files are returned unchanged.
    const doc = await this.conversion.toPdf({
      buffer: file.buffer,
      originalname: file.filename,
      mimetype: file.mimetype,
      size: file.size,
    });
    const stored = await this.storage.upload(
      {
        buffer: doc.buffer,
        originalname: doc.originalname,
        mimetype: doc.mimetype,
        size: doc.size,
      },
      chart.id,
    );
    const existing = (chart.customFields?.uploadedDocs as Array<Record<string, unknown>> | undefined) ?? [];
    chart.customFields = {
      ...(chart.customFields ?? {}),
      uploadedDocs: [
        ...existing,
        {
          key: stored.key,
          url: stored.url,
          bucket: stored.bucket,
          filename: stored.filename,
          mimeType: stored.mimeType,
          size: stored.size,
          uploadedAt: new Date().toISOString(),
          source: 'bulk-upload',
        },
      ],
    };
    await this.charts.save(chart);
    return stored.key;
  }
}
