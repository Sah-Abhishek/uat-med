import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { Worklist } from '../../entities/worklist.entity';
import { Chart } from '../../entities/chart.entity';
import { ChartFeedback } from '../../entities/chart-feedback.entity';
import { ChartMilestone, ChartStatus, WorklistStatus } from '../../common/enums';
import { AuthenticatedUser } from '../../common/types/request-user.type';
import { Role } from '../../common/enums/roles.enum';

/** Number of trailing days the time-series panels report. */
const SERIES_DAYS = 14;

interface FilterQuery {
  clientId?: number;
  locationId?: number;
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Worklist) private readonly worklists: Repository<Worklist>,
    @InjectRepository(Chart) private readonly charts: Repository<Chart>,
    @InjectRepository(ChartFeedback) private readonly feedback: Repository<ChartFeedback>,
  ) {}

  /* ── Top-of-page tiles (existing) ─────────────────────── */

  async milestones(q: FilterQuery) {
    const qb = this.charts.createQueryBuilder('c')
      .select('c.milestone', 'm').addSelect('COUNT(*)', 'n')
      .where('c.deleted_at IS NULL')
      .groupBy('c.milestone');
    const rows = await this.scopeCharts(qb, q).getRawMany();
    const map = Object.fromEntries(rows.map(r => [r.m, Number(r.n)]));
    return {
      inProgress: (map[ChartMilestone.CODING_IN_PROGRESS] ?? 0) + (map[ChartMilestone.AUDIT_IN_PROGRESS] ?? 0),
      readyToCode: map[ChartMilestone.READY_TO_CODE] ?? 0,
      readyToAllocate: map[ChartMilestone.READY_TO_ALLOCATE] ?? 0,
    };
  }

  async status(q: FilterQuery) {
    const qb = this.charts.createQueryBuilder('c')
      .select('c.chart_status', 's').addSelect('COUNT(*)', 'n')
      .where('c.deleted_at IS NULL')
      .groupBy('c.chart_status');
    const rows = await this.scopeCharts(qb, q).getRawMany();
    const map = Object.fromEntries(rows.map(r => [r.s, Number(r.n)]));
    return { complete: map[ChartStatus.COMPLETE] ?? 0, incomplete: map[ChartStatus.INCOMPLETE] ?? 0 };
  }

  async unallocated(q: FilterQuery) {
    const wlBase = this.scopeWorklists(this.worklists.createQueryBuilder('w'), q);
    const totalWorklists = await wlBase.clone().getCount();
    const unallocWorklists = await wlBase.clone().andWhere('w.status = :s', { s: WorklistStatus.OPEN }).getCount();

    const cBase = this.scopeCharts(this.charts.createQueryBuilder('c'), q).andWhere('c.deleted_at IS NULL');
    const totalCharts = await cBase.clone().getCount();
    const unallocCharts = await cBase.clone().andWhere('c.allocated_coder_id IS NULL').getCount();

    return {
      worklists: { unallocated: unallocWorklists, total: totalWorklists },
      charts:    { unallocated: unallocCharts,    total: totalCharts    },
    };
  }

  /* ── Allocation Statistics panel ──────────────────────── */
  /**
   * Five chart panels worth of data:
   *   - chartsByMilestone   : horizontal bar
   *   - chartCompletion     : donut (Complete / Incomplete / Open / Hold)
   *   - qualityControl      : donut (audit feedback statuses + Unaudited)
   *   - worklistByStatus    : donut (Open / In Progress / Closed)
   *   - progressToDate      : line/area, charts that hit CLOSED per day for the
   *                           last SERIES_DAYS days (uses chart.updated_at as
   *                           the closed-at timestamp since we don't track
   *                           per-milestone history)
   */
  async allocationStats(q: FilterQuery) {
    // 1. Charts by milestone
    const byMilestoneRows = await this.scopeCharts(
      this.charts.createQueryBuilder('c').where('c.deleted_at IS NULL'),
      q,
    )
      .select('c.milestone', 'milestone')
      .addSelect('COUNT(*)', 'count')
      .groupBy('c.milestone')
      .getRawMany();

    const chartsByMilestone = Object.values(ChartMilestone).map(m => ({
      milestone: m,
      count: Number(byMilestoneRows.find(r => r.milestone === m)?.count ?? 0),
    }));

    // 2. Chart completion donut
    const byStatusRows = await this.scopeCharts(
      this.charts.createQueryBuilder('c').where('c.deleted_at IS NULL'),
      q,
    )
      .select('c.chart_status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('c.chart_status')
      .getRawMany();
    const statusMap = Object.fromEntries(byStatusRows.map(r => [r.status, Number(r.count)]));
    const chartCompletion = {
      complete:   statusMap[ChartStatus.COMPLETE]   ?? 0,
      incomplete: statusMap[ChartStatus.INCOMPLETE] ?? 0,
      open:       statusMap[ChartStatus.OPEN]       ?? 0,
      hold:       statusMap[ChartStatus.HOLD]       ?? 0,
    };

    // 3. Quality control donut — counts by feedback_status, plus "Unaudited"
    //    = charts in CODING_DONE / AUDIT_DONE / CLOSED with no feedback row.
    const fbRows = await this.feedback.createQueryBuilder('f')
      .select('f.feedback_status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('f.feedback_status')
      .getRawMany();
    const fbMap = Object.fromEntries(fbRows.map(r => [r.status, Number(r.count)]));

    const auditableTotal = await this.scopeCharts(
      this.charts.createQueryBuilder('c').where('c.deleted_at IS NULL'),
      q,
    )
      .andWhere('c.milestone IN (:...ms)', {
        ms: [ChartMilestone.CODING_DONE, ChartMilestone.AUDIT_DONE, ChartMilestone.CLOSED],
      })
      .getCount();
    const audited = (fbMap['Feedback Provided'] ?? 0) + (fbMap['Agree'] ?? 0)
      + (fbMap['Feedback Rejected'] ?? 0) + (fbMap['Feedback Implemented'] ?? 0);
    const qualityControl = {
      feedbackProvided:    fbMap['Feedback Provided']    ?? 0,
      agree:               fbMap['Agree']                ?? 0,
      feedbackRejected:    fbMap['Feedback Rejected']    ?? 0,
      feedbackImplemented: fbMap['Feedback Implemented'] ?? 0,
      unaudited:           Math.max(0, auditableTotal - audited),
    };

    // 4. Worklist-by-status donut
    const wlRows = await this.scopeWorklists(
      this.worklists.createQueryBuilder('w'),
      q,
    )
      .select('w.status', 'status').addSelect('COUNT(*)', 'count').groupBy('w.status')
      .getRawMany();
    const wlMap = Object.fromEntries(wlRows.map(r => [r.status, Number(r.count)]));
    const worklistByStatus = {
      open:       wlMap[WorklistStatus.OPEN]        ?? 0,
      inProgress: wlMap[WorklistStatus.IN_PROGRESS] ?? 0,
      closed:     wlMap[WorklistStatus.CLOSED]      ?? 0,
    };

    // 5. Progress to date — daily count of charts that closed in the window.
    const since = startOfDayMinusDays(SERIES_DAYS - 1);
    const progressRows = await this.scopeCharts(
      this.charts.createQueryBuilder('c').where('c.deleted_at IS NULL'),
      q,
    )
      .andWhere('c.milestone = :m', { m: ChartMilestone.CLOSED })
      .andWhere('c.updated_at >= :since', { since })
      .select(`DATE_TRUNC('day', c.updated_at)::date`, 'date')
      .addSelect('COUNT(*)', 'count')
      .groupBy('date')
      .orderBy('date', 'ASC')
      .getRawMany();

    return {
      chartsByMilestone,
      chartCompletion,
      qualityControl,
      worklistByStatus,
      progressToDate: fillDateSeries(progressRows, SERIES_DAYS),
    };
  }

  /* ── Unallocated Volume panel ─────────────────────────── */
  /**
   * Returns four breakdowns of unallocated charts (allocated_coder_id IS NULL):
   *   - byWorklist     : top 10 worklists with most unallocated charts
   *   - bySpeciality   : grouped by primary speciality
   *   - byReceivedDate : last SERIES_DAYS days, by worklist.received_date
   *   - byDateOfService: last SERIES_DAYS days, by chart.dos
   */
  async unallocatedVolume(q: FilterQuery) {
    const since = startOfDayMinusDays(SERIES_DAYS - 1);

    const byWorklist = await this.scopeCharts(
      this.charts.createQueryBuilder('c')
        .innerJoin('worklists', 'w', 'w.id = c.worklist_id')
        .where('c.deleted_at IS NULL')
        .andWhere('c.allocated_coder_id IS NULL'),
      q,
    )
      .select('w.worklist_number', 'worklist')
      .addSelect('COUNT(*)', 'count')
      .groupBy('w.worklist_number')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany();

    const bySpeciality = await this.scopeCharts(
      this.charts.createQueryBuilder('c')
        .innerJoin('worklists', 'w', 'w.id = c.worklist_id')
        .leftJoin('primary_specialities', 'ps', 'ps.id = w.primary_speciality_id')
        .where('c.deleted_at IS NULL')
        .andWhere('c.allocated_coder_id IS NULL'),
      q,
    )
      .select(`COALESCE(ps.name, 'Unspecified')`, 'speciality')
      .addSelect('COUNT(*)', 'count')
      .groupBy('speciality')
      .orderBy('count', 'DESC')
      .getRawMany();

    const byReceivedRows = await this.scopeCharts(
      this.charts.createQueryBuilder('c')
        .innerJoin('worklists', 'w', 'w.id = c.worklist_id')
        .where('c.deleted_at IS NULL')
        .andWhere('c.allocated_coder_id IS NULL')
        .andWhere('w.received_date >= :since', { since: since.toISOString().slice(0, 10) }),
      q,
    )
      .select('w.received_date', 'date')
      .addSelect('COUNT(*)', 'count')
      .groupBy('w.received_date')
      .orderBy('date', 'ASC')
      .getRawMany();

    const byDosRows = await this.scopeCharts(
      this.charts.createQueryBuilder('c')
        .where('c.deleted_at IS NULL')
        .andWhere('c.allocated_coder_id IS NULL')
        .andWhere('c.dos >= :since', { since: since.toISOString().slice(0, 10) }),
      q,
    )
      .select('c.dos', 'date')
      .addSelect('COUNT(*)', 'count')
      .groupBy('c.dos')
      .orderBy('date', 'ASC')
      .getRawMany();

    return {
      byWorklist:    byWorklist.map(r => ({ worklist: r.worklist, count: Number(r.count) })),
      bySpeciality:  bySpeciality.map(r => ({ speciality: r.speciality, count: Number(r.count) })),
      byReceivedDate: fillDateSeries(byReceivedRows, SERIES_DAYS),
      byDateOfService: fillDateSeries(byDosRows, SERIES_DAYS),
    };
  }

  /* ── Productivity panel ───────────────────────────────── */
  /**
   * Three productivity panels:
   *   - volumePerDay    : closed-charts-per-day for last SERIES_DAYS days
   *   - avgCodingMinutes: avg (updated_at - created_at) in minutes for charts
   *                       that closed each day. Approximate — relies on the
   *                       chart's create→close lifecycle since we don't store
   *                       per-state timestamps.
   *   - reworkCount     : INCOMPLETE charts that were already coded once,
   *                       i.e. original_coder_id is set. Best proxy without
   *                       a milestone audit trail.
   */
  async productivity(q: FilterQuery) {
    const since = startOfDayMinusDays(SERIES_DAYS - 1);

    const volumeRows = await this.scopeCharts(
      this.charts.createQueryBuilder('c').where('c.deleted_at IS NULL'),
      q,
    )
      .andWhere('c.milestone = :m', { m: ChartMilestone.CLOSED })
      .andWhere('c.updated_at >= :since', { since })
      .select(`DATE_TRUNC('day', c.updated_at)::date`, 'date')
      .addSelect('COUNT(*)', 'count')
      .groupBy('date')
      .orderBy('date', 'ASC')
      .getRawMany();

    const avgRows = await this.scopeCharts(
      this.charts.createQueryBuilder('c').where('c.deleted_at IS NULL'),
      q,
    )
      .andWhere('c.milestone = :m', { m: ChartMilestone.CLOSED })
      .andWhere('c.updated_at >= :since', { since })
      .select(`DATE_TRUNC('day', c.updated_at)::date`, 'date')
      .addSelect(`AVG(EXTRACT(EPOCH FROM (c.updated_at - c.created_at)) / 60.0)`, 'minutes')
      .groupBy('date')
      .orderBy('date', 'ASC')
      .getRawMany();

    const reworkCount = await this.scopeCharts(
      this.charts.createQueryBuilder('c').where('c.deleted_at IS NULL'),
      q,
    )
      .andWhere('c.chart_status = :s', { s: ChartStatus.INCOMPLETE })
      .andWhere('c.original_coder_id IS NOT NULL')
      .getCount();

    return {
      volumePerDay: fillDateSeries(volumeRows, SERIES_DAYS),
      avgCodingMinutes: fillNumericDateSeries(avgRows, SERIES_DAYS, 'minutes'),
      reworkCount,
    };
  }

  /* ── Self view (coder/auditor) ────────────────────────── */

  async self(user: AuthenticatedUser) {
    const qb = this.charts.createQueryBuilder('c').where('c.deleted_at IS NULL');
    if (user.role === Role.CODER) qb.andWhere('c.allocated_coder_id = :uid', { uid: user.id });
    else if (user.role === Role.AUDITOR) qb.andWhere('c.allocated_auditor_id = :uid', { uid: user.id });

    // "Today" filters use the dedicated `milestone_changed_at` /
    // `chart_status_changed_at` columns, which are stamped only when those
    // fields actually change. The general `updated_at` column is bumped by
    // any save (priority bumps, AI prediction writes, allocation churn) and
    // would over-count work that didn't happen today.
    const today = startOfDayMinusDays(0);
    const readyToCode = await qb.clone().andWhere('c.milestone = :m', { m: ChartMilestone.READY_TO_CODE }).getCount();
    const readyToAudit = await qb.clone().andWhere('c.milestone = :m', { m: ChartMilestone.READY_TO_AUDIT }).getCount();
    const codingDoneToday = await qb.clone()
      .andWhere('c.milestone = :m', { m: ChartMilestone.CODING_DONE })
      .andWhere('c.milestone_changed_at >= :t', { t: today })
      .getCount();
    const auditDoneToday = await qb.clone()
      .andWhere('c.milestone = :m', { m: ChartMilestone.AUDIT_DONE })
      .andWhere('c.milestone_changed_at >= :t', { t: today })
      .getCount();
    const completeToday = await qb.clone()
      .andWhere('c.chart_status = :s', { s: ChartStatus.COMPLETE })
      .andWhere('c.chart_status_changed_at >= :t', { t: today })
      .getCount();
    const incompleteToday = await qb.clone()
      .andWhere('c.chart_status = :s', { s: ChartStatus.INCOMPLETE })
      .andWhere('c.chart_status_changed_at >= :t', { t: today })
      .getCount();

    return {
      readyToCode, codingDoneToday, readyToAudit, auditDoneToday,
      completeToday, incompleteToday,
      inProgressChart: null, inProgressStartedAt: null,
    };
  }

  /* ── Throughput: charts allocated vs worked on, today + per day ──
   * "Allocated"  = distinct charts that got a chart_allocations row that day.
   * "Worked on"  = distinct charts with ≥1 chart_code_decision that day.
   * Both densified across the window via generate_series so the line charts
   * have no gaps. Optional client/location/speciality/facility scoping (facility
   * lives on chart.custom_fields, like the QA filters). */
  async throughput(q: {
    clientId?: number;
    locationId?: number;
    specialityId?: number;
    facility?: string;
    userId?: number;
    days?: number;
    /** ISO YYYY-MM-DD — caps the window's end. Defaults to today. */
    endsAt?: string;
  }) {
    const days = Math.min(180, Math.max(1, Number(q.days) || 30));
    // End anchor (today by default; set to yesterday's date for the
    // "Yesterday" picker). `since` walks back `days-1` from there.
    const endDate = endAnchor(q.endsAt);
    const since = new Date(endDate);
    since.setDate(endDate.getDate() - (days - 1));

    // $1 = since, $2 = endDate; scope params start at $3.
    const params: unknown[] = [since, endDate];
    const scope: string[] = [];
    if (q.clientId) { params.push(Number(q.clientId)); scope.push(`w.client_id = $${params.length}`); }
    if (q.locationId) { params.push(Number(q.locationId)); scope.push(`w.location_id = $${params.length}`); }
    if (q.specialityId) { params.push(Number(q.specialityId)); scope.push(`w.primary_speciality_id = $${params.length}`); }
    if (q.facility) { params.push(q.facility); scope.push(`c.custom_fields->>'facility' = $${params.length}`); }
    const scopeSql = scope.length ? ` AND ${scope.join(' AND ')}` : '';
    // User scope is per-source (allocated_count uses chart_allocations.user_id,
    // worked_count uses chart_code_decisions.decided_by_user_id), so we push
    // the userId once and inline the right column per inner query.
    let allocatedUserSql = '';
    let workedUserSql = '';
    if (q.userId) {
      params.push(Number(q.userId));
      allocatedUserSql = ` AND a.user_id = $${params.length}`;
      workedUserSql = ` AND d.decided_by_user_id = $${params.length}`;
    }

    const seriesSql = (inner: string) => `
      WITH days AS (
        SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS day
      )
      SELECT to_char(days.day, 'YYYY-MM-DD') AS date, COALESCE(agg.count, 0)::int AS count
      FROM days
      LEFT JOIN ( ${inner} ) agg ON agg.day = days.day
      ORDER BY days.day ASC
    `;

    // Exclude soft-deleted charts AND charts orphaned by a soft-deleted
    // worklist. Without these, deleting a worklist still leaves its charts
    // in the productivity bars / drill-down because chart_allocations and
    // chart_code_decisions rows survive. Matches the same guard used by
    // aiProcessingStatus / aiProcessingStatusSeries below.
    const allocatedInner = `
      SELECT date_trunc('day', a.allocated_at)::date AS day, COUNT(DISTINCT a.chart_id)::int AS count
      FROM chart_allocations a
      JOIN charts c     ON c.id = a.chart_id
      JOIN worklists w  ON w.id = c.worklist_id
      WHERE a.allocated_at >= $1
        AND a.allocated_at < ($2::date + INTERVAL '1 day')
        AND c.deleted_at IS NULL
        AND w.deleted_at IS NULL${scopeSql}${allocatedUserSql}
      GROUP BY 1
    `;
    const workedInner = `
      SELECT date_trunc('day', d.decided_at)::date AS day, COUNT(DISTINCT d.chart_id)::int AS count
      FROM chart_code_decisions d
      JOIN charts c     ON c.id = d.chart_id
      JOIN worklists w  ON w.id = c.worklist_id
      WHERE d.decided_at >= $1
        AND d.decided_at < ($2::date + INTERVAL '1 day')
        AND c.deleted_at IS NULL
        AND w.deleted_at IS NULL${scopeSql}${workedUserSql}
      GROUP BY 1
    `;

    const em = this.charts.manager;
    const [allocatedPerDay, workedPerDay] = await Promise.all([
      em.query(seriesSql(allocatedInner), params) as Promise<Array<{ date: string; count: number }>>,
      em.query(seriesSql(workedInner), params) as Promise<Array<{ date: string; count: number }>>,
    ]);

    // The series ends on CURRENT_DATE, so the last bucket is "today".
    const lastCount = (rows: Array<{ count: number }>) => (rows.length ? Number(rows[rows.length - 1].count) : 0);

    return {
      days,
      allocatedToday: lastCount(allocatedPerDay),
      workedToday: lastCount(workedPerDay),
      allocatedPerDay: allocatedPerDay.map((r) => ({ date: r.date, count: Number(r.count) })),
      workedPerDay: workedPerDay.map((r) => ({ date: r.date, count: Number(r.count) })),
    };
  }

  /* ── AI processing status: pipeline state across all charts ──
   * Buckets every chart by its AI-pipeline state (mutually exclusive, same
   * precedence as charts.summary / deriveAiStatus): an in-flight
   * pendingPrediction wins over a prior aiPredictionError, which wins over a
   * completed aiPrediction. Returns the three user-facing buckets:
   *   processed   = done (aiPrediction present)
   *   error       = aiPredictionError, no pending
   *   inProgress  = pendingPrediction present (queued or processing)
   * Optional client/location/speciality/facility scoping, like throughput. */
  async aiProcessingStatus(q: {
    clientId?: number;
    locationId?: number;
    specialityId?: number;
    facility?: string;
    userId?: number;
  }) {
    const params: unknown[] = [];
    // Exclude soft-deleted charts and charts orphaned by a soft-deleted
    // worklist, so the productivity AI stats agree with the charts list / tiles.
    const scope: string[] = ['c.deleted_at IS NULL', 'w.deleted_at IS NULL'];
    if (q.clientId) { params.push(Number(q.clientId)); scope.push(`w.client_id = $${params.length}`); }
    if (q.locationId) { params.push(Number(q.locationId)); scope.push(`w.location_id = $${params.length}`); }
    if (q.specialityId) { params.push(Number(q.specialityId)); scope.push(`w.primary_speciality_id = $${params.length}`); }
    if (q.facility) { params.push(q.facility); scope.push(`c.custom_fields->>'facility' = $${params.length}`); }
    // User scope = charts allocated to this user (their queue's AI state).
    if (q.userId) {
      params.push(Number(q.userId));
      scope.push(`EXISTS (SELECT 1 FROM chart_allocations a WHERE a.chart_id = c.id AND a.user_id = $${params.length})`);
    }
    const scopeSql = scope.length ? `WHERE ${scope.join(' AND ')}` : '';

    const sql = `
      SELECT
        COUNT(*) FILTER (
          WHERE c.custom_fields ? 'pendingPrediction'
        )::int AS in_progress,
        COUNT(*) FILTER (
          WHERE NOT (c.custom_fields ? 'pendingPrediction')
            AND c.custom_fields ? 'aiPredictionError'
        )::int AS error,
        COUNT(*) FILTER (
          WHERE NOT (c.custom_fields ? 'pendingPrediction')
            AND NOT (c.custom_fields ? 'aiPredictionError')
            AND c.custom_fields ? 'aiPrediction'
        )::int AS processed
      FROM charts c
      JOIN worklists w ON w.id = c.worklist_id
      ${scopeSql}
    `;

    const [row] = (await this.charts.manager.query(sql, params)) as Array<{
      in_progress: number;
      error: number;
      processed: number;
    }>;

    return {
      processed: Number(row?.processed ?? 0),
      error: Number(row?.error ?? 0),
      inProgress: Number(row?.in_progress ?? 0),
    };
  }

  /* ── AI processing status, day by day ──
   * Per-day counts of charts that entered each pipeline state on a given day,
   * keyed off the timestamps stored in custom_fields:
   *   processed   → aiPrediction.generatedAt
   *   error       → aiPredictionError.failedAt
   *   inProgress  → pendingPrediction.startedAt
   * Each series is densified across the window via generate_series so the line
   * chart has no gaps. Same client/location/speciality/facility scoping. */
  async aiProcessingStatusSeries(q: {
    clientId?: number;
    locationId?: number;
    specialityId?: number;
    facility?: string;
    userId?: number;
    days?: number;
    endsAt?: string;
  }) {
    const days = Math.min(180, Math.max(1, Number(q.days) || 30));
    const endDate = endAnchor(q.endsAt);
    const since = new Date(endDate);
    since.setDate(endDate.getDate() - (days - 1));

    // $1 = since, $2 = endDate; scope params start at $3.
    const params: unknown[] = [since, endDate];
    // Same orphan / soft-delete exclusion as aiProcessingStatus.
    const scope: string[] = ['c.deleted_at IS NULL', 'w.deleted_at IS NULL'];
    if (q.clientId) { params.push(Number(q.clientId)); scope.push(`w.client_id = $${params.length}`); }
    if (q.locationId) { params.push(Number(q.locationId)); scope.push(`w.location_id = $${params.length}`); }
    if (q.specialityId) { params.push(Number(q.specialityId)); scope.push(`w.primary_speciality_id = $${params.length}`); }
    if (q.facility) { params.push(q.facility); scope.push(`c.custom_fields->>'facility' = $${params.length}`); }
    // User scope = charts allocated to this user.
    if (q.userId) {
      params.push(Number(q.userId));
      scope.push(`EXISTS (SELECT 1 FROM chart_allocations a WHERE a.chart_id = c.id AND a.user_id = $${params.length})`);
    }
    const scopeSql = scope.length ? ` AND ${scope.join(' AND ')}` : '';

    const seriesSql = (inner: string) => `
      WITH days AS (
        SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS day
      )
      SELECT to_char(days.day, 'YYYY-MM-DD') AS date, COALESCE(agg.count, 0)::int AS count
      FROM days
      LEFT JOIN ( ${inner} ) agg ON agg.day = days.day
      ORDER BY days.day ASC
    `;

    // Each inner query reads a JSON timestamp, casts it to a date, and counts
    // charts whose state-entry fell on that day within the window.
    const inner = (key: string, tsField: string) => `
      SELECT date_trunc('day', (c.custom_fields->'${key}'->>'${tsField}')::timestamptz)::date AS day,
             COUNT(*)::int AS count
      FROM charts c
      JOIN worklists w ON w.id = c.worklist_id
      WHERE c.custom_fields ? '${key}'
        AND NULLIF(c.custom_fields->'${key}'->>'${tsField}', '') IS NOT NULL
        AND (c.custom_fields->'${key}'->>'${tsField}')::timestamptz >= $1
        AND (c.custom_fields->'${key}'->>'${tsField}')::timestamptz < ($2::date + INTERVAL '1 day')${scopeSql}
      GROUP BY 1
    `;

    const em = this.charts.manager;
    const [processedPerDay, errorPerDay, inProgressPerDay] = await Promise.all([
      em.query(seriesSql(inner('aiPrediction', 'generatedAt')), params) as Promise<Array<{ date: string; count: number }>>,
      em.query(seriesSql(inner('aiPredictionError', 'failedAt')), params) as Promise<Array<{ date: string; count: number }>>,
      em.query(seriesSql(inner('pendingPrediction', 'startedAt')), params) as Promise<Array<{ date: string; count: number }>>,
    ]);

    const norm = (rows: Array<{ date: string; count: number }>) =>
      rows.map((r) => ({ date: r.date, count: Number(r.count) }));

    return {
      days,
      processedPerDay: norm(processedPerDay),
      errorPerDay: norm(errorPerDay),
      inProgressPerDay: norm(inProgressPerDay),
    };
  }

  /** Drill-down: the actual chart records behind the throughput metrics.
   * `kind='allocated'` → distinct charts allocated in the window (sorted by most
   * recent allocation); `kind='worked'` → distinct charts with a code decision
   * in the window (sorted by most recent decision, with a per-chart decision
   * count). Paginated; same client/location/speciality/facility scoping. */
  async throughputCharts(q: {
    kind?: 'allocated' | 'worked';
    clientId?: number;
    locationId?: number;
    specialityId?: number;
    facility?: string;
    userId?: number;
    days?: number;
    endsAt?: string;
    page?: number;
    pageSize?: number;
  }) {
    const kind = q.kind === 'worked' ? 'worked' : 'allocated';
    const days = Math.min(180, Math.max(1, Number(q.days) || 30));
    const endDate = endAnchor(q.endsAt);
    const since = new Date(endDate);
    since.setDate(endDate.getDate() - (days - 1));
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    // $1 = since, $2 = endDate; scope params start at $3.
    const params: unknown[] = [since, endDate];
    const scope: string[] = [];
    if (q.clientId) { params.push(Number(q.clientId)); scope.push(`w.client_id = $${params.length}`); }
    if (q.locationId) { params.push(Number(q.locationId)); scope.push(`w.location_id = $${params.length}`); }
    if (q.specialityId) { params.push(Number(q.specialityId)); scope.push(`w.primary_speciality_id = $${params.length}`); }
    if (q.facility) { params.push(q.facility); scope.push(`c.custom_fields->>'facility' = $${params.length}`); }
    const scopeSql = scope.length ? ` AND ${scope.join(' AND ')}` : '';

    const src = kind === 'allocated'
      ? { table: 'chart_allocations a', dateCol: 'a.allocated_at', idCol: 'a.chart_id', userCol: 'a.user_id' }
      : { table: 'chart_code_decisions d', dateCol: 'd.decided_at', idCol: 'd.chart_id', userCol: 'd.decided_by_user_id' };

    // User scope uses whichever column attributes the action for this `kind`.
    let userSql = '';
    if (q.userId) {
      params.push(Number(q.userId));
      userSql = ` AND ${src.userCol} = $${params.length}`;
    }

    // Same orphan / soft-delete exclusion as throughput() so the drill-down
    // and the bar charts stay consistent.
    const em = this.charts.manager;
    const countRows: Array<{ total: number }> = await em.query(
      `SELECT COUNT(DISTINCT ${src.idCol})::int AS total
       FROM ${src.table}
       JOIN charts c ON c.id = ${src.idCol}
       JOIN worklists w ON w.id = c.worklist_id
       WHERE ${src.dateCol} >= $1 AND ${src.dateCol} < ($2::date + INTERVAL '1 day')
         AND c.deleted_at IS NULL
         AND w.deleted_at IS NULL${scopeSql}${userSql}`,
      params,
    );
    const total = Number(countRows[0]?.total ?? 0);

    const dateSelect = kind === 'allocated'
      ? `MAX(${src.dateCol}) AS allocated_at, NULL::timestamptz AS last_worked_at, 0 AS decisions`
      : `NULL::timestamptz AS allocated_at, MAX(${src.dateCol}) AS last_worked_at, COUNT(*)::int AS decisions`;

    const rows: any[] = await em.query(
      `SELECT
         c.id AS chart_id, c.chart_no, w.worklist_number,
         cl.name AS client_name, loc.name AS location_name, ps.name AS speciality_name,
         c.milestone,
         COALESCE(coder.full_name, auditor.full_name) AS assignee_name,
         ${dateSelect}
       FROM ${src.table}
       JOIN charts c ON c.id = ${src.idCol}
       JOIN worklists w ON w.id = c.worklist_id
       LEFT JOIN clients              cl  ON cl.id = w.client_id
       LEFT JOIN locations            loc ON loc.id = w.location_id
       LEFT JOIN primary_specialities ps  ON ps.id = w.primary_speciality_id
       LEFT JOIN users coder   ON coder.id   = c.allocated_coder_id
       LEFT JOIN users auditor ON auditor.id = c.allocated_auditor_id
       WHERE ${src.dateCol} >= $1 AND ${src.dateCol} < ($2::date + INTERVAL '1 day')
         AND c.deleted_at IS NULL
         AND w.deleted_at IS NULL${scopeSql}${userSql}
       GROUP BY c.id, c.chart_no, w.worklist_number, cl.name, loc.name, ps.name, c.milestone, coder.full_name, auditor.full_name
       ORDER BY MAX(${src.dateCol}) DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );

    return {
      kind,
      total,
      page,
      pageSize,
      items: rows.map((r) => ({
        chartId: Number(r.chart_id),
        chartNo: r.chart_no,
        worklistNumber: r.worklist_number,
        clientName: r.client_name,
        locationName: r.location_name,
        specialityName: r.speciality_name,
        milestone: r.milestone,
        assigneeName: r.assignee_name,
        allocatedAt: r.allocated_at,
        lastWorkedAt: r.last_worked_at,
        decisions: Number(r.decisions ?? 0),
      })),
    };
  }

  /* ── Internals ────────────────────────────────────────── */

  private scopeCharts<T>(qb: SelectQueryBuilder<T>, q: FilterQuery): SelectQueryBuilder<T> {
    if (!q.clientId && !q.locationId) return qb;
    // Re-use the existing 'w' alias if a join already exists; otherwise add it.
    const hasWorklistJoin = qb.expressionMap.aliases.some(a => a.name === 'w');
    if (!hasWorklistJoin) qb.innerJoin('worklists', 'w', 'w.id = c.worklist_id');
    if (q.clientId)   qb.andWhere('w.client_id = :cid',   { cid: q.clientId });
    if (q.locationId) qb.andWhere('w.location_id = :lid', { lid: q.locationId });
    return qb;
  }

  private scopeWorklists<T>(qb: SelectQueryBuilder<T>, q: FilterQuery): SelectQueryBuilder<T> {
    if (q.clientId)   qb.andWhere('w.client_id = :cid',   { cid: q.clientId });
    if (q.locationId) qb.andWhere('w.location_id = :lid', { lid: q.locationId });
    return qb;
  }
}

/* ── Date helpers ───────────────────────────────────────── */

function startOfDayMinusDays(d: number): Date {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() - d);
  return t;
}

/** Resolve the end-anchor of a date window: parses YYYY-MM-DD as a local
 * midnight Date, or returns today's midnight when no `endsAt` is given.
 * Used by throughput / series queries so picks like "Yesterday" can cap the
 * window's end instead of always running to CURRENT_DATE. */
function endAnchor(endsAt?: string): Date {
  if (!endsAt) return startOfDayMinusDays(0);
  const [yy, mm, dd] = endsAt.split('-').map(Number);
  const d = new Date(yy, (mm || 1) - 1, dd || 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateKey(d: Date | string): string {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

/**
 * Densifies a raw `[{date, count}]` query result into a day-aligned series
 * of length `days`, filling missing days with count=0. Keeps the FE chart
 * X-axis stable across reloads even when there's no activity on a given day.
 */
function fillDateSeries(rows: Array<{ date: unknown; count: unknown }>, days: number): Array<{ date: string; count: number }> {
  const map = new Map<string, number>();
  for (const r of rows) map.set(dateKey(r.date as Date | string), Number(r.count));

  const series: Array<{ date: string; count: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = startOfDayMinusDays(i);
    const k = dateKey(d);
    series.push({ date: k, count: map.get(k) ?? 0 });
  }
  return series;
}

function fillNumericDateSeries(
  rows: Array<Record<string, unknown>>,
  days: number,
  valueKey: string,
): Array<{ date: string; value: number }> {
  const map = new Map<string, number>();
  for (const r of rows) map.set(dateKey(r.date as Date | string), Number(r[valueKey] ?? 0));

  const series: Array<{ date: string; value: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = startOfDayMinusDays(i);
    const k = dateKey(d);
    series.push({ date: k, value: map.get(k) ?? 0 });
  }
  return series;
}
