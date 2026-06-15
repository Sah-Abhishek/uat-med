import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, QueryFailedError, Repository, SelectQueryBuilder } from 'typeorm';
import { Chart } from '../../entities/chart.entity';
import { ChartAllocation } from '../../entities/chart-allocation.entity';
import { ChartFeedback } from '../../entities/chart-feedback.entity';
import { ChartCodeDecision } from '../../entities/chart-code-decision.entity';
import { ChartCodeDecisionDraft } from '../../entities/chart-code-decision-draft.entity';
import { ChartTimeLog, type ChartTimerKind } from '../../entities/chart-time-log.entity';
import { CodeReviewReason } from '../../entities/code-review-reason.entity';
import { Worklist } from '../../entities/worklist.entity';
import { User } from '../../entities/user.entity';
import { ChartMilestone, ChartStatus, CodeReviewAction, CodeReviewDecision, Priority, UserStatus } from '../../common/enums';
import { SaveCodeDecisionDraftDto, SubmitCodeDecisionsDto } from './dto/code-decisions.dto';
import { AiGatewayClient, type ReviewActionPayload } from '../ai-gateway/ai-gateway.service';
import { Role } from '../../common/enums/roles.enum';
import { AuthenticatedUser } from '../../common/types/request-user.type';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { AiStatusFilter, QueryChartsDto } from './dto/query-charts.dto';
import { UpdateChartDto } from './dto/update-chart.dto';
import { BulkModifyDto } from './dto/bulk-modify.dto';
import { ChartFeedbackDto, UpdateFeedbackDto } from './dto/chart-feedback.dto';
import { ProcessDocumentsDto } from './dto/process-documents.dto';
import {
  AiPredictorService,
  EncounterStatus,
  InboundFile,
  ReportType,
  UploadedDocument,
} from './ai-predictor.service';
import { DocumentStorageService } from './document-storage.service';
import { DocumentConversionService } from './document-conversion.service';

/** Allowed milestone transitions (see §21.2 of the spec). */
const TRANSITIONS: Record<ChartMilestone, ChartMilestone[]> = {
  [ChartMilestone.READY_TO_ALLOCATE]:   [ChartMilestone.READY_TO_CODE],
  [ChartMilestone.READY_TO_CODE]:       [ChartMilestone.CODING_IN_PROGRESS],
  [ChartMilestone.CODING_IN_PROGRESS]:  [ChartMilestone.CODING_DONE, ChartMilestone.READY_TO_CODE],
  [ChartMilestone.CODING_DONE]:         [ChartMilestone.READY_TO_AUDIT],
  [ChartMilestone.READY_TO_AUDIT]:      [ChartMilestone.AUDIT_IN_PROGRESS],
  [ChartMilestone.AUDIT_IN_PROGRESS]:   [ChartMilestone.AUDIT_DONE, ChartMilestone.READY_TO_CODE],
  [ChartMilestone.AUDIT_DONE]:          [ChartMilestone.CLOSED],
  [ChartMilestone.CLOSED]:              [],
};

/**
 * customFields keys owned by the AI pipeline — written only by the
 * process/finalize/upload/remove/watcher/bulk endpoints, never by the
 * chart-edit form. update() strips them from incoming payloads: a Save from
 * a tab opened before a pipeline state change would otherwise merge back a
 * stale snapshot — resurrecting a cleared aiPredictionError or
 * pendingPrediction, or clobbering uploadedDocs (see docs/handoff.md).
 */
const RESERVED_PIPELINE_KEYS = ['aiPrediction', 'aiPredictionError', 'pendingPrediction', 'uploadedDocs'] as const;

// Simple in-memory column preferences keyed by userId. A real impl would persist in Redis or `user_preferences`.
const columnPrefs = new Map<number, Array<{ key: string; visible: boolean }>>();

/** Milliseconds the AI document pipeline spent — from the pending marker's
 * `startedAt` to completion. Returns null when the start time is missing or
 * unparseable (e.g. a run that was already in flight before timing was added). */
export function aiProcessingMs(startedAtIso: string | undefined | null, completedAt: Date): number | null {
  if (!startedAtIso) return null;
  const start = Date.parse(startedAtIso);
  if (!Number.isFinite(start)) return null;
  const ms = completedAt.getTime() - start;
  return ms >= 0 ? ms : null;
}

@Injectable()
export class ChartsService {
  /**
   * Whitelist of client-facing sort keys → TypeORM property paths (alias.prop,
   * resolved to real columns at SQL build time). Keys mirror the `sortKey`s the
   * Charts table header sends. Anything not here falls back to newest-first, so
   * the raw `sortBy` string never reaches SQL — closing the injection hole the
   * old `c.${sortBy}` interpolation left open, and letting us sort by joined
   * columns (client/location/worklist) which `c.${sortBy}` could never reach.
   */
  private static readonly SORT_COLUMNS: Record<string, string> = {
    worklistNumber: 'worklist.worklistNumber',
    serialNo: 'c.serialNo',
    client: 'client.name',
    location: 'location.name',
    specialty: 'primarySpeciality.name',
    chartNo: 'c.chartNo',
    dateOfService: 'c.dos',
    chartStatus: 'c.chartStatus',
    milestone: 'c.milestone',
    process: 'process.name',
    receivedDate: 'worklist.receivedDate',
    priority: 'c.priority',
  };

  /**
   * Apply the requested column sort to the charts query.
   *
   * S. No. is a *per-worklist* serial, so sorting it as a flat column is
   * meaningless across worklists — we keep worklists grouped together (always
   * alphabetical) and flip only the inner serial with the chosen direction.
   * Every other column maps through {@link SORT_COLUMNS}; an unknown/absent key
   * preserves the historical newest-first default. A unique `c.id` tiebreaker
   * keeps pagination deterministic when the sort column has ties.
   */
  private applySort(
    qb: SelectQueryBuilder<Chart>,
    sortBy: string | undefined,
    sortDir: 'asc' | 'desc',
  ): void {
    const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
    if (sortBy === 'serialNo') {
      qb.orderBy('worklist.worklistNumber', 'ASC')
        .addOrderBy('c.serialNo', dir)
        .addOrderBy('c.id', 'ASC');
      return;
    }
    const col = sortBy ? ChartsService.SORT_COLUMNS[sortBy] : undefined;
    if (!col) {
      qb.orderBy('c.createdAt', 'DESC').addOrderBy('c.id', 'DESC');
      return;
    }
    qb.orderBy(col, dir).addOrderBy('c.id', 'ASC');
  }

  constructor(
    @InjectRepository(Chart) private readonly charts: Repository<Chart>,
    @InjectRepository(ChartAllocation) private readonly allocations: Repository<ChartAllocation>,
    @InjectRepository(ChartFeedback) private readonly feedbacks: Repository<ChartFeedback>,
    @InjectRepository(ChartCodeDecision) private readonly codeDecisions: Repository<ChartCodeDecision>,
    @InjectRepository(ChartCodeDecisionDraft) private readonly decisionDrafts: Repository<ChartCodeDecisionDraft>,
    @InjectRepository(ChartTimeLog) private readonly timeLogs: Repository<ChartTimeLog>,
    @InjectRepository(CodeReviewReason) private readonly codeReviewReasons: Repository<CodeReviewReason>,
    @InjectRepository(Worklist) private readonly worklists: Repository<Worklist>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly aiPredictor: AiPredictorService,
    private readonly storage: DocumentStorageService,
    private readonly conversion: DocumentConversionService,
    private readonly aiGateway: AiGatewayClient,
    private readonly config: ConfigService,
  ) {}

  /** Read the encounter ID we previously persisted from the AI pipeline,
   * stored in chart.customFields.aiPrediction.encounterId. Returns null if
   * the chart was never processed. */
  private extractEncounterId(chart: Chart): string | null {
    const cf = (chart.customFields ?? {}) as Record<string, any>;
    const eid = cf?.aiPrediction?.encounterId;
    return typeof eid === 'string' && eid.trim() ? eid : null;
  }

  async list(q: QueryChartsDto, user: AuthenticatedUser) {
    const qb = this.charts.createQueryBuilder('c')
      .leftJoinAndSelect('c.worklist', 'worklist')
      .leftJoinAndSelect('worklist.client', 'client')
      .leftJoinAndSelect('worklist.location', 'location')
      .leftJoinAndSelect('worklist.primarySpeciality', 'primarySpeciality')
      .leftJoinAndSelect('worklist.process', 'process')
      .leftJoinAndSelect('c.serviceLine', 'serviceLine');

    // Role-scoped visibility: coders / auditors see only their own queue.
    if (user.role === Role.CODER) qb.andWhere('c.allocated_coder_id = :uid', { uid: user.id });
    if (user.role === Role.AUDITOR) qb.andWhere('c.allocated_auditor_id = :uid', { uid: user.id });

    // Hide charts orphaned by a soft-deleted worklist (see helper).
    this.excludeOrphanedCharts(qb);

    if (q.priority) qb.andWhere('c.priority = :p', { p: q.priority });
    if (q.worklistId) qb.andWhere('c.worklist_id = :w', { w: q.worklistId });
    if (q.serialFrom) qb.andWhere('c.serial_no >= :sf', { sf: q.serialFrom });
    if (q.serialTo) qb.andWhere('c.serial_no <= :st', { st: q.serialTo });
    if (q.chartNo) qb.andWhere('c.chart_no ILIKE :cn', { cn: `%${q.chartNo}%` });
    if (q.chartStatus) qb.andWhere('c.chart_status = :cs', { cs: q.chartStatus });
    if (q.milestone) qb.andWhere('c.milestone = :m', { m: q.milestone });
    if (q.allocatedUserId) qb.andWhere('(c.allocated_coder_id = :au OR c.allocated_auditor_id = :au)', { au: q.allocatedUserId });
    if (q.primarySpecialityId) qb.andWhere('worklist.primary_speciality_id = :ps', { ps: q.primarySpecialityId });
    // Global header scope (Client / Location). The worklist is already joined.
    if (q.clientId) qb.andWhere('worklist.client_id = :cid', { cid: q.clientId });
    if (q.locationId) qb.andWhere('worklist.location_id = :lid', { lid: q.locationId });
    // Narrow to a single AI-pipeline state (e.g. ERRORED) using the same
    // custom_fields predicates that drive the AI summary tiles.
    if (q.aiStatus) this.applyAiStatusFilter(qb, q.aiStatus);
    if (q.receivedDateFrom) qb.andWhere('worklist.received_date >= :rdf', { rdf: q.receivedDateFrom });
    if (q.receivedDateTo) qb.andWhere('worklist.received_date <= :rdt', { rdt: q.receivedDateTo });

    this.applySort(qb, q.sortBy, q.sortDir);
    qb.skip((q.page - 1) * q.pageSize).take(q.pageSize);

    const [items, total] = await qb.getManyAndCount();

    // Batch-resolve user names for the four user FKs the table can show.
    const userIds = new Set<number>();
    for (const c of items) {
      if (c.allocatedCoderId) userIds.add(Number(c.allocatedCoderId));
      if (c.allocatedAuditorId) userIds.add(Number(c.allocatedAuditorId));
      if (c.originalCoderId) userIds.add(Number(c.originalCoderId));
      if (c.originalAuditorId) userIds.add(Number(c.originalAuditorId));
    }
    const userMap = new Map<number, string>();
    if (userIds.size > 0) {
      const users = await this.users.find({
        where: { id: In([...userIds]) },
        select: ['id', 'fullName'],
      });
      for (const u of users) userMap.set(Number(u.id), u.fullName);
    }

    // Batch-fetch earliest CODER/AUDITOR allocation timestamps per chart so the
    // "Date of Coder/Auditor Allocation" columns can render the first handoff.
    const chartIds = items.map(c => Number(c.id));
    const allocRows: Array<{ chart_id: string; role: 'CODER' | 'AUDITOR'; first_at: Date }> =
      chartIds.length === 0
        ? []
        : await this.allocations
            .createQueryBuilder('a')
            .select('a.chart_id', 'chart_id')
            .addSelect('a.role', 'role')
            .addSelect('MIN(a.allocated_at)', 'first_at')
            .where('a.chart_id IN (:...ids)', { ids: chartIds })
            .groupBy('a.chart_id')
            .addGroupBy('a.role')
            .getRawMany();
    const allocByChart = new Map<number, { coderAt?: string; auditorAt?: string }>();
    for (const r of allocRows) {
      const cid = Number(r.chart_id);
      const entry = allocByChart.get(cid) ?? {};
      const iso = r.first_at instanceof Date ? r.first_at.toISOString() : String(r.first_at);
      if (r.role === 'CODER') entry.coderAt = iso;
      if (r.role === 'AUDITOR') entry.auditorAt = iso;
      allocByChart.set(cid, entry);
    }

    const mapped = items.map(({ worklist, serviceLine, ...rest }) => {
      const cf = (rest.customFields ?? {}) as Record<string, any>;
      const alloc = allocByChart.get(Number(rest.id)) ?? {};
      return {
        ...rest,
        // Map the `dos` column to the `dateOfService` key the frontend reads.
        dateOfService: rest.dos ?? null,
        // serviceLineId travels in `...rest`; surface the resolved name for display.
        serviceLineName: serviceLine?.name ?? null,
        worklistNumber: worklist?.worklistNumber ?? null,
        clientName: worklist?.client?.name ?? null,
        locationName: worklist?.location?.name ?? null,
        specialityName: worklist?.primarySpeciality?.name ?? null,
        processName: worklist?.process?.name ?? null,
        receivedDate: worklist?.receivedDate ?? null,
        allocatedCoderName: rest.allocatedCoderId ? userMap.get(Number(rest.allocatedCoderId)) ?? null : null,
        allocatedAuditorName: rest.allocatedAuditorId ? userMap.get(Number(rest.allocatedAuditorId)) ?? null : null,
        originalCoderId: rest.originalCoderId ?? null,
        originalAuditorId: rest.originalAuditorId ?? null,
        originalCoderName: rest.originalCoderId ? userMap.get(Number(rest.originalCoderId)) ?? null : null,
        originalAuditorName: rest.originalAuditorId ? userMap.get(Number(rest.originalAuditorId)) ?? null : null,
        coderAllocatedAt: alloc.coderAt ?? null,
        auditorAllocatedAt: alloc.auditorAt ?? null,
        // Pulled from custom_fields where the seed/import populates them. Null
        // when the tenant hasn't promoted these into structured columns yet.
        subSpecialityName: typeof cf.subSpeciality === 'string' ? cf.subSpeciality : null,
        qcStatus: typeof cf.qcStatus === 'string' ? cf.qcStatus : null,
      };
    });
    return new PaginatedResponseDto(mapped, total, q.page, q.pageSize);
  }

  async summary(user: AuthenticatedUser, q: { clientId?: number; locationId?: number } = {}) {
    const qb = this.charts.createQueryBuilder('c');
    if (user.role === Role.CODER) qb.andWhere('c.allocated_coder_id = :uid', { uid: user.id });
    if (user.role === Role.AUDITOR) qb.andWhere('c.allocated_auditor_id = :uid', { uid: user.id });
    // Keep the tiles / tab counts in step with list(): exclude orphaned charts.
    // Applied to the base qb before any clone so every count below inherits it.
    this.excludeOrphanedCharts(qb);
    // Global header scope (Client / Location). summary() doesn't join the
    // worklist by default, so join it here (alias `ws` — `w` is taken by the
    // orphan-guard subquery) only when a scope is set. Chart→worklist is
    // many-to-one, so the join can't inflate the COUNTs below.
    if (q.clientId || q.locationId) {
      qb.innerJoin('worklists', 'ws', 'ws.id = c.worklist_id');
      if (q.clientId) qb.andWhere('ws.client_id = :cid', { cid: Number(q.clientId) });
      if (q.locationId) qb.andWhere('ws.location_id = :lid', { lid: Number(q.locationId) });
    }

    const priorityRows = await qb.clone()
      .select('c.priority', 'priority').addSelect('COUNT(*)', 'count').groupBy('c.priority').getRawMany();
    const milestoneRows = await qb.clone()
      .select('c.milestone', 'milestone').addSelect('COUNT(*)', 'count').groupBy('c.milestone').getRawMany();

    const pc = { critical: 0, high: 0, medium: 0, low: 0, finalized: 0 };
    priorityRows.forEach(r => { pc[String(r.priority).toLowerCase() as keyof typeof pc] = Number(r.count); });

    // Queue tiles (`readyToCode` / `readyToAudit`) are all-time counts of the
    // user's queue. "Done" tiles (`codingDoneToday` / `auditDoneToday`) are
    // explicitly today-scoped — matching the dashboard self() tiles — so the
    // two pages don't disagree on what "Coding Done" means.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const ms = { readyToCode: 0, codingDoneToday: 0, readyToAudit: 0, auditDoneToday: 0 };
    milestoneRows.forEach(r => {
      if (r.milestone === ChartMilestone.READY_TO_CODE) ms.readyToCode = Number(r.count);
      if (r.milestone === ChartMilestone.READY_TO_AUDIT) ms.readyToAudit = Number(r.count);
    });
    ms.codingDoneToday = await qb.clone()
      .andWhere('c.milestone = :m', { m: ChartMilestone.CODING_DONE })
      .andWhere('c.milestone_changed_at >= :t', { t: today })
      .getCount();
    ms.auditDoneToday = await qb.clone()
      .andWhere('c.milestone = :m', { m: ChartMilestone.AUDIT_DONE })
      .andWhere('c.milestone_changed_at >= :t', { t: today })
      .getCount();

    // AI pipeline status counts (mutually exclusive: pending takes precedence
    // over a prior aiPredictionError, which takes precedence over aiPrediction).
    // Charts can hold all three keys after retries, so the WHERE clauses are
    // ordered to avoid double-counting.
    const aiBase = qb.clone();
    const queued = await this.applyAiStatusFilter(aiBase.clone(), AiStatusFilter.QUEUED).getCount();
    const processing = await this.applyAiStatusFilter(aiBase.clone(), AiStatusFilter.PROCESSING).getCount();
    const errored = await this.applyAiStatusFilter(aiBase.clone(), AiStatusFilter.ERRORED).getCount();
    const done = await this.applyAiStatusFilter(aiBase.clone(), AiStatusFilter.DONE).getCount();

    // Today's completed / incomplete count — matches the dashboard self()
    // tiles for the same user, using `chart_status_changed_at` so that bulk
    // touches of `updated_at` (priority bumps, AI prediction writes, etc.)
    // don't inflate the number. Reuses the `today` boundary from above.
    const completeToday = await qb.clone()
      .andWhere('c.chart_status = :cs', { cs: ChartStatus.COMPLETE })
      .andWhere('c.chart_status_changed_at >= :t', { t: today })
      .getCount();
    const incompleteToday = await qb.clone()
      .andWhere('c.chart_status = :cs', { cs: ChartStatus.INCOMPLETE })
      .andWhere('c.chart_status_changed_at >= :t', { t: today })
      .getCount();

    return {
      priorityCounts: pc,
      milestones: ms,
      statusToday: { complete: completeToday, incomplete: incompleteToday },
      aiStatusCounts: { queued, processing, done, errored },
    };
  }

  /**
   * Exclude charts orphaned by a soft-deleted worklist. Soft-removing a
   * worklist only stamps its own `deleted_at` — it does NOT cascade to charts
   * (the FK's ON DELETE CASCADE is DB-level and fires on physical deletes only),
   * so those charts keep `deleted_at IS NULL` and would otherwise stay visible
   * in the list/queue even though GET /worklists/:id 404s for them. Implemented
   * as a correlated EXISTS rather than a join predicate so it's correct even on
   * a LEFT join (where `worklist.deleted_at IS NULL` would wrongly keep orphans)
   * and usable on the summary query, which doesn't join the worklist at all.
   */
  private excludeOrphanedCharts(qb: SelectQueryBuilder<Chart>): SelectQueryBuilder<Chart> {
    return qb.andWhere(
      'EXISTS (SELECT 1 FROM worklists w WHERE w.id = c.worklist_id AND w.deleted_at IS NULL)',
    );
  }

  /**
   * Narrow a chart query to a single AI-pipeline state. The states are derived
   * from `custom_fields` and are mutually exclusive: pending takes precedence
   * (QUEUED/PROCESSING) over a prior aiPredictionError (ERRORED), which takes
   * precedence over a stored aiPrediction (DONE). Shared by `list()` (the AI
   * Status filter) and `summary()` (the AI tile counts) so the two never drift.
   */
  private applyAiStatusFilter(
    qb: SelectQueryBuilder<Chart>,
    status: AiStatusFilter,
  ): SelectQueryBuilder<Chart> {
    switch (status) {
      case AiStatusFilter.QUEUED:
        return qb
          .andWhere(`c.custom_fields ? 'pendingPrediction'`)
          .andWhere(`COALESCE(c.custom_fields->'pendingPrediction'->>'gatewayStatus','PENDING') = 'PENDING'`);
      case AiStatusFilter.PROCESSING:
        return qb
          .andWhere(`c.custom_fields ? 'pendingPrediction'`)
          .andWhere(`c.custom_fields->'pendingPrediction'->>'gatewayStatus' = 'STARTED'`);
      case AiStatusFilter.IN_PROGRESS:
        // Union of QUEUED + PROCESSING — any chart with a pending prediction,
        // matching the donut's "In progress" slice.
        return qb.andWhere(`c.custom_fields ? 'pendingPrediction'`);
      case AiStatusFilter.ERRORED:
        return qb
          .andWhere(`NOT (c.custom_fields ? 'pendingPrediction')`)
          .andWhere(`c.custom_fields ? 'aiPredictionError'`);
      case AiStatusFilter.DONE:
        return qb
          .andWhere(`NOT (c.custom_fields ? 'pendingPrediction')`)
          .andWhere(`NOT (c.custom_fields ? 'aiPredictionError')`)
          .andWhere(`c.custom_fields ? 'aiPrediction'`);
      default:
        return qb;
    }
  }

  async detail(id: number) {
    const c = await this.charts.findOne({ where: { id }, relations: { serviceLine: true } });
    if (!c) throw new NotFoundException();
    // The DB column is `dos`, but the whole frontend (Chart type, list,
    // header, detail seeding) reads `dateOfService`. Surface both so a saved
    // Date of Service survives the refetch instead of reverting to the
    // worklist range start (or blanking out).
    const { serviceLine, ...rest } = c;
    // Total coder/auditor time logged on this chart = sum of completed timer
    // sessions (chart_time_logs). The header adds the live running session on
    // top; here we only have durable, stopped sessions.
    const timeAgg = await this.timeLogs
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.elapsed_ms), 0)', 'sum')
      .where('t.chart_id = :id', { id })
      .getRawOne<{ sum: string }>();
    const coderTimeMs = Number(timeAgg?.sum ?? 0);
    return { ...rest, dateOfService: c.dos ?? null, serviceLineName: serviceLine?.name ?? null, coderTimeMs };
  }

async update(id: number, dto: UpdateChartDto) {
  const c = await this.charts.findOne({ where: { id } });
  if (!c) throw new NotFoundException();

  // Track who the chart was allocated to *as part of this save*, so we can
  // distinguish "save with handoff" from "save without handoff".
  const allocatingCoder = dto.allocatedCoderId !== undefined && dto.allocatedCoderId !== null;
  const allocatingAuditor = dto.allocatedAuditorId !== undefined && dto.allocatedAuditorId !== null;
  const allocatingSomeone = allocatingCoder || allocatingAuditor;

  // Merge customFields rather than overwrite — preserves other keys.
  // chartStatus is funnelled through setChartStatus() so we can stamp the
  // status-change timestamp; everything else can be plain-assigned.
  const { customFields, chartStatus: nextStatus, ...flat } = dto;
  Object.assign(c, flat);
  if (customFields) {
    // Pipeline-owned keys never come from the edit form — drop them so a
    // stale FE snapshot can't overwrite newer pipeline state.
    for (const k of RESERVED_PIPELINE_KEYS) delete (customFields as Record<string, unknown>)[k];
    c.customFields = { ...(c.customFields ?? {}), ...customFields };
  }
  if (nextStatus !== undefined) {
    c.setChartStatus(nextStatus);
  }

  // Milestone transitions driven by save (per workflow spec):
  //   CODING_IN_PROGRESS + allocation set            → stays CODING_IN_PROGRESS (handoff)
  //   CODING_IN_PROGRESS + no allocation             → CODING_DONE
  //   AUDIT_IN_PROGRESS  + allocation set            → stays AUDIT_IN_PROGRESS (handoff)
  //   AUDIT_IN_PROGRESS  + no allocation             → AUDIT_DONE
  //   CODING_DONE        + auditor allocated         → READY_TO_AUDIT
  if (c.milestone === ChartMilestone.CODING_IN_PROGRESS && !allocatingSomeone) {
    c.setMilestone(ChartMilestone.CODING_DONE);
  } else if (c.milestone === ChartMilestone.AUDIT_IN_PROGRESS && !allocatingSomeone) {
    c.setMilestone(ChartMilestone.AUDIT_DONE);
  }

  if (c.milestone === ChartMilestone.CODING_DONE && allocatingAuditor) {
    c.setMilestone(ChartMilestone.READY_TO_AUDIT);
  }

  // When a chart reaches a terminal-ish milestone (coding finished, audit
  // finished, or fully closed) flip its priority to FINALIZED so it surfaces
  // under the "Done" priority tab in the charts list. This keeps active-work
  // tabs (Critical / High / Medium / Low) clean as charts get processed.
  // We only auto-advance to FINALIZED — never auto-revert — so a user who
  // intentionally re-prioritises a finished chart isn't fought by the system.
  if (
    (c.milestone === ChartMilestone.CODING_DONE
      || c.milestone === ChartMilestone.AUDIT_DONE
      || c.milestone === ChartMilestone.CLOSED)
    && c.priority !== Priority.FINALIZED
  ) {
    c.priority = Priority.FINALIZED;
  }

  return this.charts.save(c);
}

  async transition(id: number, body: { milestone: string; chartStatus?: string }) {
    const c = await this.charts.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    const target = body.milestone as ChartMilestone;
    if (!TRANSITIONS[c.milestone]?.includes(target)) {
      throw new BadRequestException({ error: { code: 'bad_request', message: `Transition from ${c.milestone} to ${target} is not allowed.` } });
    }
    c.setMilestone(target);
    if (body.chartStatus) c.setChartStatus(body.chartStatus as ChartStatus);
    await this.charts.save(c);
    return { id: c.id, milestone: c.milestone, chartStatus: c.chartStatus };
  }

  /** Throw the standard "another chart is in progress" 409 for an open session. */
  private async timerConflict(open: ChartTimeLog): Promise<never> {
    const other = await this.charts.findOne({ where: { id: Number(open.chartId) } });
    throw new ConflictException({
      error: {
        code: 'timer_conflict',
        message: 'Another chart is already in progress. Save it before working on this chart.',
        activeChartId: String(open.chartId),
        activeChartNo: other?.chartNo ?? null,
        startedAt: open.startedAt.toISOString(),
      },
    });
  }

  async startTimer(id: number, user: AuthenticatedUser) {
    const c = await this.charts.findOne({ where: { id } });
    if (!c) throw new NotFoundException();

    // Single-active-chart guard, now DB-backed so it survives a restart. A user
    // may have at most one OPEN (stopped_at IS NULL) session at a time.
    const open = await this.timeLogs.findOne({
      where: { userId: user.id, stoppedAt: IsNull() },
    });
    if (open) {
      // Already timing THIS chart → idempotent resume (return the live session
      // so a double-Start or a reload doesn't reset the clock).
      if (Number(open.chartId) === id) {
        return { chartId: id, startedAt: open.startedAt.toISOString() };
      }
      // A different chart is in progress → route the user back to it.
      await this.timerConflict(open);
    }

    // Capacity is derived from the chart's milestone (TEAMLEADs can do either).
    const kind: ChartTimerKind =
      c.milestone === ChartMilestone.READY_TO_AUDIT ||
      c.milestone === ChartMilestone.AUDIT_IN_PROGRESS
        ? 'AUDIT'
        : 'CODING';
    const startedAt = new Date();
    try {
      await this.timeLogs.save(
        this.timeLogs.create({ chartId: id, userId: user.id, kind, startedAt, stoppedAt: null, elapsedMs: null }),
      );
    } catch (err) {
      // Lost a race against a concurrent Start: the partial unique index
      // (one open session per user) rejected the second insert. Re-read the
      // winner and resume-or-conflict against it instead of 500-ing.
      if (err instanceof QueryFailedError && (err as any).code === '23505') {
        const winner = await this.timeLogs.findOne({ where: { userId: user.id, stoppedAt: IsNull() } });
        if (winner && Number(winner.chartId) === id) {
          return { chartId: id, startedAt: winner.startedAt.toISOString() };
        }
        if (winner) await this.timerConflict(winner);
      }
      throw err;
    }

    // Team leads can act in either capacity; the chart's current milestone
    // determines which transition fires.
    const canCode = user.role === Role.CODER || user.role === Role.TEAMLEAD;
    const canAudit = user.role === Role.AUDITOR || user.role === Role.TEAMLEAD;
    if (c.milestone === ChartMilestone.READY_TO_CODE && canCode) {
      c.setMilestone(ChartMilestone.CODING_IN_PROGRESS);
      await this.charts.save(c);
    } else if (c.milestone === ChartMilestone.READY_TO_AUDIT && canAudit) {
      c.setMilestone(ChartMilestone.AUDIT_IN_PROGRESS);
      await this.charts.save(c);
    }
    return { chartId: id, startedAt: startedAt.toISOString() };
  }

  async stopTimer(id: number, user: AuthenticatedUser) {
    const open = await this.timeLogs.findOne({
      where: { userId: user.id, chartId: id, stoppedAt: IsNull() },
    });
    if (!open) {
      throw new BadRequestException({ error: { code: 'bad_request', message: 'No active timer for this user/chart.' } });
    }
    const stoppedAt = new Date();
    const elapsedMs = stoppedAt.getTime() - open.startedAt.getTime();
    open.stoppedAt = stoppedAt;
    open.elapsedMs = elapsedMs;
    await this.timeLogs.save(open);
    return { chartId: id, elapsedMs };
  }

  /**
   * Returns the user's currently running chart, if any. Sourced from the open
   * chart_time_logs session, so a backend restart no longer resets the timer.
   * Used by the charts page (to show a "currently running" card) and by the
   * chart-detail page (to restore the timer on reload).
   */
  async activeTimer(user: AuthenticatedUser) {
    const open = await this.timeLogs.findOne({
      where: { userId: user.id, stoppedAt: IsNull() },
      order: { startedAt: 'DESC' },
    });
    if (!open) return null;

    const chartId = Number(open.chartId);
    const c = await this.charts.findOne({ where: { id: chartId } });
    if (!c) {
      // Orphan (chart gone but FK cascade missed it): close the session so it
      // stops shadowing future Starts, and report no active timer.
      open.stoppedAt = new Date();
      open.elapsedMs = open.stoppedAt.getTime() - open.startedAt.getTime();
      await this.timeLogs.save(open);
      return null;
    }
    return {
      chartId: String(chartId),
      chartNo: c.chartNo ?? null,
      worklistId: String(c.worklistId),
      milestone: c.milestone,
      startedAt: open.startedAt.toISOString(),
      elapsedMs: Date.now() - open.startedAt.getTime(),
    };
  }

  /**
   * Per-user time logged on a chart (coding/audit) for the chart-detail Time
   * Tracker. Each row's totalMs = sum of completed sessions PLUS the live
   * elapsed of any still-running session, so a coder's time ticks up as they
   * work. One row per (user, kind).
   */
  async chartTimeByUser(id: number) {
    const c = await this.charts.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    const rows = await this.dataSource.query(
      `
      SELECT
        t.user_id AS "userId",
        u.full_name AS "userName",
        u.role AS "role",
        t.kind AS "kind",
        COALESCE(SUM(t.elapsed_ms), 0)
          + COALESCE(SUM(CASE WHEN t.stopped_at IS NULL
              THEN EXTRACT(EPOCH FROM (now() - t.started_at)) * 1000 ELSE 0 END), 0) AS "totalMs",
        bool_or(t.stopped_at IS NULL) AS "running",
        COUNT(*)::int AS "sessions",
        MAX(COALESCE(t.stopped_at, now())) AS "lastActiveAt"
      FROM chart_time_logs t
      LEFT JOIN users u ON u.id = t.user_id
      WHERE t.chart_id = $1
      GROUP BY t.user_id, u.full_name, u.role, t.kind
      ORDER BY "totalMs" DESC
      `,
      [id],
    );
    return {
      entries: rows.map((r: any) => ({
        userId: Number(r.userId),
        userName: r.userName ?? null,
        role: r.role ?? null,
        kind: r.kind,
        totalMs: Math.round(Number(r.totalMs)),
        running: r.running === true || r.running === 't',
        sessions: Number(r.sessions),
        lastActiveAt: r.lastActiveAt,
      })),
    };
  }

  async bulkModify(dto: BulkModifyDto) {
    const updatedCharts = await this.charts.findBy({ id: In(dto.chartIds) });
    if (updatedCharts.length === 0) return { updated: 0 };
    for (const c of updatedCharts) {
      if (dto.priority) c.priority = dto.priority as Priority;
      // serviceLineId is explicitly nullable: undefined = leave as-is, null =
      // clear, number = set. So check `!== undefined`, not truthiness.
      if (dto.serviceLineId !== undefined) c.serviceLineId = dto.serviceLineId;
      if (dto.allocation && dto.allocation.action !== 'NONE') {
        if (dto.allocation.action === 'ALLOCATE_CODING' && dto.allocation.assigneeId) c.allocatedCoderId = dto.allocation.assigneeId;
        if (dto.allocation.action === 'ALLOCATE_AUDITING' && dto.allocation.assigneeId) c.allocatedAuditorId = dto.allocation.assigneeId;
        if (dto.allocation.action === 'REALLOCATE_TO_ORIGINAL_CODER') c.allocatedCoderId = c.originalCoderId ?? c.allocatedCoderId;
      }
    }
    await this.charts.save(updatedCharts);
    return { updated: updatedCharts.length };
  }

  async selfAllocate(chartIds: number[], user: AuthenticatedUser) {
    const cs = await this.charts.findBy({ id: In(chartIds) });
    for (const c of cs) {
      if (user.role === Role.CODER) c.allocatedCoderId = user.id;
      else if (user.role === Role.AUDITOR) c.allocatedAuditorId = user.id;
    }
    await this.charts.save(cs);
    return { allocated: cs.length };
  }

  /**
   * Soft-delete the given charts AND clean up the worklist they belong to so
   * the page doesn't show stale totals or serial-number gaps:
   *   1. Soft-delete the rows (deleted_at = now()).
   *   2. Recompute `worklists.total_charts` from the actual row count — the
   *      column was set at creation and never decremented, which is why the
   *      detail card kept showing "12" after deleting 2 of 12.
   *   3. Re-sequence the surviving charts' serial_no to 1..N so the
   *      Allocate / Manage Charts UIs aren't full of holes. The unique
   *      constraint on (worklist_id, serial_no) means we have to bounce
   *      through negative numbers first.
   * All three steps run in one transaction; an early failure rolls back.
   */
  async bulkDelete(chartIds: number[]) {
    if (!chartIds || chartIds.length === 0) return { deleted: 0 };

    return this.dataSource.transaction(async (manager) => {
      const cRepo = manager.getRepository(Chart);
      const wRepo = manager.getRepository(Worklist);

      // Snapshot the worklists touched by this delete so we know which ones
      // need their counter + serials reflowed.
      const affected = await cRepo.find({
        where: { id: In(chartIds) },
        select: ['id', 'worklistId'],
      });
      const affectedWorklistIds = [...new Set(affected.map((c) => Number(c.worklistId)))];

      const result = await cRepo.softDelete(chartIds);

      for (const worklistId of affectedWorklistIds) {
        // Step 1: park every soft-deleted chart in this worklist (including
        // ones from prior delete operations) at a far-negative serial. The
        // (worklist_id, serial_no) unique constraint is not partial — it
        // applies even to deleted_at IS NOT NULL rows — so if we left these
        // sitting at, say, serial_no = 3, the re-sequence below would try
        // to assign 3 to a survivor and Postgres would raise a unique-
        // constraint violation. ROW_NUMBER() guarantees the parked values
        // are unique among themselves; the 1_000_000 offset keeps them well
        // clear of any survivor (worklists never reach that size in
        // practice and survivors only ever reach the row count, not 1M+).
        await manager.query(
          `WITH parked AS (
             SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
               FROM charts
              WHERE worklist_id = $1 AND deleted_at IS NOT NULL
           )
           UPDATE charts SET serial_no = -(1000000 + parked.rn)
             FROM parked
            WHERE charts.id = parked.id`,
          [worklistId],
        );
        // Step 2: bounce surviving charts into negative space too, so we
        // can safely re-issue 1..N without temporarily colliding with their
        // own current positives.
        await manager.query(
          `UPDATE charts
             SET serial_no = -serial_no
           WHERE worklist_id = $1 AND deleted_at IS NULL`,
          [worklistId],
        );
        // Step 3: re-issue 1..N in the original order (smallest old serial
        // first → smallest new serial). We sort DESC over the now-negative
        // numbers because -1 (was 1) is the largest negative; flip the
        // direction so the chart that used to be #1 stays #1 if it survived.
        await manager.query(
          `WITH ranked AS (
             SELECT id, ROW_NUMBER() OVER (ORDER BY serial_no DESC) AS new_serial
               FROM charts
              WHERE worklist_id = $1 AND deleted_at IS NULL
           )
           UPDATE charts SET serial_no = ranked.new_serial
             FROM ranked
            WHERE charts.id = ranked.id`,
          [worklistId],
        );
        // Step 4: refresh the stored counter so it never drifts above the
        // real row count. The list/detail endpoints still take MAX(declared,
        // rowCount), so we need this column to come down on its own.
        const rowCount = await cRepo.count({ where: { worklistId } });
        await wRepo.update({ id: worklistId }, { totalCharts: rowCount });
      }

      return { deleted: result.affected ?? 0 };
    });
  }

  getColumns(userId: number) {
    return { columns: columnPrefs.get(userId) ?? [] };
  }

  saveColumns(userId: number, columns: Array<{ key: string; visible: boolean }>) {
    columnPrefs.set(userId, columns);
    return { columns };
  }

  async listFeedback(chartId: number) {
    return this.feedbacks.find({ where: { chartId }, order: { createdAt: 'DESC' } });
  }

  async addFeedback(chartId: number, dto: ChartFeedbackDto, auditorId: number) {
    const chart = await this.charts.findOne({ where: { id: chartId } });
    if (!chart) throw new NotFoundException();
    const f = await this.feedbacks.save(this.feedbacks.create({ chartId, auditorId, ...dto }));
    return { id: f.id };
  }

  async updateFeedback(feedbackId: number, dto: UpdateFeedbackDto) {
    const f = await this.feedbacks.findOne({ where: { id: feedbackId } });
    if (!f) throw new NotFoundException();
    Object.assign(f, dto);
    return this.feedbacks.save(f);
  }

  /**
   * Phase 1 of the ICD Predictor encounter flow: persist uploads to S3/MinIO,
   * create the gateway encounter, push the files, and trigger the AI run.
   *
   * The long-running AI pipeline (~30–180s) executes asynchronously on the
   * gateway; this call returns as soon as the run is queued so the HTTP
   * request finishes well under any reverse-proxy timeout. The caller polls
   * `/charts/:id/process-documents/:encounterId/status` and, on SUCCESS,
   * calls `/charts/:id/process-documents/:encounterId/finalize` to load the
   * predicted codes.
   */
  async startProcessDocuments(
    id: number,
    files: Express.Multer.File[],
    body: ProcessDocumentsDto,
  ) {
    // Load the service line and the worklist's primary speciality so both names
    // can be forwarded to the AI gateway.
    const c = await this.charts.findOne({
      where: { id },
      relations: { serviceLine: true, worklist: { primarySpeciality: true } },
    });
    if (!c) throw new NotFoundException();

    // Build report_types parallel to files: prefer explicit comma-separated
    // list from FE; fall back to inferring from documentType + filename.
    const explicit = (body.reportTypes ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as ReportType[];

    const reportTypes: ReportType[] = files.map(
      (f, i) => (explicit[i] as ReportType) ?? this.aiPredictor.mapReportType(body.documentType, f.originalname),
    );

    // 0) Convert any Word documents (.doc/.docx) to PDF up front. The ICD
    //    predictor only ingests PDF/image/text, and the inline chart viewer
    //    can't render native Word either, so we normalize once here and use
    //    the result for BOTH storage and the gateway. Non-Word files pass
    //    through untouched; order is preserved so it stays parallel to
    //    reportTypes.
    const pdfFiles = await this.conversion.toPdfMany(
      files.map((f) => ({
        buffer: f.buffer,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
      })),
    );

    // 1) Persist each (converted) upload to S3/MinIO so the chart-detail page
    //    can iframe it later. We do this BEFORE the gateway call so that even
    //    if the AI pipeline fails, the documents are still saved against the
    //    chart.
    const stored = await this.storage.uploadMany(pdfFiles, c.id);

    // 2) Forward the same buffers (in the same order) to the ICD predictor.
    const inbound: InboundFile[] = pdfFiles.map((f, i) => ({
      buffer: f.buffer,
      filename: f.originalname,
      mimeType: f.mimetype,
      reportType: reportTypes[i],
    }));

    const start = await this.aiPredictor.startEncounter(inbound, {
      mrn: c.mrNumber,
      encounterDate: c.dos ?? c.admitDate,
      // facility / department aren't normalized columns yet — pass whatever
      // the chart's customFields exposes so the encounter can be filed
      // against the right cohort in the gateway.
      facility: this.optionalString(c.customFields?.facility),
      department: this.optionalString(c.customFields?.specialty),
      // The chart's primary speciality (from its worklist) — forwarded as
      // `primary_speciality` so the gateway can apply speciality-tuned RAG.
      primarySpeciality: this.optionalString(c.worklist?.primarySpeciality?.name),
      // Deferred: the gateway doesn't accept this yet, so startEncounter ignores
      // it for now. Passed through so it's a one-line flip when the gateway adds
      // the field — the value is already persisted on the chart regardless.
      serviceLine: this.optionalString(c.serviceLine?.name),
    });

    // Stitch the gateway's report_ids back onto each stored doc in the same
    // order they were sent. Persist now so the FE can render the file list
    // (and the eventual final codes can lookup-by-reportId) while the AI
    // pipeline runs.
    const existing = ((c.customFields?.uploadedDocs as UploadedDocument[] | undefined) ?? []);
    const newDocs: UploadedDocument[] = stored.map((s, i) => ({
      id: `${c.id}-${Date.now()}-${i}`,
      filename: s.filename,
      mimeType: s.mimeType,
      size: s.size,
      url: s.url,
      key: s.key,
      reportType: reportTypes[i],
      reportId: start.reportIds[i],
    }));
    const uploadedDocs = [...existing, ...newDocs];

    // Drop any prior aiPredictionError so a retry doesn't keep flagging the
    // chart as ERRORED while the new run is in flight.
    const { aiPredictionError: _drop, ...keepCustom } = c.customFields ?? {};
    c.customFields = {
      ...keepCustom,
      uploadedDocs,
      // Track in-flight runs so a future page reload could resume polling
      // instead of re-uploading the same files. Cleared in finalize().
      pendingPrediction: {
        encounterId: start.encounterId,
        taskId: start.taskId,
        reportIds: start.reportIds,
        startedAt: new Date().toISOString(),
      },
    };
    await this.charts.save(c);

    return {
      encounterId: start.encounterId,
      taskId: start.taskId,
      reportIds: start.reportIds,
      uploadedDocs,
    };
  }

  /**
   * Phase 2: cheap pass-through to the gateway's task-status endpoint.
   * The frontend polls this every few seconds while the AI pipeline runs.
   */
  async getProcessDocumentsStatus(
    id: number,
    encounterId: string,
    taskId: string,
  ): Promise<EncounterStatus> {
    const c = await this.charts.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    return this.aiPredictor.getEncounterStatus(encounterId, taskId);
  }

  /**
   * Phase 3: pull the final ICD codes from the gateway and persist them on
   * the chart. Returns the same shape the old single-shot
   * `processDocuments` endpoint used to return.
   */
  async finalizeProcessDocuments(id: number, encounterId: string) {
    const c = await this.charts.findOne({ where: { id } });
    if (!c) throw new NotFoundException();

    const uploadedDocs = (c.customFields?.uploadedDocs as UploadedDocument[] | undefined) ?? [];
    const pending = (c.customFields?.pendingPrediction as { reportIds?: string[]; startedAt?: string } | undefined) ?? {};
    const reportIds = pending.reportIds ?? uploadedDocs.map((d) => d.reportId).filter((r): r is string => !!r);

    const result = await this.aiPredictor.finalizeEncounter(encounterId, reportIds, reportIds.length);
    const completedAt = new Date();
    const processingMs = aiProcessingMs(pending.startedAt, completedAt);

    // Persist the prediction so the page survives a refresh without re-running
    // the pipeline. Stored under customFields to avoid a schema migration.
    // Drop any prior failure record along with the pending marker — mirrors
    // the watcher's finalize — so a successful retry resolves to DONE even
    // when the frontend polling path finalizes instead of the watcher.
    const { pendingPrediction: _drop, aiPredictionError: _drop2, ...keepCustom } = c.customFields ?? {};
    c.customFields = {
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
        // Document-processing timing, persisted on the chart (customFields jsonb):
        // startedAt is preserved from the pending marker before it's dropped so
        // the duration stays reconstructable; processingMs is null if we never
        // recorded a start (e.g. a legacy in-flight run).
        startedAt: pending.startedAt ?? null,
        completedAt: completedAt.toISOString(),
        processingMs,
        generatedAt: completedAt.toISOString(),
      },
    };
    await this.charts.save(c);

    return { ...result, uploadedDocs, processingMs };
  }

  /**
   * Add documents to a chart WITHOUT running the AI pipeline. This is the
   * upload half of the (now-separated) upload→process flow: the user can curate
   * the document set — add here, remove via removeDocument — and then trigger a
   * single run over the whole set with reprocess(). Word docs are converted to
   * PDF up front (same as the original combined path) and duplicates already on
   * the chart (same filename + size) are skipped so re-adding can't double up.
   */
  async addDocuments(id: number, files: Express.Multer.File[], body: ProcessDocumentsDto) {
    const c = await this.charts.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    if (c.customFields?.pendingPrediction) {
      throw new ConflictException('A run is in progress; wait for it to finish before adding documents.');
    }

    const explicit = (body.reportTypes ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as ReportType[];
    const reportTypes: ReportType[] = files.map(
      (f, i) => (explicit[i] as ReportType) ?? this.aiPredictor.mapReportType(body.documentType, f.originalname),
    );

    const pdfFiles = await this.conversion.toPdfMany(
      files.map((f) => ({ buffer: f.buffer, originalname: f.originalname, mimetype: f.mimetype, size: f.size })),
    );

    const existing = (c.customFields?.uploadedDocs as UploadedDocument[] | undefined) ?? [];
    const seen = new Set(existing.map((d) => `${d.filename}::${d.size}`));

    // Keep reportType aligned with each surviving (non-duplicate) file.
    const fresh = pdfFiles
      .map((f, i) => ({ file: f, reportType: reportTypes[i] }))
      .filter(({ file }) => !seen.has(`${file.originalname}::${file.size}`));

    if (!fresh.length) {
      // Everything submitted is already on the chart — nothing to do.
      return { uploadedDocs: existing, added: 0 };
    }

    const stored = await this.storage.uploadMany(fresh.map((t) => t.file), c.id);
    const newDocs: UploadedDocument[] = stored.map((s, i) => ({
      id: `${c.id}-${Date.now()}-${i}`,
      filename: s.filename,
      mimeType: s.mimeType,
      size: s.size,
      url: s.url,
      key: s.key,
      reportType: fresh[i].reportType,
    }));

    const uploadedDocs = [...existing, ...newDocs];
    c.customFields = { ...(c.customFields ?? {}), uploadedDocs };
    await this.charts.save(c);
    return { uploadedDocs, added: newDocs.length };
  }

  /**
   * Remove one uploaded document from a chart. Drops it from
   * customFields.uploadedDocs and best-effort deletes the underlying S3 object.
   * Blocked while a run is in flight so we don't desync the encounter's
   * report_ids from the doc list mid-pipeline.
   */
  async removeDocument(id: number, docId: string) {
    const c = await this.charts.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    if (c.customFields?.pendingPrediction) {
      throw new ConflictException('A run is in progress; cannot remove documents until it finishes.');
    }

    const existing = (c.customFields?.uploadedDocs as UploadedDocument[] | undefined) ?? [];
    const target = existing.find((d) => d.id === docId);
    if (!target) throw new NotFoundException('Document not found on this chart.');

    const key = this.docKey(target);
    if (key) await this.storage.delete(key);

    const uploadedDocs = existing.filter((d) => d.id !== docId);
    c.customFields = { ...(c.customFields ?? {}), uploadedDocs };
    await this.charts.save(c);
    return { uploadedDocs };
  }

  /**
   * Re-run the ICD Predictor over the chart's CURRENT document set without
   * forcing a re-upload. Pulls each stored doc back from S3, sends the whole
   * set to a fresh gateway encounter, and re-stitches the new report_ids onto
   * the docs (each encounter mints its own). Clears any prior error so the
   * chart resolves to DONE — not ERRORED — once the watcher finalizes.
   */
  async reprocess(id: number) {
    const c = await this.charts.findOne({
      where: { id },
      relations: { serviceLine: true, worklist: { primarySpeciality: true } },
    });
    if (!c) throw new NotFoundException();
    if (c.customFields?.pendingPrediction) {
      throw new ConflictException('A run is already in progress for this chart.');
    }

    const uploadedDocs = (c.customFields?.uploadedDocs as UploadedDocument[] | undefined) ?? [];
    if (!uploadedDocs.length) {
      throw new BadRequestException('No documents to process. Upload at least one document first.');
    }

    // Re-download each stored doc (in order) and forward to the gateway.
    const inbound: InboundFile[] = [];
    for (const d of uploadedDocs) {
      const key = this.docKey(d);
      if (!key) {
        throw new BadRequestException(`Cannot locate stored file for "${d.filename}". Remove and re-add it, then retry.`);
      }
      const buffer = await this.storage.download(key);
      inbound.push({ buffer, filename: d.filename, mimeType: d.mimeType, reportType: d.reportType });
    }

    const start = await this.aiPredictor.startEncounter(inbound, {
      mrn: c.mrNumber,
      encounterDate: c.dos ?? c.admitDate,
      facility: this.optionalString(c.customFields?.facility),
      department: this.optionalString(c.customFields?.specialty),
      // The chart's primary speciality (from its worklist) — forwarded as
      // `primary_speciality` so the gateway can apply speciality-tuned RAG.
      primarySpeciality: this.optionalString(c.worklist?.primarySpeciality?.name),
      // Deferred — see process-documents call site. Forwarded once the gateway
      // accepts it; persisted on the chart in the meantime.
      serviceLine: this.optionalString(c.serviceLine?.name),
    });

    // New encounter → new report_ids, parallel to uploadedDocs order.
    const restitched = uploadedDocs.map((d, i) => ({ ...d, reportId: start.reportIds[i] ?? d.reportId }));

    const { aiPredictionError: _drop, ...keepCustom } = c.customFields ?? {};
    c.customFields = {
      ...keepCustom,
      uploadedDocs: restitched,
      pendingPrediction: {
        encounterId: start.encounterId,
        taskId: start.taskId,
        reportIds: start.reportIds,
        startedAt: new Date().toISOString(),
      },
    };
    await this.charts.save(c);

    return {
      encounterId: start.encounterId,
      taskId: start.taskId,
      reportIds: start.reportIds,
      uploadedDocs: restitched,
    };
  }

  /** Resolve an uploaded doc's S3 key, falling back to parsing its URL for
   *  docs persisted before `key` was stored on the record. */
  private docKey(d: UploadedDocument): string | null {
    return d.key ?? this.storage.keyFromUrl(d.url);
  }

  private optionalString(v: unknown): string | undefined {
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  }

  /* ── Per-code Review & Edit decisions ─────────────────── */

  async listCodeDecisions(chartId: number) {
    await this.requireChart(chartId);
    const rows = await this.codeDecisions.find({
      where: { chartId },
      order: { codeType: 'ASC', codeValue: 'ASC' },
    });
    return {
      items: rows.map((r) => ({
        id: Number(r.id),
        codeType: r.codeType,
        codeValue: r.codeValue,
        originalDescription: r.originalDescription,
        decision: r.decision,
        editedCode: r.editedCode,
        editedDescription: r.editedDescription,
        reasonDropdown: r.reasonDropdown,
        reasonText: r.reasonText,
        decidedByUserId: Number(r.decidedByUserId),
        decidedAt: r.decidedAt,
      })),
    };
  }

  /* ── Code-decision drafts ─────────────────────────────────────────────
   * Autosaved working state for the Review & Edit modal, one row per
   * (chart, user). The payload is an opaque versioned blob owned by the
   * frontend; a refresh/crash restores it so in-progress accept/reject/
   * edit/add work isn't lost. Cleared atomically on successful submit. */

  /** Serialized-size cap for a draft blob. A full 500-code board with reasons
   * is well under 100 KB — anything bigger is a bug or abuse, not a chart. */
  private static readonly DRAFT_MAX_BYTES = 256 * 1024;

  async getCodeDecisionDraft(chartId: number, user: AuthenticatedUser) {
    await this.requireChart(chartId);
    const row = await this.decisionDrafts.findOne({ where: { chartId, userId: user.id } });
    return { draft: row ? { payload: row.payload, updatedAt: row.updatedAt } : null };
  }

  async saveCodeDecisionDraft(
    chartId: number,
    dto: SaveCodeDecisionDraftDto,
    user: AuthenticatedUser,
  ) {
    await this.requireChart(chartId);
    if (Buffer.byteLength(JSON.stringify(dto.payload), 'utf8') > ChartsService.DRAFT_MAX_BYTES) {
      throw new BadRequestException({
        error: { code: 'invalid_argument', message: 'Draft payload exceeds the 256 KB limit.' },
      });
    }
    // Atomic upsert on (chart_id, user_id): autosave is debounced but two
    // saves can still race (flush-on-close vs in-flight debounce) — ON
    // CONFLICT keeps that from ever failing or duplicating rows. updatedAt
    // is set explicitly because upsert bypasses the @UpdateDateColumn hook.
    const now = new Date();
    await this.decisionDrafts.upsert(
      { chartId, userId: user.id, payload: dto.payload, updatedAt: now },
      ['chartId', 'userId'],
    );
    return { savedAt: now.toISOString() };
  }

  async deleteCodeDecisionDraft(chartId: number, user: AuthenticatedUser) {
    await this.requireChart(chartId);
    const res = await this.decisionDrafts.delete({ chartId, userId: user.id });
    return { deleted: (res.affected ?? 0) > 0 };
  }

  async submitCodeDecisions(
    chartId: number,
    dto: SubmitCodeDecisionsDto,
    user: AuthenticatedUser,
  ) {
    const chart = await this.requireChart(chartId);
    const worklist = await this.worklists.findOne({ where: { id: chart.worklistId } });
    if (!worklist) {
      throw new NotFoundException({ error: { code: 'not_found', message: 'Worklist for chart not found.' } });
    }
    const { clientId, locationId } = worklist;

    // Silently dedupe by (codeType, codeValue) — the AI sometimes returns
    // the same code more than once (different sequence positions), and the
    // unique index on chart_code_decisions would otherwise reject the
    // second-onwards rows. First decision wins.
    const seenKeys = new Set<string>();
    const uniqueDecisions: typeof dto.decisions = [];
    for (const d of dto.decisions) {
      const key = `${d.codeType}|${d.codeValue}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      uniqueDecisions.push(d);
    }
    dto = { ...dto, decisions: uniqueDecisions };

    // Enrich missing predictedCodeId by looking up the gateway's predicted
    // codes for this chart's encounter. The FE *should* thread these IDs in
    // from GET /charts/:id/predicted-codes, but it has a fallback path that
    // reads the locally-cached AI prediction blob (no IDs) — that fallback
    // fires on stale react-query cache or when the modal opened before the
    // gateway had codes ready. Filling in the IDs server-side keeps a stale
    // FE state from producing 400s the user can't recover from.
    const encounterIdForEnrich = this.extractEncounterId(chart);
    if (encounterIdForEnrich) {
      const needsEnrichment = dto.decisions.some(
        (d) =>
          (d.decision === CodeReviewDecision.ACCEPTED ||
            d.decision === CodeReviewDecision.EDITED ||
            d.decision === CodeReviewDecision.REJECTED) &&
          !(d.predictedCodeId ?? '').trim(),
      );
      if (needsEnrichment) {
        try {
          const codes = await this.aiGateway.getEncounterCodes(encounterIdForEnrich);
          // Map (gateway-code-type, icd_code) → predicted_code_id. The
          // gateway's code_type is lowercase ('primary' | 'secondary' |
          // 'procedure' | 'cpt'); our CodeReviewType is uppercase, so we
          // translate at lookup time using mapCodeTypeForAiGateway.
          const byKey = new Map<string, string>();
          for (const c of codes ?? []) {
            byKey.set(`${(c.code_type ?? '').toLowerCase()}|${c.icd_code}`, c.id);
          }
          dto = {
            ...dto,
            decisions: dto.decisions.map((d) => {
              if ((d.predictedCodeId ?? '').trim()) return d;
              if (d.decision === CodeReviewDecision.ADDED) return d;
              const gatewayType = mapCodeTypeForAiGateway(d.codeType);
              const hit = byKey.get(`${gatewayType}|${d.codeValue}`);
              return hit ? { ...d, predictedCodeId: hit } : d;
            }),
          };
        } catch (err) {
          // Best-effort: if the gateway is unreachable, leave decisions as-is
          // and let validation surface a clear error. Don't fail the whole
          // submit — the user can retry once the gateway is healthy again.
          // (Logged inside AiGatewayClient.request.)
        }
      }
    }

    for (const d of dto.decisions) {
      const key = `${d.codeType}|${d.codeValue}`;

      // ACCEPT / EDIT / REJECT all act on a specific AI suggestion and therefore
      // require its predicted_code_id. Without it the gateway can't
      // attribute the decision to a code, so we'd silently lose it. ADDED has
      // no AI suggestion to point at and is exempt.
      const needsPredictedCodeId =
        d.decision === CodeReviewDecision.ACCEPTED ||
        d.decision === CodeReviewDecision.EDITED ||
        d.decision === CodeReviewDecision.REJECTED;
      if (needsPredictedCodeId && !(d.predictedCodeId ?? '').trim()) {
        throw new BadRequestException({
          error: {
            code: 'invalid_argument',
            message: `predictedCodeId is required for ${d.decision} on ${key}.`,
          },
        });
      }

      const requiresReason =
        d.decision === CodeReviewDecision.REJECTED || d.decision === CodeReviewDecision.EDITED;
      if (requiresReason) {
        const text = (d.reasonText ?? '').trim();
        const dropdown = (d.reasonDropdown ?? '').trim();
        if (text.length < 20) {
          throw new BadRequestException({
            error: { code: 'invalid_argument', message: `reasonText must be at least 20 characters for ${key}.` },
          });
        }
        if (!dropdown) {
          throw new BadRequestException({
            error: { code: 'invalid_argument', message: `reasonDropdown is required for ${key}.` },
          });
        }
        const action =
          d.decision === CodeReviewDecision.REJECTED ? CodeReviewAction.REJECT : CodeReviewAction.EDIT;
        const match = await this.codeReviewReasons.findOne({
          where: {
            clientId: Number(clientId),
            locationId: Number(locationId),
            codeType: d.codeType,
            action,
            text: dropdown,
            isActive: true,
          },
        });
        if (!match) {
          throw new BadRequestException({
            error: {
              code: 'invalid_argument',
              message: `reasonDropdown "${dropdown}" is not an active reason for ${d.codeType}/${action}.`,
            },
          });
        }
      }
      if (d.decision === CodeReviewDecision.EDITED) {
        if (!(d.editedCode ?? '').trim()) {
          throw new BadRequestException({
            error: { code: 'invalid_argument', message: `editedCode is required when decision is EDITED for ${key}.` },
          });
        }
      }
      // ADDED has no AI suggestion to compare against, no dropdown reason
      // requirement (those are scoped to REJECT/EDIT in our config), but
      // still demands a reason text per the gateway contract.
      if (d.decision === CodeReviewDecision.ADDED) {
        const text = (d.reasonText ?? '').trim();
        if (text.length < 20) {
          throw new BadRequestException({
            error: { code: 'invalid_argument', message: `reasonText must be at least 20 characters for ${key} (ADD).` },
          });
        }
        if (!(d.codeValue ?? '').trim()) {
          throw new BadRequestException({
            error: { code: 'invalid_argument', message: `codeValue is required when decision is ADDED.` },
          });
        }
      }
    }

    const now = new Date();
    // Atomic write: either every decision is persisted or none of them are.
    // Without this, a mid-loop failure (constraint violation, deadlock) would
    // leave the chart in a partially-saved state but throw to the FE, making
    // the next retry look like "some rows already exist".
    const saved = await this.dataSource.transaction(async (manager) => {
      const decisionsRepo = manager.getRepository(ChartCodeDecision);
      const rows: ChartCodeDecision[] = [];
      for (const d of dto.decisions) {
        const existing = await decisionsRepo.findOne({
          where: { chartId, codeType: d.codeType, codeValue: d.codeValue },
        });
        const requiresDropdownReason =
          d.decision === CodeReviewDecision.REJECTED || d.decision === CodeReviewDecision.EDITED;
        const requiresTextReason =
          requiresDropdownReason || d.decision === CodeReviewDecision.ADDED;
        // For ADDED rows there's no pre-existing predicted code, so no
        // predicted_code_id; the new code itself goes in editedCode + codeValue.
        const isAdded = d.decision === CodeReviewDecision.ADDED;
        const isEdited = d.decision === CodeReviewDecision.EDITED;
        const payload: Partial<ChartCodeDecision> = {
          chartId,
          codeType: d.codeType,
          codeValue: d.codeValue,
          predictedCodeId: isAdded ? undefined : (d.predictedCodeId ?? existing?.predictedCodeId),
          originalDescription: isAdded
            ? d.editedDescription ?? d.originalDescription
            : (d.originalDescription ?? existing?.originalDescription),
          decision: d.decision,
          editedCode: isEdited || isAdded ? d.editedCode ?? d.codeValue : undefined,
          editedDescription: isEdited || isAdded ? d.editedDescription : undefined,
          reasonDropdown: requiresDropdownReason ? (d.reasonDropdown ?? '').trim() : undefined,
          reasonText: requiresTextReason ? (d.reasonText ?? '').trim() : undefined,
          decidedByUserId: user.id,
          decidedAt: now,
        };
        if (existing) {
          await decisionsRepo.update({ id: existing.id }, payload);
          const reloaded = await decisionsRepo.findOne({ where: { id: existing.id } });
          if (reloaded) rows.push(reloaded);
        } else {
          const created = await decisionsRepo.save(decisionsRepo.create(payload));
          rows.push(created);
        }
      }
      // The submit supersedes any autosaved working state — clear the
      // submitter's draft in the same transaction so a refresh right after
      // submit can't resurrect stale pre-submit decisions.
      await manager.getRepository(ChartCodeDecisionDraft).delete({ chartId, userId: user.id });
      return rows;
    });

    // Local audit is the source of truth and is now persisted. Forward the
    // decisions to the AI gateway so EDIT/DELETE land in Qdrant and the
    // AI can learn from them on the next encounter. ACCEPT actions still
    // get sent — the gateway records them as audit-only on its side.
    // If forwarding fails we don't unwind the local write (per the doc:
    // "Postgres is always source of truth, Qdrant is best-effort"); we
    // surface the failure on the response so the FE can show it.
    const encounterId = this.extractEncounterId(chart);
    const aiGateway = await this.forwardToAiGateway({
      encounterId,
      user,
      decisions: dto.decisions,
    });

    // If the forward succeeded, persist the outcome back onto each local
    // chart_code_decisions row. Two signals:
    //   - gateway_synced_at: stamped for EVERY action the gateway accepted
    //     (success === true), ACCEPT included. ACCEPT is audit-only and returns
    //     no correction_id, so this is the only proof an accepted code reached
    //     the AI — it's what lets the admin page show accepted rows as "Synced"
    //     instead of the old misleading "Local only".
    //   - gateway_correction_id: additionally stored for EDIT/DELETE/ADD, which
    //     do return one. Powers the side-by-side round-trip check against
    //     GET /admin/corrections/{id} on the gateway.
    if ('forwarded' in aiGateway && aiGateway.forwarded && aiGateway.results?.length) {
      const byKey = new Map<string, ChartCodeDecision>(
        saved.map((r) => [`${r.codeType}|${r.codeValue}`, r]),
      );
      for (const r of aiGateway.results) {
        if (!r.success || !r.decisionKey) continue;
        const row = byKey.get(r.decisionKey);
        if (!row) continue;
        const patch: Partial<ChartCodeDecision> = { gatewaySyncedAt: now };
        if (r.correctionId) patch.gatewayCorrectionId = r.correctionId;
        await this.codeDecisions.update({ id: row.id }, patch);
        row.gatewaySyncedAt = now;
        if (r.correctionId) row.gatewayCorrectionId = r.correctionId;
      }
    }

    return {
      items: saved.map((r) => ({
        id: Number(r.id),
        codeType: r.codeType,
        codeValue: r.codeValue,
        predictedCodeId: r.predictedCodeId ?? null,
        originalDescription: r.originalDescription,
        decision: r.decision,
        editedCode: r.editedCode,
        editedDescription: r.editedDescription,
        reasonDropdown: r.reasonDropdown,
        reasonText: r.reasonText,
        gatewayCorrectionId: r.gatewayCorrectionId ?? null,
        gatewaySyncedAt: r.gatewaySyncedAt ?? null,
        decidedByUserId: Number(r.decidedByUserId),
        decidedAt: r.decidedAt,
      })),
      aiGateway,
    };
  }

  /** Forwards the just-persisted decisions to the AI gateway so corrections
   * land in Qdrant. Mapping: ACCEPTED→ACCEPT, REJECTED→DELETE, EDITED→EDIT,
   * ADDED→ADD. */
  private async forwardToAiGateway(opts: {
    encounterId: string | null;
    user: AuthenticatedUser;
    decisions: SubmitCodeDecisionsDto['decisions'];
  }) {
    // Hard gate: only the real production deployment is allowed to write into
    // the shared AI golden dataset. Any other value (uat/staging/dev) skips
    // the forward entirely so tester-entered codes don't pollute training.
    const deployment = (this.config.get<string>('DEPLOYMENT') ?? '').toLowerCase();
    if (deployment !== 'production') {
      return {
        skipped: true,
        reason: `Deployment is "${deployment || 'unset'}"; AI gateway forwarding is disabled outside production.`,
        deployment,
      };
    }

    if (!opts.encounterId) {
      return { skipped: true, reason: 'Chart has no AI encounter; nothing to forward.' };
    }

    // Look up the user's gateway UUID (users.public_id) and active status fresh
    // — JWT claims don't carry these and we don't want a stale JWT to keep an
    // inactive coder writing into the golden dataset.
    const dbUser = await this.users.findOne({ where: { id: opts.user.id } });
    if (!dbUser) {
      // Auth got us this far, so this only happens if the row was deleted
      // mid-session. Treat as forbidden rather than 500.
      throw new ForbiddenException({
        error: { code: 'forbidden', message: 'Reviewer not found.' },
      });
    }
    if (dbUser.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({
        error: { code: 'forbidden', message: 'Reviewer is not active; cannot submit code decisions.' },
      });
    }
    if (!dbUser.publicId) {
      // We persisted the local decisions already (transaction above), but the
      // forward to the gateway needs the user's gateway-issued UUID. Surface
      // a clear, actionable error rather than silently dropping the forward.
      return {
        skipped: true,
        reason: `User ${dbUser.id} has no public_id — run the coder backfill (POST /admin/users) before forwarding.`,
      };
    }
    const coderId = dbUser.publicId;

    // predictedCodeId presence for ACCEPT/EDIT/REJECT is enforced up-front in
    // submitCodeDecisions's validation loop, so by the time we get here every
    // non-ADD decision is guaranteed to have one. The `!d.predictedCodeId`
    // guards below are defensive belt-and-suspenders only.
    // The gateway only has one free-text `reason` column on coder_corrections,
    // but we collect *two* signals: a dropdown category (e.g., "Incorrect
    // Specificity") and the long-form text. Concatenate so the golden dataset
    // and the Qdrant RAG retriever see both — categorical labels are usually
    // stronger retrieval signals than verbose prose alone.
    const composeReason = (d: SubmitCodeDecisionsDto['decisions'][number]): string | undefined => {
      const dropdown = (d.reasonDropdown ?? '').trim();
      const text = (d.reasonText ?? '').trim();
      if (dropdown && text) return `${dropdown}: ${text}`;
      return dropdown || text || undefined;
    };

    // Parallel arrays: `actions[i]` is sent to the gateway; `actionKeys[i]`
    // is the local (codeType|codeValue) key of the decision that produced it.
    // The gateway returns results in the same order it received actions, so
    // we can pair gateway results back to local saved rows by index → key.
    const actions: ReviewActionPayload[] = [];
    const actionKeys: string[] = [];
    for (const d of opts.decisions) {
      const codeType = mapCodeTypeForAiGateway(d.codeType);
      const reason = composeReason(d);
      const key = `${d.codeType}|${d.codeValue}`;
      if (d.decision === CodeReviewDecision.ACCEPTED) {
        if (!d.predictedCodeId) continue;
        actions.push({ action: 'ACCEPT', predicted_code_id: d.predictedCodeId });
        actionKeys.push(key);
      } else if (d.decision === CodeReviewDecision.REJECTED) {
        if (!d.predictedCodeId) continue;
        actions.push({
          action: 'DELETE',
          predicted_code_id: d.predictedCodeId,
          code_type: codeType,
          reason,
        });
        actionKeys.push(key);
      } else if (d.decision === CodeReviewDecision.EDITED) {
        if (!d.predictedCodeId) continue;
        actions.push({
          action: 'EDIT',
          predicted_code_id: d.predictedCodeId,
          correct_code: (d.editedCode ?? d.codeValue).trim(),
          correct_description: d.editedDescription?.trim(),
          code_type: codeType,
          reason,
        });
        actionKeys.push(key);
      } else if (d.decision === CodeReviewDecision.ADDED) {
        // ADD has no predicted_code_id (the gateway mints one and returns it
        // in the results array). The doc explicitly requires code_type +
        // reason for ADD.
        actions.push({
          action: 'ADD',
          correct_code: (d.editedCode ?? d.codeValue).trim(),
          correct_description: d.editedDescription?.trim(),
          code_type: codeType,
          sequence_pos: d.sequencePos ?? undefined,
          reason,
        });
        actionKeys.push(key);
      }
    }

    if (actions.length === 0) {
      return { skipped: true, reason: 'No actions had a predicted_code_id to forward.' };
    }

    try {
      const res = await this.aiGateway.submitEncounterReview(opts.encounterId, {
        coder_id: coderId,
        actions,
      });
      return {
        forwarded: true,
        encounterId: opts.encounterId,
        totalActions: res.total_actions,
        correctionsWritten: res.corrections_written,
        qdrantSyncFailures: res.qdrant_sync_failures,
        // Per-action results. Each entry's `correctionId` is the PK we'd pass
        // to GET /admin/corrections/{id} for Flow A verification (doc §5.3).
        // `decisionKey` (codeType|codeValue) lets the caller join each result
        // back to the local chart_code_decisions row to store the correction
        // id. Normalized to camelCase to match the rest of our API surface.
        results: (res.results ?? []).map((r, i) => ({
          decisionKey: actionKeys[i] ?? null,
          predictedCodeId: r.predicted_code_id ?? null,
          action: r.action,
          success: r.success,
          correctionId: r.correction_id ?? null,
          qdrantSynced: r.qdrant_synced ?? null,
        })),
      };
    } catch (err) {
      const e = err as any;
      const msg =
        e?.response?.error?.message ?? e?.message ?? 'AI gateway forward failed.';
      // Don't throw — local write succeeded. Just surface the failure.
      return {
        forwarded: false,
        encounterId: opts.encounterId,
        error: msg,
      };
    }
  }

  /** Resolve the gateway-provided predicted codes (with UUIDs) for a chart's
   * encounter. Just a thin proxy — the FE uses this when opening the
   * Review modal so each AI suggestion carries its predicted_code_id. */
  async getPredictedCodesForChart(chartId: number) {
    const chart = await this.requireChart(chartId);
    const encounterId = this.extractEncounterId(chart);
    if (!encounterId) {
      return { codes: [], encounterId: null };
    }
    const codes = await this.aiGateway.getEncounterCodes(encounterId);
    return { codes, encounterId };
  }

  private async requireChart(id: number): Promise<Chart> {
    const c = await this.charts.findOne({ where: { id } });
    if (!c) throw new NotFoundException({ error: { code: 'not_found', message: `Chart ${id} not found.` } });
    return c;
  }
}

/** Translates our CodeReviewType enum into the AI gateway's vocabulary
 * (lowercase: primary | secondary | procedure | cpt). */
function mapCodeTypeForAiGateway(t: string): 'primary' | 'secondary' | 'procedure' | 'cpt' {
  switch (t) {
    case 'PRIMARY':   return 'primary';
    case 'SECONDARY': return 'secondary';
    case 'PROCEDURE': return 'procedure';
    case 'EM_LEVEL':  return 'cpt';
    case 'MODIFIER':  return 'cpt';
    default:          return 'primary';
  }
}
