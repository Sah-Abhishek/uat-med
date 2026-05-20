import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import AdmZip = require('adm-zip');

import { Chart } from '../../entities/chart.entity';
import { Worklist } from '../../entities/worklist.entity';
import { ChartMilestone, ChartStatus, Priority } from '../../common/enums';
import { DocumentStorageService } from '../charts/document-storage.service';
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

interface WorklistAiQueueState {
  /** Chart IDs awaiting dispatch (FIFO). */
  pending: number[];
  /** True while runWorker is in its dispatch loop. */
  running: boolean;
  /** Set by clearStuckAiRuns; the worker checks this between dispatches. */
  abort: boolean;
}

/** Wall-clock ceiling for waiting on a single chart's gateway run. */
const WORKER_WAIT_MAX_MS = 30 * 60 * 1000;
/** Poll cadence while the worker waits for the previous chart to settle. */
const WORKER_POLL_MS = 5_000;

@Injectable()
export class WorklistBulkService {
  private readonly log = new Logger(WorklistBulkService.name);
  /**
   * In-memory per-worklist AI dispatch queue. Single-instance only — multi-
   * instance prod would need Redis, but the rest of the app keeps similar
   * state in memory (active timers, column prefs), so this matches.
   */
  private readonly aiQueues = new Map<number, WorklistAiQueueState>();

  constructor(
    @InjectRepository(Chart) private readonly charts: Repository<Chart>,
    @InjectRepository(Worklist) private readonly worklists: Repository<Worklist>,
    private readonly ds: DataSource,
    private readonly storage: DocumentStorageService,
    private readonly aiPredictor: AiPredictorService,
  ) {}

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

    // Enqueue + ensure a worker is running.
    const state = this.aiQueues.get(worklistId) ?? { pending: [], running: false, abort: false };
    state.pending.push(...eligible.map((c) => c.id));
    state.abort = false;
    this.aiQueues.set(worklistId, state);

    if (!state.running) {
      state.running = true;
      // Fire-and-forget: the HTTP response returns immediately.
      setImmediate(() => {
        this.runAiQueueWorker(worklistId).catch((err) => {
          this.log.error(`AI queue worker (worklist ${worklistId}) crashed: ${(err as Error).message}`);
          const s = this.aiQueues.get(worklistId);
          if (s) s.running = false;
        });
      });
    }

    return {
      eligible: eligible.length,
      triggered: eligible.length,
      skipped,
    };
  }

  /** Per-worklist background worker. Dispatches one chart at a time. */
  private async runAiQueueWorker(worklistId: number): Promise<void> {
    const state = this.aiQueues.get(worklistId);
    if (!state) return;
    try {
      while (state.pending.length > 0 && !state.abort) {
        const chartId = state.pending.shift()!;
        try {
          const dispatched = await this.dispatchOneChartToGateway(chartId);
          // Wait for the watcher to finalize this chart (or for it to fail)
          // before pulling the next one off the queue. This is what makes the
          // dispatch truly serial — the gateway never sees a second start
          // until the first has settled.
          if (dispatched) await this.waitForChartCompletion(chartId);
        } catch (err) {
          this.log.error(`AI queue: chart ${chartId} failed: ${(err as Error).message}`);
          await this.markChartGatewayError(chartId, (err as Error).message);
        }
      }
    } finally {
      state.running = false;
      // Drop the entry once it's empty so a future run starts fresh.
      if (state.pending.length === 0) this.aiQueues.delete(worklistId);
    }
  }

  private async dispatchOneChartToGateway(chartId: number): Promise<boolean> {
    const c = await this.charts.findOne({ where: { id: chartId } });
    if (!c) return false;
    const cf = (c.customFields ?? {}) as Record<string, unknown>;
    const pending = cf.pendingPrediction as { awaitingDispatch?: boolean } | undefined;
    // The user may have hit "Clear stuck queue" while this chart was still in
    // line — its pendingPrediction will be gone. Skip silently.
    if (!pending?.awaitingDispatch) return false;

    const docs = (cf.uploadedDocs as Array<{ key: string; filename: string; mimeType?: string }> | undefined) ?? [];
    if (docs.length === 0) return false;

    const inbound: InboundFile[] = [];
    for (const d of docs) {
      const buf = await this.storage.download(d.key);
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

  /** Block until the chart's pendingPrediction is gone, or the cap is hit. */
  private async waitForChartCompletion(chartId: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < WORKER_WAIT_MAX_MS) {
      await new Promise((r) => setTimeout(r, WORKER_POLL_MS));
      const c = await this.charts.findOne({ where: { id: chartId } });
      if (!c) return;
      const cf = (c.customFields ?? {}) as Record<string, unknown>;
      // Done = pendingPrediction removed (watcher finalized it) OR an error
      // was recorded. Either way, the chart is settled and we can move on.
      if (!cf.pendingPrediction || cf.aiPredictionError) return;
    }
    this.log.warn(`AI queue: chart ${chartId} did not settle within ${WORKER_WAIT_MAX_MS}ms; advancing anyway.`);
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

    // Tell any running dispatch worker to stop and drop everything still in
    // line. The worker checks `abort` between dispatches and won't pick up
    // the next chart even if we've already pushed it.
    const state = this.aiQueues.get(worklistId);
    if (state) {
      state.abort = true;
      state.pending = [];
    }

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
    const stored = await this.storage.upload(
      {
        buffer: file.buffer,
        originalname: file.filename,
        mimetype: file.mimetype,
        size: file.size,
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
