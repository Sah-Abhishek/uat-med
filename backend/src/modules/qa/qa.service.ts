import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { QaFiltersDto, QaSubmissionsQueryDto } from './dto/qa-filters.dto';

/**
 * Quality Assurance dashboard for Team Leads.
 *
 * Driven entirely by `chart_code_decisions` (the per-code Review & Edit
 * audit table). A "submission" is any chart with at least one decision row;
 * resubmitting a chart bumps it to the top because we sort by
 * MAX(decided_at) DESC.
 *
 * Two endpoints:
 *  - submissions(): paginated, grouped-by-chart list with mini A/E/R counts
 *  - aiAccuracy(): KPIs + per-codeType matrix + weekly trend + top reject
 *    reasons + per-day volume
 *
 * Both share the same filter shape (clientId, locationId, specialityId,
 * milestone[], coderId/auditorId, free-text q, date range from/to).
 */
@Injectable()
export class QaService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /* ── Filter SQL fragment + bind values ───────────────────── */

  private buildFilters(f: QaFiltersDto, alias = 'd', wAlias = 'w', cAlias = 'c') {
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (f.clientId)        { where.push(`${wAlias}.client_id = :clientId`); params.clientId = Number(f.clientId); }
    if (f.locationId)      { where.push(`${wAlias}.location_id = :locationId`); params.locationId = Number(f.locationId); }
    if (f.specialityId)    { where.push(`${wAlias}.primary_speciality_id = :specialityId`); params.specialityId = Number(f.specialityId); }
    if (f.coderId)         { where.push(`${cAlias}.allocated_coder_id = :coderId`); params.coderId = Number(f.coderId); }
    if (f.auditorId)       { where.push(`${cAlias}.allocated_auditor_id = :auditorId`); params.auditorId = Number(f.auditorId); }
    if (f.milestone) {
      const list = f.milestone.split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length) {
        where.push(`${cAlias}.milestone = ANY(:milestones)`);
        params.milestones = list;
      }
    }
    if (f.facility)        { where.push(`${cAlias}.custom_fields->>'facility' = :facility`); params.facility = f.facility; }
    if (f.from)            { where.push(`${alias}.decided_at >= :fromTs`); params.fromTs = `${f.from} 00:00:00`; }
    if (f.to)              { where.push(`${alias}.decided_at <= :toTs`); params.toTs = `${f.to} 23:59:59`; }
    if (f.q?.trim()) {
      where.push(`${cAlias}.chart_no ILIKE :q`);
      params.q = `%${f.q.trim()}%`;
    }

    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }

  /* ── Submissions list ────────────────────────────────────── */

  async submissions(q: QaSubmissionsQueryDto) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
    const offset = (page - 1) * pageSize;

    const { sql: whereSql, params } = this.buildFilters(q);

    // Inner CTE groups by chart so a single chart is one row even if the
    // user re-submitted multiple times; the outer query joins lookup
    // tables for display fields. ORDER BY MAX(decided_at) DESC means
    // re-submissions bump the chart to the top.
    const baseQuery = `
      WITH grouped AS (
        SELECT
          d.chart_id,
          MAX(d.decided_at)                                                    AS last_decided_at,
          MIN(d.decided_at)                                                    AS first_decided_at,
          COUNT(*)::int                                                        AS total_decisions,
          SUM(CASE WHEN d.decision = 'ACCEPTED' THEN 1 ELSE 0 END)::int        AS accepted,
          SUM(CASE WHEN d.decision = 'REJECTED' THEN 1 ELSE 0 END)::int        AS rejected,
          SUM(CASE WHEN d.decision = 'EDITED'   THEN 1 ELSE 0 END)::int        AS edited
        FROM chart_code_decisions d
        JOIN charts    c ON c.id = d.chart_id
        JOIN worklists w ON w.id = c.worklist_id
        ${whereSql}
        GROUP BY d.chart_id
      )
      SELECT
        g.chart_id,
        g.last_decided_at,
        g.first_decided_at,
        g.total_decisions,
        g.accepted,
        g.rejected,
        g.edited,
        c.chart_no,
        c.mr_number,
        c.milestone,
        c.allocated_coder_id,
        c.allocated_auditor_id,
        w.client_id,
        w.location_id,
        w.primary_speciality_id,
        cl.name AS client_name,
        loc.name AS location_name,
        ps.name AS speciality_name,
        coder.full_name AS coder_name,
        auditor.full_name AS auditor_name
      FROM grouped g
      JOIN charts    c   ON c.id = g.chart_id
      JOIN worklists w   ON w.id = c.worklist_id
      LEFT JOIN clients              cl  ON cl.id = w.client_id
      LEFT JOIN locations            loc ON loc.id = w.location_id
      LEFT JOIN primary_specialities ps  ON ps.id = w.primary_speciality_id
      LEFT JOIN users                coder   ON coder.id   = c.allocated_coder_id
      LEFT JOIN users                auditor ON auditor.id = c.allocated_auditor_id
      ORDER BY g.last_decided_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT d.chart_id)::int AS total
      FROM chart_code_decisions d
      JOIN charts    c ON c.id = d.chart_id
      JOIN worklists w ON w.id = c.worklist_id
      ${whereSql}
    `;

    const [rows, countResult] = await Promise.all([
      this.run<any[]>(params, baseQuery),
      this.run<any[]>(params, countQuery),
    ]);
    const countRow = countResult[0];

    const items = rows.map((r: any) => ({
      chartId: Number(r.chart_id),
      chartNo: r.chart_no,
      mrNumber: r.mr_number,
      milestone: r.milestone,
      clientId: Number(r.client_id),
      clientName: r.client_name,
      locationId: Number(r.location_id),
      locationName: r.location_name,
      specialityId: r.primary_speciality_id ? Number(r.primary_speciality_id) : null,
      specialityName: r.speciality_name,
      coderId: r.allocated_coder_id ? Number(r.allocated_coder_id) : null,
      coderName: r.coder_name,
      auditorId: r.allocated_auditor_id ? Number(r.allocated_auditor_id) : null,
      auditorName: r.auditor_name,
      lastSubmittedAt: r.last_decided_at,
      firstDecidedAt: r.first_decided_at,
      totalDecisions: Number(r.total_decisions),
      accepted: Number(r.accepted),
      rejected: Number(r.rejected),
      edited: Number(r.edited),
      // Wall-clock between first and last decision for this chart.
      timeTakenMs: Math.max(
        0,
        new Date(r.last_decided_at).getTime() - new Date(r.first_decided_at).getTime(),
      ),
    }));

    return {
      items,
      total: Number(countRow?.total ?? 0),
      page,
      pageSize,
    };
  }

  /* ── AI accuracy aggregates ──────────────────────────────── */

  async aiAccuracy(f: QaFiltersDto) {
    const { sql: whereSql, params } = this.buildFilters(f);

    // KPI tiles + per-codeType matrix in one round-trip.
    const summarySql = `
      SELECT
        COUNT(*)::int                                                      AS total,
        COUNT(DISTINCT d.chart_id)::int                                    AS distinct_charts,
        SUM(CASE WHEN d.decision = 'ACCEPTED' THEN 1 ELSE 0 END)::int      AS accepted,
        SUM(CASE WHEN d.decision = 'REJECTED' THEN 1 ELSE 0 END)::int      AS rejected,
        SUM(CASE WHEN d.decision = 'EDITED'   THEN 1 ELSE 0 END)::int      AS edited,
        SUM(CASE WHEN d.decision = 'ADDED'    THEN 1 ELSE 0 END)::int      AS added
      FROM chart_code_decisions d
      JOIN charts    c ON c.id = d.chart_id
      JOIN worklists w ON w.id = c.worklist_id
      ${whereSql}
    `;

    const perTypeSql = `
      SELECT
        d.code_type AS code_type,
        SUM(CASE WHEN d.decision = 'ACCEPTED' THEN 1 ELSE 0 END)::int AS accepted,
        SUM(CASE WHEN d.decision = 'REJECTED' THEN 1 ELSE 0 END)::int AS rejected,
        SUM(CASE WHEN d.decision = 'EDITED'   THEN 1 ELSE 0 END)::int AS edited,
        SUM(CASE WHEN d.decision = 'ADDED'    THEN 1 ELSE 0 END)::int AS added,
        COUNT(*)::int AS total
      FROM chart_code_decisions d
      JOIN charts    c ON c.id = d.chart_id
      JOIN worklists w ON w.id = c.worklist_id
      ${whereSql}
      GROUP BY d.code_type
      ORDER BY total DESC
    `;

    // Top 10 dropdown reasons across REJECTED rows. Empty/null filtered.
    const topRejectSql = `
      SELECT
        d.reason_dropdown AS reason,
        COUNT(*)::int AS count
      FROM chart_code_decisions d
      JOIN charts    c ON c.id = d.chart_id
      JOIN worklists w ON w.id = c.worklist_id
      ${whereSql}
        ${whereSql ? 'AND' : 'WHERE'} d.decision = 'REJECTED'
        AND d.reason_dropdown IS NOT NULL
        AND length(trim(d.reason_dropdown)) > 0
      GROUP BY d.reason_dropdown
      ORDER BY count DESC
      LIMIT 10
    `;

    // Weekly acceptance trend — bucket by ISO week start (Monday).
    const weeklySql = `
      SELECT
        date_trunc('week', d.decided_at)::date AS week,
        SUM(CASE WHEN d.decision = 'ACCEPTED' THEN 1 ELSE 0 END)::int AS accepted,
        SUM(CASE WHEN d.decision = 'REJECTED' THEN 1 ELSE 0 END)::int AS rejected,
        SUM(CASE WHEN d.decision = 'EDITED'   THEN 1 ELSE 0 END)::int AS edited,
        SUM(CASE WHEN d.decision = 'ADDED'    THEN 1 ELSE 0 END)::int AS added,
        COUNT(*)::int AS total
      FROM chart_code_decisions d
      JOIN charts    c ON c.id = d.chart_id
      JOIN worklists w ON w.id = c.worklist_id
      ${whereSql}
      GROUP BY week
      ORDER BY week ASC
    `;

    // Daily submission volume — counts unique charts (re-submissions count once per day).
    const dailySql = `
      SELECT
        date_trunc('day', d.decided_at)::date AS day,
        COUNT(DISTINCT d.chart_id)::int AS submissions,
        COUNT(*)::int AS decisions
      FROM chart_code_decisions d
      JOIN charts    c ON c.id = d.chart_id
      JOIN worklists w ON w.id = c.worklist_id
      ${whereSql}
      GROUP BY day
      ORDER BY day ASC
    `;

    // Median time-per-chart, computed on (max-min decided_at) per chart.
    const medianTimeSql = `
      WITH per_chart AS (
        SELECT
          d.chart_id,
          EXTRACT(EPOCH FROM (MAX(d.decided_at) - MIN(d.decided_at))) * 1000 AS ms
        FROM chart_code_decisions d
        JOIN charts    c ON c.id = d.chart_id
        JOIN worklists w ON w.id = c.worklist_id
        ${whereSql}
        GROUP BY d.chart_id
      )
      SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS median_ms
      FROM per_chart
    `;

    const [summary, perType, topReject, weekly, daily, medianRow] = await Promise.all([
      this.run<any[]>(params, summarySql),
      this.run<any[]>(params, perTypeSql),
      this.run<any[]>(params, topRejectSql),
      this.run<any[]>(params, weeklySql),
      this.run<any[]>(params, dailySql),
      this.run<any[]>(params, medianTimeSql),
    ]);

    const s = summary[0] ?? {};
    const total = Number(s.total ?? 0);
    const accepted = Number(s.accepted ?? 0);

    return {
      kpis: {
        totalDecisions: total,
        distinctCharts: Number(s.distinct_charts ?? 0),
        acceptanceRate: total > 0 ? accepted / total : 0,
        acceptedCount: accepted,
        rejectedCount: Number(s.rejected ?? 0),
        editedCount: Number(s.edited ?? 0),
        addedCount: Number(s.added ?? 0),
        medianTimePerChartMs: medianRow[0]?.median_ms ? Number(medianRow[0].median_ms) : 0,
      },
      perCodeType: perType.map((r: any) => ({
        codeType: r.code_type,
        accepted: Number(r.accepted),
        rejected: Number(r.rejected),
        edited: Number(r.edited),
        added: Number(r.added),
        total: Number(r.total),
      })),
      topRejectReasons: topReject.map((r: any) => ({
        reason: r.reason,
        count: Number(r.count),
      })),
      weekly: weekly.map((r: any) => ({
        week: r.week,
        accepted: Number(r.accepted),
        rejected: Number(r.rejected),
        edited: Number(r.edited),
        added: Number(r.added),
        total: Number(r.total),
      })),
      daily: daily.map((r: any) => ({
        day: r.day,
        submissions: Number(r.submissions),
        decisions: Number(r.decisions),
      })),
    };
  }

  /* ── Filter dropdown helpers ─────────────────────────────── */

  /** Distinct coders that have at least one decision row — drives the filter dropdown. */
  async coders() {
    const rows = await this.ds.query(`
      SELECT DISTINCT u.id, u.full_name
      FROM chart_code_decisions d
      JOIN users u ON u.id = d.decided_by_user_id
      WHERE u.role IN ('CODER', 'AUDITOR')
      ORDER BY u.full_name ASC
    `);
    return {
      items: rows.map((r: any) => ({ id: Number(r.id), name: r.full_name })),
    };
  }

  /**
   * Distinct facility values actually present on charts — for the filter
   * dropdown. Facility lives in chart.custom_fields.facility (a free string,
   * not an FK), so we surface only values that exist, optionally scoped to a
   * client/location so the dropdown matches the rest of the filters.
   */
  async facilities(clientId?: number, locationId?: number) {
    const where: string[] = [`NULLIF(trim(c.custom_fields->>'facility'), '') IS NOT NULL`];
    const params: unknown[] = [];
    if (clientId) { params.push(clientId); where.push(`w.client_id = $${params.length}`); }
    if (locationId) { params.push(locationId); where.push(`w.location_id = $${params.length}`); }
    const rows = await this.ds.query(
      `SELECT DISTINCT c.custom_fields->>'facility' AS facility
       FROM charts c
       JOIN worklists w ON w.id = c.worklist_id
       WHERE ${where.join(' AND ')}
       ORDER BY 1 ASC`,
      params,
    );
    return { items: rows.map((r: any) => r.facility as string).filter(Boolean) };
  }

  /* ── Param-binding helper ────────────────────────────────── */

  /**
   * pg's parameter syntax is positional ($1, $2, …) but TypeORM's named
   * params are not auto-replaced when you use `ds.query`. So we walk the
   * SQL once, replacing each `:name` with its $N positional placeholder,
   * and emit the values in the order they appear. Returns
   * `[rewrittenSql, paramsArray]` so it can be spread into `ds.query`.
   */
  private async run<T = any>(params: Record<string, unknown>, sql: string): Promise<T> {
    const [rewritten, ordered] = this.bind(params, sql);
    return this.ds.query(rewritten, ordered);
  }

  private bind(params: Record<string, unknown>, sql: string): [string, unknown[]] {
    const ordered: unknown[] = [];
    let counter = 0;
    // The negative lookbehind `(?<!:)` skips PG's cast syntax `::int` —
    // without it, `COUNT(*)::int` would be rewritten to `COUNT(*):$1`,
    // which is invalid SQL.
    const rewritten = sql.replace(/(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g, (_m, name: string) => {
      counter++;
      ordered.push(params[name]);
      return `$${counter}`;
    });
    return [rewritten, ordered];
  }
}
