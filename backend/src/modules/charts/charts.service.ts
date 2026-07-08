import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, IsNull, QueryFailedError, Repository, SelectQueryBuilder } from 'typeorm';
import { Chart } from '../../entities/chart.entity';
import { ChartAllocation } from '../../entities/chart-allocation.entity';
import { ChartFeedback } from '../../entities/chart-feedback.entity';
import { ChartCodeDecision } from '../../entities/chart-code-decision.entity';
import { ChartCodeAudit } from '../../entities/chart-code-audit.entity';
import { ChartCodeDecisionDraft } from '../../entities/chart-code-decision-draft.entity';
import { ChartTimeLog, type ChartTimerKind } from '../../entities/chart-time-log.entity';
import { CodeReviewReason } from '../../entities/code-review-reason.entity';
import { Worklist } from '../../entities/worklist.entity';
import { User } from '../../entities/user.entity';
import { ChartMilestone, ChartStatus, CodeAuditVerdict, CodeReviewAction, CodeReviewDecision, Priority, UserStatus } from '../../common/enums';
import { priorityBucketSql, priorityRankSql, bucketMembershipSql, finalizedSql, doneSql, type ComputedBucket } from './priority-rules';
import { SaveCodeDecisionDraftDto, SubmitCodeDecisionsDto } from './dto/code-decisions.dto';
import { SubmitCodeAuditsDto } from './dto/code-audits.dto';
import { AiGatewayClient, type PredictedCodeReviewItem, type ReviewActionPayload } from '../ai-gateway/ai-gateway.service';
import { Role } from '../../common/enums/roles.enum';
import { AuthenticatedUser } from '../../common/types/request-user.type';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { AiStatusFilter, QueryChartsDto, ReviewedFilter } from './dto/query-charts.dto';
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
const RESERVED_PIPELINE_KEYS = ['aiPrediction', 'aiPredictionError', 'pendingPrediction', 'uploadedDocs', 'timerPaused'] as const;

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
  private readonly log = new Logger(ChartsService.name);

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
    role: Role,
  ): void {
    const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
    if (sortBy === 'serialNo') {
      qb.orderBy('worklist.worklistNumber', 'ASC')
        .addOrderBy('c.serialNo', dir)
        .addOrderBy('c.id', 'ASC');
      return;
    }
    // Priority is computed per viewer role, not a plain column — sort on its rank.
    if (sortBy === 'priority') {
      qb.orderBy(priorityRankSql(role), dir).addOrderBy('c.id', 'ASC');
      return;
    }
    const col = sortBy ? ChartsService.SORT_COLUMNS[sortBy] : undefined;
    if (!col) {
      qb.orderBy('c.createdAt', 'DESC').addOrderBy('c.id', 'DESC');
      return;
    }
    // DOS is nullable — keep undated charts at the bottom in BOTH directions
    // (Postgres otherwise leads a DESC sort with the NULL rows).
    qb.orderBy(col, dir, col === 'c.dos' ? 'NULLS LAST' : undefined).addOrderBy('c.id', 'ASC');
  }

  constructor(
    @InjectRepository(Chart) private readonly charts: Repository<Chart>,
    @InjectRepository(ChartAllocation) private readonly allocations: Repository<ChartAllocation>,
    @InjectRepository(ChartFeedback) private readonly feedbacks: Repository<ChartFeedback>,
    @InjectRepository(ChartCodeDecision) private readonly codeDecisions: Repository<ChartCodeDecision>,
    @InjectRepository(ChartCodeAudit) private readonly codeAudits: Repository<ChartCodeAudit>,
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

  /** QC-status values are persisted by the chart-detail form under the
   * `customFields._formDraft` blob (coder in `qcStatus`, auditor in
   * `auditorQcStatus`) — NOT at the top level. Read both, tolerating
   * absent/non-string values (empty string = "Blank" → null). The same
   * `_formDraft` path is what the priority-rule SQL and reports.service read. */
  private readFormDraftQc(cf: Record<string, any>): { coder: string | null; auditor: string | null } {
    const fd = (cf?._formDraft ?? {}) as Record<string, any>;
    return {
      coder: typeof fd.qcStatus === 'string' && fd.qcStatus ? fd.qcStatus : null,
      auditor: typeof fd.auditorQcStatus === 'string' && fd.auditorQcStatus ? fd.auditorQcStatus : null,
    };
  }

  /**
   * Apply the Charts-grid filter predicates to a query builder. Shared by
   * list() and summary() so the priority-tab counts reflect exactly the same
   * filtered set the grid shows. Assumes `worklist` (and, for the name-based
   * sub-speciality filter, `subSpeciality`) are already joined under those
   * aliases, and that role/orphan scoping has been applied by the caller.
   */
  private applyChartFilters(qb: SelectQueryBuilder<Chart>, q: QueryChartsDto): SelectQueryBuilder<Chart> {
    // NOTE: the priority "tab" filter is applied by the caller (list()/summary())
    // because it is computed per viewer-role — see applyPriorityScope().
    if (q.worklistId?.length) qb.andWhere('c.worklist_id IN (:...w)', { w: q.worklistId });
    if (q.serialFrom) qb.andWhere('c.serial_no >= :sf', { sf: q.serialFrom });
    if (q.serialTo) qb.andWhere('c.serial_no <= :st', { st: q.serialTo });
    if (q.chartNo) qb.andWhere('c.chart_no ILIKE :cn', { cn: `%${q.chartNo}%` });
    // Encounter id lives on the JSONB custom_fields (aiPrediction.encounterId);
    // match a fragment of it case-insensitively, same as the chart # search.
    if (q.encounterId?.trim())
      qb.andWhere(`c.custom_fields->'aiPrediction'->>'encounterId' ILIKE :eid`, {
        eid: `%${q.encounterId.trim()}%`,
      });
    if (q.chartStatus?.length) qb.andWhere('c.chart_status IN (:...cs)', { cs: q.chartStatus });
    if (q.milestone?.length) qb.andWhere('c.milestone IN (:...m)', { m: q.milestone });
    if (q.allocatedUserId?.length) qb.andWhere('(c.allocated_coder_id IN (:...au) OR c.allocated_auditor_id IN (:...au))', { au: q.allocatedUserId });
    if (q.primarySpecialityId?.length) qb.andWhere('worklist.primary_speciality_id IN (:...ps)', { ps: q.primarySpecialityId });
    if (q.subSpecialityId?.length) qb.andWhere('worklist.sub_speciality_id IN (:...ss)', { ss: q.subSpecialityId });
    // Name-based match for the "all unique sub-specialities" filter — the same
    // name can exist under many locations, so we match on the joined name.
    if (q.subSpecialityName?.length) qb.andWhere('subSpeciality.name IN (:...ssn)', { ssn: q.subSpecialityName });
    // Client / Location filters (multi-select). The worklist is already joined.
    if (q.clientId?.length) qb.andWhere('worklist.client_id IN (:...cids)', { cids: q.clientId });
    if (q.locationId?.length) qb.andWhere('worklist.location_id IN (:...lids)', { lids: q.locationId });
    // Narrow to a single AI-pipeline state (e.g. ERRORED) using the same
    // custom_fields predicates that drive the AI summary tiles.
    if (q.aiStatus?.length) this.applyAiStatusFilters(qb, q.aiStatus);
    // "Reviewed" = the chart has been worked upon — it has at least one
    // submitted code decision. No column tracks this, so match with a
    // correlated EXISTS; 'NO' inverts it to surface charts no one has touched.
    if (q.reviewed) {
      const reviewedExists = 'EXISTS (SELECT 1 FROM chart_code_decisions cd WHERE cd.chart_id = c.id)';
      qb.andWhere(q.reviewed === ReviewedFilter.YES ? reviewedExists : `NOT ${reviewedExists}`);
    }
    if (q.receivedDateFrom) qb.andWhere('worklist.received_date >= :rdf', { rdf: q.receivedDateFrom });
    if (q.receivedDateTo) qb.andWhere('worklist.received_date <= :rdt', { rdt: q.receivedDateTo });
    // Date of coding — compare on the calendar date so the range is inclusive of
    // the whole "to" day regardless of the stored timestamp's time-of-day.
    if (q.codingCompletedFrom) qb.andWhere('c.coding_completed_at::date >= :ccf', { ccf: q.codingCompletedFrom });
    if (q.codingCompletedTo) qb.andWhere('c.coding_completed_at::date <= :cct', { cct: q.codingCompletedTo });
    // Date of service — inclusive range on the chart's own DOS (a date column,
    // so no cast needed). Charts without a DOS never match a range filter.
    if (q.dateOfServiceFrom) qb.andWhere('c.dos >= :dosf', { dosf: q.dateOfServiceFrom });
    if (q.dateOfServiceTo) qb.andWhere('c.dos <= :dost', { dost: q.dateOfServiceTo });
    return qb;
  }

  /**
   * Apply the priority-tab scope for a viewer role. Requires `worklist` joined.
   *  - a bucket (CRITICAL/HIGH/MEDIUM/LOW) → charts whose computed bucket = it
   *  - 'DONE'  → charts the viewer touched today (bypasses bucket-visibility, as
   *              a finished chart leaves the priority buckets but is still "done")
   *  - empty (ALL) → when `hideUnbucketed`, only charts matching ANY bucket for
   *              this role (User Manual §4.2 backlog visibility); otherwise all.
   *
   * `hideUnbucketed` is off for worklist-scoped requests so the worklist
   * inventory view keeps showing finished charts that have left every bucket.
   */
  private applyPriorityScope(
    qb: SelectQueryBuilder<Chart>,
    role: Role,
    tab: string | undefined,
    viewerId: number,
    hideUnbucketed: boolean,
  ): void {
    const bucket = priorityBucketSql(role);
    if (tab === 'DONE') {
      // "Done" (§4.6) = the viewer touched the chart today and it is not back in
      // their "ready" milestone. The role/allocation base-scope in list() keeps
      // a coder to their own charts; managers/auditors see all as usual.
      qb.andWhere(doneSql(role), { doneViewerId: viewerId });
    } else if (tab === 'FINALIZED') {
      // "Finalized" (§4.7, Managers only) = Coding/Audit Done + Complete.
      qb.andWhere(finalizedSql());
    } else if (tab) {
      // A specific computed bucket: match by membership (not the single highest
      // bucket) so the manual's legitimate two-bucket overlap surfaces the chart
      // under each tab it qualifies for.
      qb.andWhere(bucketMembershipSql(role, tab as ComputedBucket));
    } else if (hideUnbucketed) {
      qb.andWhere(`(${bucket}) IS NOT NULL`);
    }
  }

  async list(q: QueryChartsDto, user: AuthenticatedUser) {
    const qb = this.charts.createQueryBuilder('c')
      .leftJoinAndSelect('c.worklist', 'worklist')
      .leftJoinAndSelect('worklist.client', 'client')
      .leftJoinAndSelect('worklist.location', 'location')
      .leftJoinAndSelect('worklist.primarySpeciality', 'primarySpeciality')
      .leftJoinAndSelect('worklist.subSpeciality', 'subSpeciality')
      .leftJoinAndSelect('worklist.process', 'process')
      .leftJoinAndSelect('c.serviceLine', 'serviceLine');

    // Role-scoped visibility: coders see only their own queue. Auditors — like
    // team-leads / managers — see every chart and self-allocate one to work on
    // it (the startTimer guard still enforces allocation before timing).
    if (user.role === Role.CODER) qb.andWhere('c.allocated_coder_id = :uid', { uid: user.id });

    // Hide charts orphaned by a soft-deleted worklist (see helper).
    this.excludeOrphanedCharts(qb);

    this.applyChartFilters(qb, q);
    // Priority-tab scope (computed per viewer role). The no-bucket hide (User
    // Manual §4.2) applies to the backlog, not to a worklist inventory view.
    const scopedToWorklist = (q.worklistId?.length ?? 0) > 0;
    this.applyPriorityScope(qb, user.role, q.priority, Number(user.id), !scopedToWorklist);

    // Count the fully-scoped set before pagination / the computed-priority
    // addSelect (getManyAndCount can't be used once we need the raw column).
    const total = await qb.clone().getCount();

    this.applySort(qb, q.sortBy, q.sortDir, user.role);
    qb.skip((q.page - 1) * q.pageSize).take(q.pageSize);

    // Pull each chart's computed priority bucket alongside the entity so the row
    // reflects the viewer's role (all to-one joins → raw aligns 1:1 with items).
    qb.addSelect(priorityBucketSql(user.role), 'row_priority');
    const { entities: items, raw } = await qb.getRawAndEntities();
    const rowPriorityAt = (i: number): Priority | null =>
      (raw[i]?.row_priority as Priority | null) ?? null;

    // Batch-resolve user names for the four user FKs the table can show.
    const userIds = new Set<number>();
    for (const c of items) {
      if (c.allocatedCoderId) userIds.add(Number(c.allocatedCoderId));
      if (c.allocatedAuditorId) userIds.add(Number(c.allocatedAuditorId));
      if (c.originalCoderId) userIds.add(Number(c.originalCoderId));
      if (c.originalAuditorId) userIds.add(Number(c.originalAuditorId));
    }
    const userMap = new Map<number, { name: string; avatarUrl: string | null }>();
    if (userIds.size > 0) {
      const users = await this.users.find({
        where: { id: In([...userIds]) },
        select: ['id', 'fullName', 'avatarUrl'],
      });
      for (const u of users) userMap.set(Number(u.id), { name: u.fullName, avatarUrl: u.avatarUrl ?? null });
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

    const mapped = items.map(({ worklist, serviceLine, ...rest }, i) => {
      const cf = (rest.customFields ?? {}) as Record<string, any>;
      const alloc = allocByChart.get(Number(rest.id)) ?? {};
      return {
        ...rest,
        // Priority is computed per viewer role (falls back to the stored value
        // only for the touched-today "Done" tab, where a finished chart may have
        // left every priority bucket). In the Finalized tab every row is, by
        // definition, finalized — show that chip rather than the empty bucket.
        priority: q.priority === 'FINALIZED' ? Priority.FINALIZED : (rowPriorityAt(i) ?? rest.priority),
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
        allocatedCoderName: rest.allocatedCoderId ? userMap.get(Number(rest.allocatedCoderId))?.name ?? null : null,
        allocatedAuditorName: rest.allocatedAuditorId ? userMap.get(Number(rest.allocatedAuditorId))?.name ?? null : null,
        allocatedCoderAvatarUrl: rest.allocatedCoderId ? userMap.get(Number(rest.allocatedCoderId))?.avatarUrl ?? null : null,
        allocatedAuditorAvatarUrl: rest.allocatedAuditorId ? userMap.get(Number(rest.allocatedAuditorId))?.avatarUrl ?? null : null,
        originalCoderId: rest.originalCoderId ?? null,
        originalAuditorId: rest.originalAuditorId ?? null,
        originalCoderName: rest.originalCoderId ? userMap.get(Number(rest.originalCoderId))?.name ?? null : null,
        originalAuditorName: rest.originalAuditorId ? userMap.get(Number(rest.originalAuditorId))?.name ?? null : null,
        coderAllocatedAt: alloc.coderAt ?? null,
        auditorAllocatedAt: alloc.auditorAt ?? null,
        // Prefer the worklist's structured sub-speciality (sub_speciality_id);
        // fall back to the free-text custom_fields value for tenants that
        // haven't promoted it into a column yet. Mirrors detail() so the list
        // column and the detail header agree.
        subSpecialityName:
          worklist?.subSpeciality?.name ?? (typeof cf.subSpeciality === 'string' ? cf.subSpeciality : null),
        // QC status is persisted by the chart-detail form under the _formDraft
        // blob, not at the top level — read it from there (matches reports.service).
        qcStatus: this.readFormDraftQc(cf).coder,
        auditorQcStatus: this.readFormDraftQc(cf).auditor,
      };
    });
    return new PaginatedResponseDto(mapped, total, q.page, q.pageSize);
  }

  async summary(
    user: AuthenticatedUser,
    q: QueryChartsDto = {} as QueryChartsDto,
  ) {
    // Query params arrive as string / string[] / number — normalize to number[].
    const toNums = (v: unknown): number[] =>
      v == null || v === ''
        ? []
        : (Array.isArray(v) ? v : [v]).map(Number).filter((n) => Number.isFinite(n));
    const cids = toNums(q.clientId);
    const lids = toNums(q.locationId);
    const qb = this.charts.createQueryBuilder('c');
    if (user.role === Role.CODER) qb.andWhere('c.allocated_coder_id = :uid', { uid: user.id });
    // Auditors see all charts (mirrors list()), so no auditor-scoped filter here —
    // the tiles / tab counts stay in step with the full list they now see.
    // Keep the tiles / tab counts in step with list(): exclude orphaned charts.
    // Applied to the base qb before any clone so every count below inherits it.
    this.excludeOrphanedCharts(qb);
    // Global header scope (Client / Location). summary() doesn't join the
    // worklist by default, so join it here (alias `ws` — `w` is taken by the
    // orphan-guard subquery) only when a scope is set. Chart→worklist is
    // many-to-one, so the join can't inflate the COUNTs below.
    if (cids.length || lids.length) {
      qb.innerJoin('worklists', 'ws', 'ws.id = c.worklist_id');
      if (cids.length) qb.andWhere('ws.client_id IN (:...cids)', { cids });
      if (lids.length) qb.andWhere('ws.location_id IN (:...lids)', { lids });
    }

    // Priority-tab counts must reflect the SAME filtered set the grid shows, so
    // they run over a fully-filtered query (all grid filters via the shared
    // helper) — not the client/location-only base `qb` the tiles use. The
    // `priority` filter (the active tab) is deliberately dropped so every
    // bucket's count is visible regardless of which tab is selected.
    const priorityQb = this.charts.createQueryBuilder('c')
      .leftJoin('c.worklist', 'worklist')
      .leftJoin('worklist.subSpeciality', 'subSpeciality');
    if (user.role === Role.CODER) priorityQb.andWhere('c.allocated_coder_id = :uid', { uid: user.id });
    this.excludeOrphanedCharts(priorityQb);
    this.applyChartFilters(priorityQb, { ...q, priority: undefined });
    // Per-bucket counts use membership (not a GROUP BY the single highest
    // bucket) so the manual's legitimate two-bucket overlap is counted under
    // each tab; `allBucketed` is the distinct count for the "All" tab (each
    // chart once). Finalized (§4.7) is a Managers-only bucket.
    const sum = (cond: string) => `SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END)`;
    const isManagerView = user.role === Role.MANAGER;
    const countRow = await priorityQb.clone()
      .select(sum(bucketMembershipSql(user.role, 'CRITICAL')), 'critical')
      .addSelect(sum(bucketMembershipSql(user.role, 'HIGH')), 'high')
      .addSelect(sum(bucketMembershipSql(user.role, 'MEDIUM')), 'medium')
      .addSelect(sum(bucketMembershipSql(user.role, 'LOW')), 'low')
      .addSelect(sum(`(${priorityBucketSql(user.role)}) IS NOT NULL`), 'allbucketed')
      .addSelect(isManagerView ? sum(finalizedSql()) : '0', 'finalized')
      .getRawOne();
    // "Done" tab count (§4.6): must match the applyPriorityScope('DONE')
    // predicate exactly.
    const doneTodayRow = await priorityQb.clone()
      .andWhere(doneSql(user.role), { doneViewerId: Number(user.id) })
      .select('COUNT(*)', 'count').getRawOne();

    const milestoneRows = await qb.clone()
      .select('c.milestone', 'milestone').addSelect('COUNT(*)', 'count').groupBy('c.milestone').getRawMany();

    const pc = {
      critical: Number(countRow?.critical ?? 0),
      high: Number(countRow?.high ?? 0),
      medium: Number(countRow?.medium ?? 0),
      low: Number(countRow?.low ?? 0),
      // Distinct count of charts in at least one active bucket (the "All" tab).
      allBucketed: Number(countRow?.allbucketed ?? 0),
      // §4.7 Finalized (Managers only; 0 for other roles).
      finalized: Number(countRow?.finalized ?? 0),
      doneToday: Number(doneTodayRow?.count ?? 0),
    };

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
  /** The AND-ed predicates for one AI status, wrapped in a Brackets so several
   *  can be OR-ed together (multi-select) without their conditions bleeding into
   *  each other. Predicates are literal SQL (no params), so OR-ing is safe. */
  private aiStatusBrackets(status: AiStatusFilter): Brackets {
    return new Brackets((qb) => {
      switch (status) {
        case AiStatusFilter.QUEUED:
          qb.where(`c.custom_fields ? 'pendingPrediction'`)
            .andWhere(`COALESCE(c.custom_fields->'pendingPrediction'->>'gatewayStatus','PENDING') = 'PENDING'`);
          break;
        case AiStatusFilter.PROCESSING:
          qb.where(`c.custom_fields ? 'pendingPrediction'`)
            .andWhere(`c.custom_fields->'pendingPrediction'->>'gatewayStatus' = 'STARTED'`);
          break;
        case AiStatusFilter.IN_PROGRESS:
          // Union of QUEUED + PROCESSING — any chart with a pending prediction,
          // matching the donut's "In progress" slice.
          qb.where(`c.custom_fields ? 'pendingPrediction'`);
          break;
        case AiStatusFilter.ERRORED:
          qb.where(`NOT (c.custom_fields ? 'pendingPrediction')`)
            .andWhere(`c.custom_fields ? 'aiPredictionError'`);
          break;
        case AiStatusFilter.DONE:
          qb.where(`NOT (c.custom_fields ? 'pendingPrediction')`)
            .andWhere(`NOT (c.custom_fields ? 'aiPredictionError')`)
            .andWhere(`c.custom_fields ? 'aiPrediction'`);
          break;
      }
    });
  }

  /** Single status — used by summary()'s AI tile counts. */
  private applyAiStatusFilter(
    qb: SelectQueryBuilder<Chart>,
    status: AiStatusFilter,
  ): SelectQueryBuilder<Chart> {
    return qb.andWhere(this.aiStatusBrackets(status));
  }

  /** One or more statuses OR-ed together — used by the list filter so a
   *  multi-select can match any (e.g. Queued OR Errored). */
  private applyAiStatusFilters(
    qb: SelectQueryBuilder<Chart>,
    statuses: AiStatusFilter[],
  ): SelectQueryBuilder<Chart> {
    if (statuses.length <= 1) {
      return statuses.length ? this.applyAiStatusFilter(qb, statuses[0]) : qb;
    }
    return qb.andWhere(
      new Brackets((b) => {
        statuses.forEach((s, i) => {
          if (i === 0) b.where(this.aiStatusBrackets(s));
          else b.orWhere(this.aiStatusBrackets(s));
        });
      }),
    );
  }

  async detail(id: number, user?: AuthenticatedUser) {
    // Load the parent worklist + its config relations so the detail header can
    // show the same enriched fields the list does (worklist #, client,
    // location, speciality, process, received date) without the frontend
    // making a second round-trip.
    const c = await this.charts.findOne({
      where: { id },
      relations: {
        serviceLine: true,
        worklist: {
          client: true,
          location: true,
          primarySpeciality: true,
          subSpeciality: true,
          process: true,
        },
      },
    });
    if (!c) throw new NotFoundException();

    // Compute the priority bucket from the viewer's perspective (matches the
    // list). Falls back to a manager view when the caller is unauthenticated.
    const bucketRow = await this.charts.createQueryBuilder('c')
      .leftJoin('c.worklist', 'worklist')
      .select(priorityBucketSql(user?.role ?? Role.MANAGER), 'bucket')
      .where('c.id = :id', { id })
      .getRawOne<{ bucket: string | null }>();
    const computedPriority = (bucketRow?.bucket as Priority | null) ?? null;

    // Resolve allocated / original coder & auditor display names (list parity).
    const userIds = [
      c.allocatedCoderId, c.allocatedAuditorId, c.originalCoderId, c.originalAuditorId,
    ].filter((v): v is number => v != null).map(Number);
    const userMap = new Map<number, { name: string; avatarUrl: string | null }>();
    if (userIds.length) {
      const users = await this.users.find({ where: { id: In([...new Set(userIds)]) } });
      for (const u of users) userMap.set(Number(u.id), { name: u.fullName, avatarUrl: u.avatarUrl ?? null });
    }

    // Earliest CODER / AUDITOR allocation timestamps (the handoff dates).
    const allocRows: Array<{ role: 'CODER' | 'AUDITOR'; first_at: Date | string | null }> =
      await this.allocations
        .createQueryBuilder('a')
        .select('a.role', 'role')
        .addSelect('MIN(a.allocated_at)', 'first_at')
        .where('a.chart_id = :id', { id })
        .groupBy('a.role')
        .getRawMany();
    let coderAllocatedAt: string | null = null;
    let auditorAllocatedAt: string | null = null;
    for (const r of allocRows) {
      const iso = r.first_at instanceof Date ? r.first_at.toISOString() : (r.first_at ? String(r.first_at) : null);
      if (r.role === 'CODER') coderAllocatedAt = iso;
      if (r.role === 'AUDITOR') auditorAllocatedAt = iso;
    }

    // Total coder/auditor time logged on this chart = sum of completed timer
    // sessions (chart_time_logs). The header adds the live running session on top.
    const timeAgg = await this.timeLogs
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.elapsed_ms), 0)', 'sum')
      .where('t.chart_id = :id', { id })
      .getRawOne<{ sum: string }>();
    const coderTimeMs = Number(timeAgg?.sum ?? 0);

    // The current user's OWN logged time on this chart. The editable timer shows
    // this (not the chart total) so a new worker — e.g. an auditor opening a
    // coder-finished chart — starts from zero instead of the coder's elapsed.
    let myTimeMs = 0;
    if (user) {
      const myAgg = await this.timeLogs
        .createQueryBuilder('t')
        .select('COALESCE(SUM(t.elapsed_ms), 0)', 'sum')
        .where('t.chart_id = :id', { id })
        .andWhere('t.user_id = :uid', { uid: user.id })
        .getRawOne<{ sum: string }>();
      myTimeMs = Number(myAgg?.sum ?? 0);
    }

    const { serviceLine, worklist, ...rest } = c;
    const cf = (rest.customFields ?? {}) as Record<string, any>;
    return {
      ...rest,
      // Viewer-computed priority bucket (see detail() head); the stored column
      // only matters as a manual override, already folded into computedPriority.
      priority: computedPriority ?? rest.priority,
      // The DB column is `dos`, but the frontend reads `dateOfService`.
      dateOfService: c.dos ?? null,
      serviceLineName: serviceLine?.name ?? null,
      coderTimeMs,
      myTimeMs,
      // ── List-parity enrichments so the detail header shows full info ──
      worklistNumber: worklist?.worklistNumber ?? null,
      clientName: worklist?.client?.name ?? null,
      locationName: worklist?.location?.name ?? null,
      specialityName: worklist?.primarySpeciality?.name ?? null,
      subSpecialityName:
        worklist?.subSpeciality?.name ?? (typeof cf.subSpeciality === 'string' ? cf.subSpeciality : null),
      processName: worklist?.process?.name ?? null,
      receivedDate: worklist?.receivedDate ?? null,
      allocatedCoderName: rest.allocatedCoderId ? userMap.get(Number(rest.allocatedCoderId))?.name ?? null : null,
      allocatedAuditorName: rest.allocatedAuditorId ? userMap.get(Number(rest.allocatedAuditorId))?.name ?? null : null,
      originalCoderName: rest.originalCoderId ? userMap.get(Number(rest.originalCoderId))?.name ?? null : null,
      originalAuditorName: rest.originalAuditorId ? userMap.get(Number(rest.originalAuditorId))?.name ?? null : null,
      allocatedCoderAvatarUrl: rest.allocatedCoderId ? userMap.get(Number(rest.allocatedCoderId))?.avatarUrl ?? null : null,
      allocatedAuditorAvatarUrl: rest.allocatedAuditorId ? userMap.get(Number(rest.allocatedAuditorId))?.avatarUrl ?? null : null,
      coderAllocatedAt,
      auditorAllocatedAt,
      // QC status is persisted under the _formDraft blob (see readFormDraftQc).
      qcStatus: this.readFormDraftQc(cf).coder,
      auditorQcStatus: this.readFormDraftQc(cf).auditor,
    };
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
  // `priority` is pulled out separately: a value here is an explicit user
  // override (Modify-Charts / the detail Priority select), applied via
  // setManualPriority so it wins over the computed bucket until the allocated
  // user touches the chart (§7.3). The frontend sends it only when changed.
  const { customFields, chartStatus: nextStatus, priority: nextPriority, ...flat } = dto;
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

  // Priority itself is no longer nudged by milestone/status here — it is
  // computed per viewer from the chart's milestone/status/QC/received-date
  // (see priority-rules.ts). The one exception is an explicit user override:
  if (nextPriority) c.setManualPriority(nextPriority as Priority);

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

  /**
   * Prev/next chart ids for the detail page's Previous/Next buttons.
   *
   * These follow the Charts grid's on-screen order rather than chart id: the
   * caller passes the grid's current filters/search/sort/priority-tab and we
   * return the chart immediately above ("previous") and below ("next") the
   * current one in that exact ordered, filtered set — spanning page boundaries.
   * See the method body for the scope/ordering details.
   */
  async neighbors(id: number, q: QueryChartsDto, user: AuthenticatedUser) {
    await this.requireChart(id);

    // Walk the SAME ordered result set the Charts grid is showing. The caller
    // replays the grid's current filters/search/sort/priority-tab, so we build
    // an identically-scoped, identically-ordered query (reusing list()'s filter
    // /priority/sort helpers) and read off the chart directly above and below
    // the current one. Because we order the whole filtered set — not one page —
    // "next"/"previous" span page boundaries automatically.
    const qb = this.charts
      .createQueryBuilder('c')
      // Plain joins (no select): the filter/sort helpers reference these aliases,
      // but we only need the ordered id list, not the relation data.
      .leftJoin('c.worklist', 'worklist')
      .leftJoin('worklist.client', 'client')
      .leftJoin('worklist.location', 'location')
      .leftJoin('worklist.primarySpeciality', 'primarySpeciality')
      .leftJoin('worklist.subSpeciality', 'subSpeciality')
      .leftJoin('worklist.process', 'process');

    // Role scope must match list(): only coders are pinned to their own queue;
    // auditors / team-leads / managers step through every chart the grid shows.
    if (user.role === Role.CODER) qb.andWhere('c.allocated_coder_id = :uid', { uid: user.id });

    this.excludeOrphanedCharts(qb);
    this.applyChartFilters(qb, q);
    const scopedToWorklist = (q.worklistId?.length ?? 0) > 0;
    this.applyPriorityScope(qb, user.role, q.priority, Number(user.id), !scopedToWorklist);
    this.applySort(qb, q.sortBy, q.sortDir, user.role);

    const rows = await qb.select('c.id', 'id').getRawMany<{ id: string }>();
    const ids = rows.map((r) => Number(r.id));
    const idx = ids.indexOf(id);
    // Current chart not in the filtered set (filters changed, or a deep-link
    // outside the current view) → no defined neighbors; buttons disable.
    if (idx === -1) return { prevId: null, nextId: null };
    return {
      prevId: idx > 0 ? ids[idx - 1] : null,
      nextId: idx < ids.length - 1 ? ids[idx + 1] : null,
    };
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

    // You can only time a chart that's allocated to you (as coder or auditor).
    // Admins/teamleads aren't exempt — they self-allocate the chart first.
    const allocatedToMe =
      Number(c.allocatedCoderId) === user.id || Number(c.allocatedAuditorId) === user.id;
    if (!allocatedToMe) {
      throw new ForbiddenException({
        error: {
          code: 'not_allocated',
          message: 'Self-allocate this chart to yourself to work on it.',
        },
      });
    }

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

    // A PAUSED chart still counts as the user's active work. Pause closes the
    // session, so the open-session guard above can't see it — find any chart the
    // user has paused (other than this one) and route them back to resume and
    // finish it before starting a different chart.
    const pausedElsewhere = await this.charts
      .createQueryBuilder('c')
      .where(`c.custom_fields -> 'timerPaused' ->> 'userId' = :uid`, { uid: String(user.id) })
      .andWhere('c.id != :id', { id })
      .getOne();
    if (pausedElsewhere) {
      throw new ConflictException({
        error: {
          code: 'timer_conflict',
          message: 'Another chart is paused. Resume and finish it before working on this chart.',
          activeChartId: String(pausedElsewhere.id),
          activeChartNo: pausedElsewhere.chartNo ?? null,
        },
      });
    }

    // Per-chart lock: only one person may run a timer on a chart at a time.
    // (At this point we know the caller has no open session, so any open
    // session on this chart belongs to someone else.)
    const busy = await this.timeLogs.findOne({
      where: { chartId: id, stoppedAt: IsNull() },
      order: { startedAt: 'ASC' },
    });
    if (busy) {
      const other = await this.users.findOne({ where: { id: Number(busy.userId) } });
      throw new ConflictException({
        error: {
          code: 'chart_busy',
          message: other?.fullName
            ? `${other.fullName} is already working on this chart.`
            : 'Someone is already working on this chart.',
          activeUserId: String(busy.userId),
          activeUserName: other?.fullName ?? null,
          startedAt: busy.startedAt.toISOString(),
        },
      });
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
    const canCode = user.role === Role.CODER || user.role === Role.TEAMLEAD || user.role === Role.MANAGER;
    const canAudit = user.role === Role.AUDITOR || user.role === Role.TEAMLEAD || user.role === Role.MANAGER;
    // Starting the timer is the allocated user "touching" the chart (§7.3): drop
    // any manual priority override so it reverts to its computed role bucket.
    let dirty = false;
    if (c.manualPriorityAt) { c.clearManualPriority(); dirty = true; }
    if (c.milestone === ChartMilestone.READY_TO_CODE && canCode) {
      c.setMilestone(ChartMilestone.CODING_IN_PROGRESS);
      dirty = true;
    } else if (c.milestone === ChartMilestone.READY_TO_AUDIT && canAudit) {
      c.setMilestone(ChartMilestone.AUDIT_IN_PROGRESS);
      dirty = true;
    }
    if (dirty) await this.charts.save(c);
    return { chartId: id, startedAt: startedAt.toISOString() };
  }

  async stopTimer(id: number, user: AuthenticatedUser) {
    const open = await this.timeLogs.findOne({
      where: { userId: user.id, chartId: id, stoppedAt: IsNull() },
    });

    // Stopping ends the work — clear any paused-break flag too. Handles "Stop"
    // pressed while paused (the session is already closed, only the flag remains).
    const wasPaused = await this.clearPausedFlag(id);

    if (!open) {
      if (wasPaused) return { chartId: id, elapsedMs: 0 };
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
   * Pause the user's running timer on this chart: close the open session (so
   * elapsed accrues) and flag the chart as paused. With no open session the
   * timer reads as "not running", which already locks the Chart/Processing/Audit
   * inputs and the Review & Edit modal; the paused flag additionally tells the
   * UI to lock Save and offer Resume. Milestone is untouched — a break is not a
   * handoff.
   */
  async pauseTimer(id: number, user: AuthenticatedUser) {
    const open = await this.timeLogs.findOne({
      where: { userId: user.id, chartId: id, stoppedAt: IsNull() },
    });
    if (!open) {
      throw new BadRequestException({ error: { code: 'bad_request', message: 'No active timer to pause.' } });
    }
    const stoppedAt = new Date();
    open.stoppedAt = stoppedAt;
    open.elapsedMs = stoppedAt.getTime() - open.startedAt.getTime();
    await this.timeLogs.save(open);

    const c = await this.charts.findOne({ where: { id } });
    if (c) {
      c.customFields = {
        ...(c.customFields ?? {}),
        timerPaused: { userId: user.id, at: stoppedAt.toISOString() },
      };
      await this.charts.save(c);
    }
    return { chartId: id, paused: true };
  }

  /** Resume a paused timer: clear the paused flag, then start a fresh session. */
  async resumeTimer(id: number, user: AuthenticatedUser) {
    await this.clearPausedFlag(id);
    return this.startTimer(id, user);
  }

  /** Remove the `timerPaused` marker from a chart's customFields. Returns true
   *  if a marker was present (i.e. the chart was paused). */
  private async clearPausedFlag(id: number): Promise<boolean> {
    const c = await this.charts.findOne({ where: { id } });
    const cf = (c?.customFields ?? {}) as Record<string, unknown>;
    if (!c || !cf.timerPaused) return false;
    const { timerPaused: _drop, ...rest } = cf;
    c.customFields = rest;
    await this.charts.save(c);
    return true;
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
    if (open) {
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
        paused: false,
      };
    }

    // No open session: a paused chart still counts as the user's active work
    // (Pause closes the session but keeps the chart flagged), so surface it here
    // too — the Charts page shows it and links back so the user can resume.
    const paused = await this.charts
      .createQueryBuilder('c')
      .where(`c.custom_fields -> 'timerPaused' ->> 'userId' = :uid`, { uid: String(user.id) })
      .getOne();
    if (!paused) return null;
    const totalRow = await this.timeLogs
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.elapsed_ms), 0)', 'sum')
      .where('t.chart_id = :cid', { cid: paused.id })
      .andWhere('t.user_id = :uid', { uid: user.id })
      .getRawOne<{ sum: string }>();
    const pausedAt = (paused.customFields as Record<string, any>)?.timerPaused?.at ?? null;
    return {
      chartId: String(paused.id),
      chartNo: paused.chartNo ?? null,
      worklistId: String(paused.worklistId),
      milestone: paused.milestone,
      startedAt: pausedAt ?? new Date().toISOString(),
      elapsedMs: Number(totalRow?.sum ?? 0),
      paused: true,
    };
  }

  /**
   * Time logged on a chart for the chart-detail Time Tracker, as INDIVIDUAL
   * sessions — one row per start→stop, NOT summed per user. The same user
   * opening and closing the timer several times shows up as several rows.
   * A still-running session reports its live elapsed and `running: true`.
   * Newest session first.
   */
  async chartTimeSessions(id: number) {
    const c = await this.charts.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    const rows = await this.dataSource.query(
      `
      SELECT
        t.id AS "id",
        t.user_id AS "userId",
        u.full_name AS "userName",
        u.role AS "role",
        u.avatar_url AS "avatarUrl",
        t.kind AS "kind",
        t.started_at AS "startedAt",
        t.stopped_at AS "stoppedAt",
        CASE WHEN t.stopped_at IS NULL
          THEN EXTRACT(EPOCH FROM (now() - t.started_at)) * 1000
          ELSE t.elapsed_ms END AS "elapsedMs",
        (t.stopped_at IS NULL) AS "running"
      FROM chart_time_logs t
      LEFT JOIN users u ON u.id = t.user_id
      WHERE t.chart_id = $1
      ORDER BY t.started_at DESC, t.id DESC
      `,
      [id],
    );
    return {
      entries: rows.map((r: any) => ({
        id: Number(r.id),
        userId: Number(r.userId),
        userName: r.userName ?? null,
        role: r.role ?? null,
        avatarUrl: r.avatarUrl ?? null,
        kind: r.kind,
        startedAt: r.startedAt,
        stoppedAt: r.stoppedAt,
        elapsedMs: Math.round(Number(r.elapsedMs ?? 0)),
        running: r.running === true || r.running === 't',
      })),
    };
  }

  async bulkModify(dto: BulkModifyDto) {
    const updatedCharts = await this.charts.findBy({ id: In(dto.chartIds) });
    if (updatedCharts.length === 0) return { updated: 0 };
    for (const c of updatedCharts) {
      // serviceLineId is explicitly nullable: undefined = leave as-is, null =
      // clear, number = set. So check `!== undefined`, not truthiness.
      if (dto.serviceLineId !== undefined) c.serviceLineId = dto.serviceLineId;
      if (dto.allocation && dto.allocation.action !== 'NONE') {
        if (dto.allocation.action === 'ALLOCATE_CODING' && dto.allocation.assigneeId) {
          c.allocatedCoderId = dto.allocation.assigneeId;
          // Fresh coder allocation → LOW priority bucket (mirrors worklist-allocate).
          c.markCoderAllocated();
          // First coder allocation lifts the chart out of "Ready to allocate"
          // into the coding queue (mirrors the worklist-allocate path).
          if (c.milestone === ChartMilestone.READY_TO_ALLOCATE) c.setMilestone(ChartMilestone.READY_TO_CODE);
        }
        if (dto.allocation.action === 'ALLOCATE_AUDITING' && dto.allocation.assigneeId) {
          c.allocatedAuditorId = dto.allocation.assigneeId;
          // Allocating an auditor to a *finished* chart moves it into the audit
          // queue. Only from CODING_DONE — coding must complete before audit.
          if (c.milestone === ChartMilestone.CODING_DONE) c.setMilestone(ChartMilestone.READY_TO_AUDIT);
        }
        if (dto.allocation.action === 'REALLOCATE_TO_ORIGINAL_CODER') {
          c.allocatedCoderId = c.originalCoderId ?? c.allocatedCoderId;
          c.markCoderAllocated();
        }
      }
      // A bulk priority choice is a manual override (§7.3): it pins the chart to
      // that bucket until the allocated user touches it, then reverts to the
      // computed default. Applied last so it wins over anything above.
      if (dto.priority) c.setManualPriority(dto.priority as Priority);
    }
    await this.charts.save(updatedCharts);
    return { updated: updatedCharts.length };
  }

  async selfAllocate(chartIds: number[], user: AuthenticatedUser) {
    const cs = await this.charts.findBy({ id: In(chartIds) });

    // A chart someone ELSE is actively timing can't be taken (they're working
    // on it). The caller's own running timer doesn't block them.
    const openRows = chartIds.length
      ? await this.timeLogs.find({ where: { chartId: In(chartIds), stoppedAt: IsNull() } })
      : [];
    const busyIds = new Set(
      openRows.filter((r) => Number(r.userId) !== user.id).map((r) => Number(r.chartId)),
    );

    const allocatedIds: number[] = [];
    const skipped: Array<{ chartId: number; reason: string }> = [];
    const toSave: Chart[] = [];
    for (const c of cs) {
      if (busyIds.has(Number(c.id))) {
        skipped.push({ chartId: Number(c.id), reason: 'Someone is already working on this chart.' });
        continue;
      }
      if (user.role === Role.CODER) {
        c.allocatedCoderId = user.id;
      } else if (user.role === Role.AUDITOR) {
        c.allocatedAuditorId = user.id;
      } else if (user.role === Role.TEAMLEAD || user.role === Role.MANAGER) {
        // Team lead / manager take BOTH slots so they can code and audit the chart.
        c.allocatedCoderId = user.id;
        c.allocatedAuditorId = user.id;
      }
      // Self-allocation drives the milestone like the worklist-allocate path:
      // taking the coder slot lifts READY_TO_ALLOCATE → READY_TO_CODE; taking the
      // auditor slot on a finished chart moves CODING_DONE → READY_TO_AUDIT.
      const setsCoder = user.role !== Role.AUDITOR; // coder / teamlead / manager
      const setsAuditor = user.role !== Role.CODER; // auditor / teamlead / manager
      // Taking the coder slot is a fresh coder allocation → LOW priority bucket.
      if (setsCoder) c.markCoderAllocated();
      if (setsCoder && c.milestone === ChartMilestone.READY_TO_ALLOCATE) {
        c.setMilestone(ChartMilestone.READY_TO_CODE);
      }
      if (setsAuditor && c.milestone === ChartMilestone.CODING_DONE) {
        c.setMilestone(ChartMilestone.READY_TO_AUDIT);
      }
      toSave.push(c);
      allocatedIds.push(Number(c.id));
    }
    if (toSave.length) await this.charts.save(toSave);
    return { allocated: allocatedIds.length, allocatedIds, skipped };
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
    // Resolve the author (auditor) relation so the Conversation Log can show
    // who wrote each comment — the raw entity only carries auditor_id, which
    // the frontend reads as createdByUserId/createdByUserName.
    const rows = await this.feedbacks.find({
      where: { chartId },
      relations: { auditor: true },
      order: { createdAt: 'DESC' },
    });
    return rows.map(({ auditor, ...rest }) => ({
      ...rest,
      createdByUserId: rest.auditorId != null ? String(rest.auditorId) : null,
      createdByUserName: auditor?.fullName ?? null,
      createdByAvatarUrl: auditor?.avatarUrl ?? null,
    }));
  }

  async addFeedback(chartId: number, dto: ChartFeedbackDto, user: AuthenticatedUser) {
    const chart = await this.charts.findOne({ where: { id: chartId } });
    if (!chart) throw new NotFoundException();
    const f = await this.feedbacks.save(this.feedbacks.create({ chartId, auditorId: user.id, ...dto }));
    // A REVIEWER's comment (auditor / team lead) resurfaces the chart for the
    // coder: pin it HIGH as a manual override (unless Critical) so it leaves any
    // "done" state and shows on the coder's queue, reverting once the coder
    // touches it. A coder's own Conversation Log comment must NOT escalate their
    // chart, so the bump is gated to reviewers.
    const isReviewer = user.role === Role.AUDITOR || user.role === Role.TEAMLEAD;
    if (isReviewer && chart.priority !== Priority.CRITICAL) {
      chart.setManualPriority(Priority.HIGH);
      await this.charts.save(chart);
    }
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
    // Load the service line and the worklist's sub-speciality so both names
    // can be forwarded to the AI gateway.
    const c = await this.charts.findOne({
      where: { id },
      relations: { serviceLine: true, worklist: { subSpeciality: true } },
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
      // The chart's sub-speciality (from its worklist; falls back to the
      // per-chart customFields value) — forwarded as `sub_speciality` so the
      // gateway can apply speciality-tuned RAG. Renamed from primary_speciality
      // on 2026-06-16; see encounter_primary_speciality_change.md.
      subSpeciality: this.optionalString(
        c.worklist?.subSpeciality?.name ??
          (typeof c.customFields?.subSpeciality === 'string' ? c.customFields.subSpeciality : undefined),
      ),
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
      relations: { serviceLine: true, worklist: { subSpeciality: true } },
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
      // The chart's sub-speciality (from its worklist; falls back to the
      // per-chart customFields value) — forwarded as `sub_speciality` so the
      // gateway can apply speciality-tuned RAG. Renamed from primary_speciality
      // on 2026-06-16; see encounter_primary_speciality_change.md.
      subSpeciality: this.optionalString(
        c.worklist?.subSpeciality?.name ??
          (typeof c.customFields?.subSpeciality === 'string' ? c.customFields.subSpeciality : undefined),
      ),
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

  /* ── Per-code auditor audits ──────────────────────────────────────────
   * An auditor's Agree/Disagree judgment of each coder decision, layered on
   * top of chart_code_decisions WITHOUT mutating it — so the AI prediction,
   * the coder edit and the audit verdict can all be shown together in the
   * Review & Edit modal. One audit per (chart, codeType, codeValue); submit
   * upserts on that key. Internal QA only — not forwarded to the AI gateway. */

  async listCodeAudits(chartId: number) {
    await this.requireChart(chartId);
    const rows = await this.codeAudits.find({
      where: { chartId },
      order: { codeType: 'ASC', codeValue: 'ASC' },
    });
    return {
      items: rows.map((r) => ({
        id: Number(r.id),
        chartCodeDecisionId: r.chartCodeDecisionId != null ? Number(r.chartCodeDecisionId) : undefined,
        codeType: r.codeType,
        codeValue: r.codeValue,
        verdict: r.verdict,
        feedbackCategory: r.feedbackCategory ?? undefined,
        feedbackText: r.feedbackText ?? undefined,
        auditedByUserId: Number(r.auditedByUserId),
        auditedAt: r.auditedAt,
      })),
    };
  }

  async submitCodeAudits(
    chartId: number,
    dto: SubmitCodeAuditsDto,
    user: AuthenticatedUser,
  ) {
    await this.requireChart(chartId);

    // Dedupe by (codeType, codeValue) — the unique index would otherwise reject
    // the second-onwards rows. First wins.
    const seenKeys = new Set<string>();
    const uniqueAudits: typeof dto.audits = [];
    for (const a of dto.audits) {
      const key = `${a.codeType}|${a.codeValue}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      uniqueAudits.push(a);
    }

    // Validate up front so a bad row fails the whole batch (atomic write below).
    for (const a of uniqueAudits) {
      const key = `${a.codeType}|${a.codeValue}`;
      if (a.verdict === CodeAuditVerdict.DISAGREE) {
        if (!(a.feedbackCategory ?? '').trim()) {
          throw new BadRequestException({
            error: { code: 'invalid_argument', message: `feedbackCategory is required when verdict is DISAGREE for ${key}.` },
          });
        }
        if ((a.feedbackText ?? '').trim().length < 20) {
          throw new BadRequestException({
            error: { code: 'invalid_argument', message: `feedbackText must be at least 20 characters when verdict is DISAGREE for ${key}.` },
          });
        }
      }
    }

    const now = new Date();
    // Atomic write: either every audit persists or none does.
    const saved = await this.dataSource.transaction(async (manager) => {
      const auditsRepo = manager.getRepository(ChartCodeAudit);
      const rows: ChartCodeAudit[] = [];
      for (const a of uniqueAudits) {
        const existing = await auditsRepo.findOne({
          where: { chartId, codeType: a.codeType, codeValue: a.codeValue },
        });
        // AGREE clears any prior feedback; DISAGREE carries category + note.
        const isDisagree = a.verdict === CodeAuditVerdict.DISAGREE;
        const payload: Partial<ChartCodeAudit> = {
          chartId,
          chartCodeDecisionId: a.chartCodeDecisionId ?? existing?.chartCodeDecisionId ?? null,
          codeType: a.codeType,
          codeValue: a.codeValue,
          verdict: a.verdict,
          feedbackCategory: isDisagree ? (a.feedbackCategory ?? '').trim() : null,
          feedbackText: isDisagree ? (a.feedbackText ?? '').trim() : null,
          auditedByUserId: user.id,
          auditedAt: now,
        };
        if (existing) {
          await auditsRepo.update({ id: existing.id }, payload);
          const reloaded = await auditsRepo.findOne({ where: { id: existing.id } });
          if (reloaded) rows.push(reloaded);
        } else {
          const created = await auditsRepo.save(auditsRepo.create(payload));
          rows.push(created);
        }
      }
      // The submit supersedes the auditor's autosaved working state — clear
      // their draft in the same transaction so a refresh can't resurrect it.
      // (The auditor's draft is a separate per-user row from the coder's.)
      await manager.getRepository(ChartCodeDecisionDraft).delete({ chartId, userId: user.id });

      // Any disagreement sends the chart back to the coder: restore the coder
      // slot (kept as-is when still held; falls back to the first-ever coder if
      // a teamlead/manager self-allocate overwrote it or it was cleared) and
      // pin priority HIGH (manual override) so it resurfaces on the coder's
      // queue, reverting to the computed bucket once the coder touches it. An
      // all-AGREE audit changes nothing — there is no rework for the coder.
      if (uniqueAudits.some((a) => a.verdict === CodeAuditVerdict.DISAGREE)) {
        const chartsRepo = manager.getRepository(Chart);
        const chart = await chartsRepo.findOne({ where: { id: chartId } });
        if (chart) {
          chart.allocatedCoderId = chart.allocatedCoderId ?? chart.originalCoderId;
          chart.markCoderAllocated();
          if (chart.priority !== Priority.CRITICAL) chart.setManualPriority(Priority.HIGH);
          await chartsRepo.save(chart);
        }
      }
      return rows;
    });

    return {
      items: saved.map((r) => ({
        id: Number(r.id),
        chartCodeDecisionId: r.chartCodeDecisionId != null ? Number(r.chartCodeDecisionId) : undefined,
        codeType: r.codeType,
        codeValue: r.codeValue,
        verdict: r.verdict,
        feedbackCategory: r.feedbackCategory ?? undefined,
        feedbackText: r.feedbackText ?? undefined,
        auditedByUserId: Number(r.auditedByUserId),
        auditedAt: r.auditedAt,
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

  async getCodeDecisionDraft(chartId: number, user: AuthenticatedUser, targetUserId?: number) {
    await this.requireChart(chartId);
    // By default a user only ever reads their OWN draft. QA Live lets a Team
    // Lead / Manager peek at a specific coder's in-progress draft, so allow an
    // explicit other-user lookup — but only for those QA roles.
    let ownerId = user.id;
    if (targetUserId != null && targetUserId !== user.id) {
      if (user.role !== Role.TEAMLEAD && user.role !== Role.MANAGER) {
        throw new ForbiddenException({
          error: { code: 'forbidden', message: "Not allowed to view another user's draft." },
        });
      }
      ownerId = targetUserId;
    }
    const row = await this.decisionDrafts.findOne({ where: { chartId, userId: ownerId } });
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
      // Drop stale "moved-from" rows. Changing a code's category saves it under
      // a NEW code_type, leaving the old (code_type, code) row behind — a phantom
      // decision under the category the coder moved it OUT of. Now that this
      // submission is written, delete any other row for the SAME codes whose
      // code_type wasn't part of this submission, so each code carries exactly
      // the decisions the coder just made and the table stays the single source
      // of truth. (A code legitimately submitted under two categories keeps both,
      // since both keys are present; codes absent from this submission are left
      // untouched.)
      const submittedValues = [...new Set(dto.decisions.map((d) => d.codeValue))];
      if (submittedValues.length) {
        const keepKeys = new Set(dto.decisions.map((d) => `${d.codeType}|${d.codeValue}`));
        const existingForCodes = await decisionsRepo.find({
          where: { chartId, codeValue: In(submittedValues) },
        });
        const staleIds = existingForCodes
          .filter((row) => !keepKeys.has(`${row.codeType}|${row.codeValue}`))
          .map((row) => row.id);
        if (staleIds.length) await decisionsRepo.delete(staleIds);
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
    // Self-heal the persisted snapshot so the offline fallback and every other
    // reader of customFields.aiPrediction (the sidebar's snapshot path, list
    // filters, analytics) converge on the gateway's CURRENT codes — the write-
    // once snapshot is what let the two surfaces drift in the first place.
    // Best-effort: a sync failure must never break this read. (A gateway error
    // already threw above, so we never sync stale codes — the old snapshot
    // stands.) See docs/AI_CODES_SINGLE_SOURCE_FIX.md.
    try {
      await this.syncAiPredictionSnapshot(chartId, encounterId, codes, chart);
    } catch (err) {
      this.log.warn(`chart=${chartId} aiPrediction snapshot sync skipped: ${(err as Error).message}`);
    }
    return { codes, encounterId };
  }

  /** Re-shape the gateway's review codes into the snapshot's
   * `customFields.aiPrediction` layout: bucketed into primary/secondary/
   * procedures (cpt folds into procedures), deduped by (bucket, code), and
   * ordered deterministically by sequence position so repeated syncs of the
   * same codes produce an identical array (no write churn). Each code keeps its
   * gateway UUID as `predictedCodeId`. Mirrors the frontend `useChartAiCodes`
   * mapping so the snapshot fallback is byte-identical to the live source. */
  private bucketGatewayCodes(rows: PredictedCodeReviewItem[]) {
    const toCode = (r: PredictedCodeReviewItem) => ({
      code: r.icd_code,
      description: r.description,
      confidence: r.confidence,
      codeType: r.code_type,
      sequencePos: r.sequence_pos ?? null,
      justification: (r.evidence_json as { justification?: string } | null)?.justification,
      predictedCodeId: r.id,
    });
    const primary: ReturnType<typeof toCode>[] = [];
    const secondary: ReturnType<typeof toCode>[] = [];
    const procedures: ReturnType<typeof toCode>[] = [];
    const sorted = [...rows].sort(
      (a, b) =>
        (a.sequence_pos ?? Number.MAX_SAFE_INTEGER) - (b.sequence_pos ?? Number.MAX_SAFE_INTEGER) ||
        (a.icd_code ?? '').localeCompare(b.icd_code ?? ''),
    );
    const seen = new Set<string>();
    for (const r of sorted) {
      const t = (r.code_type ?? '').toLowerCase();
      const bucket =
        t === 'primary' ? primary :
        t === 'secondary' ? secondary :
        t === 'procedure' || t === 'cpt' ? procedures :
        null;
      if (!bucket) continue;
      const key = `${t}|${(r.icd_code ?? '').replace(/\./g, '').trim().toUpperCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      bucket.push(toCode(r));
    }
    return { primary, secondary, procedures, codes: [...primary, ...secondary, ...procedures] };
  }

  /** Order-sensitive deep-equal over the snapshot's code identity fields. Used
   * to skip the write when the gateway codes haven't actually changed. */
  private codesEqual(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
    const canon = (arr: unknown[] | undefined) =>
      JSON.stringify(
        (arr ?? []).map((c) => {
          const x = c as Record<string, unknown>;
          return [x.code, x.description, x.codeType ?? null, x.confidence ?? null, x.sequencePos ?? null, x.predictedCodeId ?? null];
        }),
      );
    return canon(a) === canon(b);
  }

  /** Re-persist the gateway's codes into `customFields.aiPrediction` so the
   * snapshot stays current. Preserves the narrative/timing fields the codes
   * endpoint doesn't return (clinicalSummary, auditNotes, codingTips,
   * complianceAlerts, documentationGaps, physicianQueries, *At timings).
   * Re-read → merge → save (mirrors AiPipelineWatcher#finalize) so a concurrent
   * edit to other customFields keys is never stomped; only writes when the
   * codes changed, and only onto an existing snapshot for THIS encounter (never
   * fabricates one, never writes a stale encounter over a newer prediction). */
  private async syncAiPredictionSnapshot(
    chartId: number,
    encounterId: string,
    gatewayCodes: PredictedCodeReviewItem[],
    loaded?: Chart,
  ): Promise<void> {
    const { primary, secondary, procedures, codes } = this.bucketGatewayCodes(gatewayCodes);

    // Cheap pre-check against the already-loaded row — the steady state after
    // the first heal — to skip the extra re-read + write entirely.
    const cur = (loaded?.customFields as Record<string, any> | undefined)?.aiPrediction as
      | { encounterId?: string; codes?: unknown[] }
      | undefined;
    if (cur && cur.encounterId === encounterId && this.codesEqual(cur.codes, codes)) return;

    const fresh = await this.charts.findOne({ where: { id: chartId } });
    if (!fresh) return;
    const cf = (fresh.customFields ?? {}) as Record<string, any>;
    const prev = cf.aiPrediction as { encounterId?: string; codes?: unknown[] } | undefined;
    // Guard the race: a finalize may have written a newer prediction between our
    // read and now. Only heal an existing snapshot for the same encounter.
    if (!prev || prev.encounterId !== encounterId) return;
    if (this.codesEqual(prev.codes, codes)) return;

    fresh.customFields = {
      ...cf,
      aiPrediction: {
        ...prev,
        codes,
        primary,
        secondary,
        procedures,
        codesSyncedAt: new Date().toISOString(),
      },
    };
    await this.charts.save(fresh);
    this.log.log(
      `chart=${chartId} encounter=${encounterId} aiPrediction snapshot synced (${codes.length} codes).`,
    );
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
