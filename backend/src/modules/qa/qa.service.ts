import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { QaFiltersDto, QaSubmissionsQueryDto } from './dto/qa-filters.dto';

/** Hard cap on encounter-export rows so a huge window can't build an unbounded
 * workbook. Prod holds ~3k charts total, so this is comfortably above any window. */
const ENCOUNTER_EXPORT_LIMIT = 50_000;

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

    // Always exclude soft-deleted charts and orphaned charts (charts whose
    // worklist has been soft-deleted). Mirrors the exclusion applied across the
    // charts list, dashboard, and productivity so AI/QA stats never count
    // orphans. Added unconditionally, so `sql` is always a non-empty WHERE.
    where.push(`${cAlias}.deleted_at IS NULL`);
    where.push(`${wAlias}.deleted_at IS NULL`);

    if (f.clientId)        { where.push(`${wAlias}.client_id = :clientId`); params.clientId = Number(f.clientId); }
    if (f.locationId)      { where.push(`${wAlias}.location_id = :locationId`); params.locationId = Number(f.locationId); }
    if (f.specialityId?.length)    { where.push(`${wAlias}.primary_speciality_id = ANY(:specialityIds)`); params.specialityIds = f.specialityId; }
    if (f.subSpecialityId?.length) { where.push(`${wAlias}.sub_speciality_id = ANY(:subSpecialityIds)`); params.subSpecialityIds = f.subSpecialityId; }
    if (f.worklistId)      { where.push(`${wAlias}.id = :worklistId`); params.worklistId = Number(f.worklistId); }
    if (f.coderId)         { where.push(`${cAlias}.allocated_coder_id = :coderId`); params.coderId = Number(f.coderId); }
    if (f.auditorId)       { where.push(`${cAlias}.allocated_auditor_id = :auditorId`); params.auditorId = Number(f.auditorId); }
    if (f.milestone) {
      const list = f.milestone.split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length) {
        where.push(`${cAlias}.milestone = ANY(:milestones)`);
        params.milestones = list;
      }
    }
    if (f.facility?.length) { where.push(`${cAlias}.custom_fields->>'facility' = ANY(:facilities)`); params.facilities = f.facility; }
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
        w.worklist_number,
        cl.name AS client_name,
        loc.name AS location_name,
        ps.name AS speciality_name,
        coder.full_name AS coder_name,
        auditor.full_name AS auditor_name,
        -- Real review time from the work-timer sessions (null when a chart has
        -- no timer rows yet — e.g. historical charts — so we can fall back).
        (SELECT SUM(tl.elapsed_ms) FROM chart_time_logs tl WHERE tl.chart_id = g.chart_id) AS timer_ms
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
      worklistNumber: r.worklist_number,
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
      // Prefer real timer time (sum of work-timer sessions); fall back to the
      // wall-clock between first and last decision for charts with no timer
      // data (e.g. submitted before the timer was persisted).
      timeTakenMs: r.timer_ms != null
        ? Number(r.timer_ms)
        : Math.max(
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

  /* ── Per-encounter export (xlsx) ─────────────────────────── */

  /**
   * Build an .xlsx of every submitted chart (one row per chart / encounter)
   * matching `f`, for the AI Analytics encounter export. Same grouped-by-chart
   * shape as {@link submissions} but unpaginated (capped at
   * {@link ENCOUNTER_EXPORT_LIMIT}) and enriched with the AI-pipeline encounter
   * id from `custom_fields.aiPrediction.encounterId` — the value coders see on
   * the chart header, NOT the internal chart number (which is often blank).
   */
  async exportEncountersXlsx(f: QaFiltersDto): Promise<{ buffer: Buffer; rowCount: number }> {
    const { sql: whereSql, params } = this.buildFilters(f);

    const sql = `
      WITH grouped AS (
        SELECT
          d.chart_id,
          MAX(d.decided_at)                                            AS last_decided_at,
          COUNT(*)::int                                                AS total_decisions,
          SUM(CASE WHEN d.decision = 'ACCEPTED' THEN 1 ELSE 0 END)::int AS accepted,
          SUM(CASE WHEN d.decision = 'REJECTED' THEN 1 ELSE 0 END)::int AS rejected,
          SUM(CASE WHEN d.decision = 'EDITED'   THEN 1 ELSE 0 END)::int AS edited
        FROM chart_code_decisions d
        JOIN charts    c ON c.id = d.chart_id
        JOIN worklists w ON w.id = c.worklist_id
        ${whereSql}
        GROUP BY d.chart_id
      )
      SELECT
        c.custom_fields #>> '{aiPrediction,encounterId}' AS encounter_id,
        c.chart_no,
        c.mr_number,
        w.worklist_number,
        cl.name  AS client_name,
        loc.name AS location_name,
        ps.name  AS speciality_name,
        c.milestone,
        g.total_decisions,
        g.accepted,
        g.rejected,
        g.edited,
        g.last_decided_at
      FROM grouped g
      JOIN charts    c   ON c.id = g.chart_id
      JOIN worklists w   ON w.id = c.worklist_id
      LEFT JOIN clients              cl  ON cl.id = w.client_id
      LEFT JOIN locations            loc ON loc.id = w.location_id
      LEFT JOIN primary_specialities ps  ON ps.id = w.primary_speciality_id
      ORDER BY g.last_decided_at DESC
      LIMIT ${ENCOUNTER_EXPORT_LIMIT}
    `;

    const rows = await this.run<any[]>(params, sql);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Valerion AI Analytics';
    wb.created = new Date();

    const ws = wb.addWorksheet('Encounters', {
      views: [{ state: 'frozen', ySplit: 1 }], // freeze header row when scrolling
    });

    ws.columns = [
      { header: 'Encounter ID',   key: 'encounter_id',    width: 40 },
      { header: 'Chart No',       key: 'chart_no',        width: 16 },
      { header: 'MR Number',      key: 'mr_number',        width: 16 },
      { header: 'Worklist',       key: 'worklist_number', width: 16 },
      { header: 'Client',         key: 'client_name',      width: 24 },
      { header: 'Location',       key: 'location_name',    width: 24 },
      { header: 'Speciality',     key: 'speciality_name',  width: 22 },
      { header: 'Milestone',      key: 'milestone',        width: 16 },
      { header: 'Decisions',      key: 'total_decisions',  width: 11, style: { numFmt: '0' } },
      { header: 'Accepted',       key: 'accepted',         width: 11, style: { numFmt: '0' } },
      { header: 'Rejected',       key: 'rejected',         width: 11, style: { numFmt: '0' } },
      { header: 'Edited',         key: 'edited',           width: 11, style: { numFmt: '0' } },
      { header: 'Last Submitted', key: 'last_decided_at',  width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    ];

    const header = ws.getRow(1);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    header.alignment = { vertical: 'middle' };

    for (const r of rows) {
      ws.addRow({
        encounter_id:    r.encounter_id ?? '',
        chart_no:        r.chart_no ?? '',
        mr_number:       r.mr_number ?? '',
        worklist_number: r.worklist_number ?? '',
        client_name:     r.client_name ?? '',
        location_name:   r.location_name ?? '',
        speciality_name: r.speciality_name ?? '',
        milestone:       r.milestone ?? '',
        total_decisions: Number(r.total_decisions),
        accepted:        Number(r.accepted),
        rejected:        Number(r.rejected),
        edited:          Number(r.edited),
        last_decided_at: r.last_decided_at ? new Date(r.last_decided_at) : null,
      });
    }

    // ExcelJS types `writeBuffer` as Promise<ArrayBuffer> but returns a Node
    // Buffer at runtime — cast keeps the StreamableFile controller happy.
    const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
    return { buffer, rowCount: rows.length };
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

    // Daily volume + verdict mix. submissions counts unique charts
    // (re-submissions count once per day); the verdict sums let the client
    // derive a daily AI-accuracy (acceptance) rate = accepted / decisions,
    // mirroring the weekly trend and the headline acceptanceRate KPI.
    const dailySql = `
      SELECT
        date_trunc('day', d.decided_at)::date AS day,
        COUNT(DISTINCT d.chart_id)::int AS submissions,
        COUNT(*)::int AS decisions,
        SUM(CASE WHEN d.decision = 'ACCEPTED' THEN 1 ELSE 0 END)::int AS accepted,
        SUM(CASE WHEN d.decision = 'REJECTED' THEN 1 ELSE 0 END)::int AS rejected,
        SUM(CASE WHEN d.decision = 'EDITED'   THEN 1 ELSE 0 END)::int AS edited,
        SUM(CASE WHEN d.decision = 'ADDED'    THEN 1 ELSE 0 END)::int AS added
      FROM chart_code_decisions d
      JOIN charts    c ON c.id = d.chart_id
      JOIN worklists w ON w.id = c.worklist_id
      ${whereSql}
      GROUP BY day
      ORDER BY day ASC
    `;

    // Median time-per-chart. Prefer real work-timer time (sum of sessions);
    // fall back to the (max-min decided_at) span for charts with no timer rows.
    const medianTimeSql = `
      WITH per_chart AS (
        SELECT
          d.chart_id,
          COALESCE(
            (SELECT SUM(tl.elapsed_ms) FROM chart_time_logs tl WHERE tl.chart_id = d.chart_id),
            EXTRACT(EPOCH FROM (MAX(d.decided_at) - MIN(d.decided_at))) * 1000
          ) AS ms
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
        accepted: Number(r.accepted),
        rejected: Number(r.rejected),
        edited: Number(r.edited),
        added: Number(r.added),
      })),
    };
  }

  /* ── Activity breakdown (client / location / sub-speciality) ── */

  /**
   * Decisions grouped by client × location × sub-speciality for the given
   * filters — answers "which client/location/sub-speciality is being worked,
   * and how accurate is the AI there". Each row carries its own verdict mix so
   * the client can show a per-group acceptance rate alongside the headline KPI.
   *
   * Shares buildFilters() with aiAccuracy(), so it honours the same scope and
   * the orphan-exclusion rule; the AI Analytics page drives it with its own
   * date window (Today / last 7d / month) independent of the page date filter.
   * Capped at 200 groups, ordered by volume.
   */
  async aiActivityBreakdown(f: QaFiltersDto) {
    const { sql: whereSql, params } = this.buildFilters(f);

    const sql = `
      SELECT
        w.client_id          AS "clientId",
        cl.name              AS "clientName",
        w.location_id        AS "locationId",
        loc.name             AS "locationName",
        w.sub_speciality_id  AS "subSpecialityId",
        ss.name              AS "subSpecialityName",
        COUNT(DISTINCT d.chart_id)::int                              AS "charts",
        COUNT(*)::int                                                AS "decisions",
        SUM(CASE WHEN d.decision = 'ACCEPTED' THEN 1 ELSE 0 END)::int AS "accepted",
        SUM(CASE WHEN d.decision = 'REJECTED' THEN 1 ELSE 0 END)::int AS "rejected",
        SUM(CASE WHEN d.decision = 'EDITED'   THEN 1 ELSE 0 END)::int AS "edited",
        SUM(CASE WHEN d.decision = 'ADDED'    THEN 1 ELSE 0 END)::int AS "added"
      FROM chart_code_decisions d
      JOIN charts    c ON c.id = d.chart_id
      JOIN worklists w ON w.id = c.worklist_id
      LEFT JOIN clients          cl  ON cl.id  = w.client_id
      LEFT JOIN locations        loc ON loc.id = w.location_id
      LEFT JOIN sub_specialities ss  ON ss.id  = w.sub_speciality_id
      ${whereSql}
      GROUP BY w.client_id, cl.name, w.location_id, loc.name, w.sub_speciality_id, ss.name
      ORDER BY "decisions" DESC, "charts" DESC
      LIMIT 200
    `;

    const rows = await this.run<any[]>(params, sql);

    return {
      items: rows.map((r: any) => ({
        clientId: r.clientId ?? null,
        clientName: r.clientName ?? null,
        locationId: r.locationId ?? null,
        locationName: r.locationName ?? null,
        subSpecialityId: r.subSpecialityId ?? null,
        subSpecialityName: r.subSpecialityName ?? null,
        charts: Number(r.charts),
        decisions: Number(r.decisions),
        accepted: Number(r.accepted),
        rejected: Number(r.rejected),
        edited: Number(r.edited),
        added: Number(r.added),
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
   * Distinct worklists that have at least one submitted chart (≥1 decision
   * row) — drives the "Worklist name" filter dropdown. Optionally scoped by
   * client so the suggestions match the rest of the active filters.
   */
  async worklists(clientId?: number, search?: string, limit = 10) {
    // Total available (scoped by client, ignoring search) — lets the UI decide
    // whether to show an in-dropdown search box (only when > limit exist).
    const countWhere: string[] = [];
    const countParams: unknown[] = [];
    if (clientId) { countParams.push(clientId); countWhere.push(`w.client_id = $${countParams.length}`); }
    const countRows = await this.ds.query(
      `SELECT COUNT(DISTINCT w.id)::int AS total
       FROM chart_code_decisions d
       JOIN charts    c ON c.id = d.chart_id
       JOIN worklists w ON w.id = c.worklist_id
       ${countWhere.length ? `WHERE ${countWhere.join(' AND ')}` : ''}`,
      countParams,
    );
    const total = Number(countRows[0]?.total ?? 0);

    const where: string[] = [];
    const params: unknown[] = [];
    if (clientId) { params.push(clientId); where.push(`w.client_id = $${params.length}`); }
    if (search?.trim()) {
      params.push(`%${search.trim()}%`);
      where.push(`w.worklist_number ILIKE $${params.length}`);
    }
    params.push(Math.min(50, Math.max(1, Number(limit) || 10)));
    const limitIdx = params.length;
    const rows = await this.ds.query(
      `SELECT DISTINCT w.id, w.worklist_number
       FROM chart_code_decisions d
       JOIN charts    c ON c.id = d.chart_id
       JOIN worklists w ON w.id = c.worklist_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY w.worklist_number ASC
       LIMIT $${limitIdx}`,
      params,
    );
    return {
      items: rows.map((r: any) => ({ id: Number(r.id), name: r.worklist_number as string })),
      total,
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
  /* ── Live mode — in-progress drafts ──────────────────────── */

  /**
   * Charts being worked on RIGHT NOW, for QA to watch coders/auditors in real
   * time. Sourced from OPEN work-timer sessions (`chart_time_logs` with
   * `stopped_at IS NULL`) — the same "who's working this instant" signal the
   * admin Live Activity page uses — so a coder shows up the moment they start
   * a chart, before they've decided anything. Their in-progress decision draft
   * is LEFT JOINed in (it may not exist yet): we hand its raw, versioned
   * `payload` back verbatim (the frontend owns its shape) plus the draft's
   * `updated_at` (null until the first decision) so the client can stream new
   * decisions as toasts. `serverNow` lets the client correct clock skew.
   *
   * Scope: excludes the caller's own session and soft-deleted / orphaned charts
   * (the same exclusion applied across QA and AI stats so orphans never
   * surface).
   */
  async live(currentUserId: number) {
    const rows = await this.run<any[]>({ currentUserId }, `
      SELECT
        t.chart_id    AS "chartId",
        c.chart_no    AS "chartNo",
        c.milestone   AS "milestone",
        t.kind        AS "kind",
        t.started_at  AS "startedAt",
        d.payload     AS "payload",
        d.updated_at  AS "updatedAt",
        u.id          AS "userId",
        u.full_name   AS "userName",
        u.role        AS "userRole",
        u.avatar_url  AS "userAvatarUrl",
        cl.name       AS "clientName",
        loc.name      AS "locationName",
        ss.name       AS "subSpecialityName"
      FROM chart_time_logs t
      JOIN charts    c ON c.id = t.chart_id
      JOIN worklists w ON w.id = c.worklist_id
      JOIN users     u ON u.id = t.user_id
      LEFT JOIN chart_code_decision_drafts d ON d.chart_id = t.chart_id AND d.user_id = t.user_id
      LEFT JOIN clients          cl  ON cl.id  = w.client_id
      LEFT JOIN locations        loc ON loc.id = w.location_id
      LEFT JOIN sub_specialities ss  ON ss.id  = w.sub_speciality_id
      WHERE t.stopped_at IS NULL
        AND c.deleted_at IS NULL
        AND w.deleted_at IS NULL
        AND t.user_id <> :currentUserId
      ORDER BY COALESCE(d.updated_at, t.started_at) DESC
    `);

    const drafts = rows.map((r: any) => ({
      chartId: Number(r.chartId),
      chartNo: r.chartNo ?? null,
      milestone: r.milestone ?? null,
      kind: r.kind as 'CODING' | 'AUDIT',
      user: {
        id: Number(r.userId),
        fullName: r.userName ?? null,
        role: r.userRole ?? null,
        avatarUrl: r.userAvatarUrl ?? null,
      },
      clientName: r.clientName ?? null,
      locationName: r.locationName ?? null,
      subSpecialityName: r.subSpecialityName ?? null,
      payload: r.payload ?? null,
      // Null until the coder makes their first decision (no draft row yet).
      updatedAt: r.updatedAt ?? null,
      startedAt: r.startedAt,
    }));

    return { serverNow: new Date().toISOString(), drafts };
  }

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
