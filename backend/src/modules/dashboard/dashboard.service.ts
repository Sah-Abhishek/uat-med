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
