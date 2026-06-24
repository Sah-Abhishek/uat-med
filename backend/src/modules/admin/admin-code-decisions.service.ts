import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';

import { ChartCodeDecision } from '../../entities/chart-code-decision.entity';
import { Chart } from '../../entities/chart.entity';
import { User } from '../../entities/user.entity';
import { Worklist } from '../../entities/worklist.entity';
import { Client } from '../../entities/client.entity';
import { Location } from '../../entities/location.entity';
import { SubSpeciality } from '../../entities/sub-speciality.entity';
import {
  AiGatewayClient,
  type GatewayCorrection,
  type PredictedCodeReviewItem,
} from '../ai-gateway/ai-gateway.service';
import { ListCodeDecisionsDto } from './dto/list-code-decisions.dto';
import { ListChartsWithDecisionsDto } from './dto/list-charts-with-decisions.dto';
import { CodeReviewDecision } from '../../common/enums';

/** Hard cap on rows pulled into an Excel export, mirroring the reports module. */
const EXPORT_ROW_LIMIT = 50_000;

/**
 * Read-only admin queries over chart_code_decisions, joined with chart # and
 * the decider's name. Powers the verification page in the admin panel — lets
 * a manager / team lead inspect every coder action by chart, by coder, by
 * decision type, or by date range.
 *
 * Each row optionally carries the gateway-side `coder_corrections` UUID
 * (filled on submit when the forward succeeded). The detail endpoint
 * round-trips that UUID through the gateway so the page can show whether
 * the row is still present and synced.
 */
@Injectable()
export class AdminCodeDecisionsService {
  private readonly log = new Logger(AdminCodeDecisionsService.name);

  constructor(
    @InjectRepository(ChartCodeDecision) private readonly decisions: Repository<ChartCodeDecision>,
    @InjectRepository(Chart) private readonly charts: Repository<Chart>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly gateway: AiGatewayClient,
  ) {}

  async list(q: ListCodeDecisionsDto) {
    const qb = this.decisions
      .createQueryBuilder('d')
      .leftJoin(Chart, 'c', 'c.id = d.chart_id')
      .leftJoin(User, 'u', 'u.id = d.decided_by_user_id')
      .select([
        'd.id AS id',
        'd.chart_id AS "chartId"',
        'c.chart_no AS "chartNo"',
        'd.code_type AS "codeType"',
        'd.code_value AS "codeValue"',
        'd.predicted_code_id AS "predictedCodeId"',
        'd.original_description AS "originalDescription"',
        'd.decision AS decision',
        'd.edited_code AS "editedCode"',
        'd.edited_description AS "editedDescription"',
        'd.reason_dropdown AS "reasonDropdown"',
        'd.reason_text AS "reasonText"',
        'd.gateway_correction_id AS "gatewayCorrectionId"',
        'd.gateway_synced_at AS "gatewaySyncedAt"',
        'd.decided_by_user_id AS "decidedByUserId"',
        'u.email AS "decidedByEmail"',
        'u.full_name AS "decidedByName"',
        'u.role AS "decidedByRole"',
        'd.decided_at AS "decidedAt"',
      ])
      .orderBy('d.decided_at', 'DESC');

    if (q.chartId)  qb.andWhere('d.chart_id = :chartId', { chartId: q.chartId });
    if (q.coderId)  qb.andWhere('d.decided_by_user_id = :coderId', { coderId: q.coderId });
    if (q.decision) qb.andWhere('d.decision = :decision', { decision: q.decision });
    if (q.from)     qb.andWhere('d.decided_at >= :from', { from: `${q.from}T00:00:00Z` });
    if (q.to)       qb.andWhere('d.decided_at <= :to',   { to:   `${q.to}T23:59:59.999Z` });

    // Total before pagination, so the FE can render a stable page count.
    const total = await qb.clone().getCount();
    const items = await qb
      .offset((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .getRawMany();

    return {
      items: items.map((r) => ({
        ...r,
        id: Number(r.id),
        chartId: Number(r.chartId),
        decidedByUserId: Number(r.decidedByUserId),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /**
   * Round-trip a single local decision row against the gateway. Returns the
   * local row plus, if it has a stored gateway_correction_id, the matching
   * gateway row fetched fresh from /admin/corrections/{id}. Used by the FE
   * to show side-by-side "we have / they have" details when a manager
   * inspects a single decision.
   */
  async detail(id: number) {
    const row = await this.decisions
      .createQueryBuilder('d')
      .leftJoin(Chart, 'c', 'c.id = d.chart_id')
      .leftJoin(User, 'u', 'u.id = d.decided_by_user_id')
      .select([
        'd.id AS id',
        'd.chart_id AS "chartId"',
        'c.chart_no AS "chartNo"',
        'd.code_type AS "codeType"',
        'd.code_value AS "codeValue"',
        'd.predicted_code_id AS "predictedCodeId"',
        'd.original_description AS "originalDescription"',
        'd.decision AS decision',
        'd.edited_code AS "editedCode"',
        'd.edited_description AS "editedDescription"',
        'd.reason_dropdown AS "reasonDropdown"',
        'd.reason_text AS "reasonText"',
        'd.gateway_correction_id AS "gatewayCorrectionId"',
        'd.gateway_synced_at AS "gatewaySyncedAt"',
        'd.decided_by_user_id AS "decidedByUserId"',
        'u.email AS "decidedByEmail"',
        'u.full_name AS "decidedByName"',
        'u.role AS "decidedByRole"',
        'd.decided_at AS "decidedAt"',
      ])
      .where('d.id = :id', { id })
      .getRawOne();

    if (!row) {
      throw new NotFoundException({ error: { code: 'not_found', message: `Decision ${id} not found.` } });
    }

    let gatewayRow: unknown | null = null;
    let gatewayError: string | null = null;
    if (row.gatewayCorrectionId) {
      try {
        gatewayRow = await this.gateway.getCorrection(row.gatewayCorrectionId);
      } catch (err) {
        gatewayError = (err as Error)?.message ?? 'gateway error';
      }
    }

    return {
      local: {
        ...row,
        id: Number(row.id),
        chartId: Number(row.chartId),
        decidedByUserId: Number(row.decidedByUserId),
      },
      gateway: gatewayRow,
      gatewayError,
    };
  }

  /**
   * Chart-centric list: one row per chart that has at least one decision
   * (matching the filters when provided). Aggregates decision counts, the
   * latest decided_at, the set of reviewers that touched the chart, and a
   * synced/not-synced summary so a manager can spot charts whose corrections
   * didn't reach the AI golden dataset at a glance.
   *
   * "synced" / "not synced" definitions (a decision counts as forwarded if it
   * has EITHER a gateway_correction_id OR a gateway_synced_at):
   *   - synced:     gateway_correction_id IS NOT NULL OR gateway_synced_at IS NOT NULL
   *   - not synced: both NULL — never reached the gateway.
   * ACCEPT actions write no correction_id (audit-only, golden_dataset_api
   * §Appendix A), so before gateway_synced_at they always looked "local only";
   * now a forwarded ACCEPT carries a timestamp and counts as synced.
   */
  async listCharts(q: ListChartsWithDecisionsDto) {
    const { qb, matchingChartIds } = this.buildChartsAggregateQuery(q);

    // For total chart count we need a distinct-chart count over the same
    // filter — derive via a raw subquery so HAVING-based filters still apply.
    const totalRow = await this.decisions
      .createQueryBuilder('d')
      .select('COUNT(DISTINCT d.chart_id)::int', 'total')
      .where(`d.chart_id IN (${matchingChartIds.getQuery()})`)
      .setParameters(matchingChartIds.getParameters())
      .getRawOne<{ total: number }>();
    const total = Number(totalRow?.total ?? 0);

    const items = await qb
      .offset((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .getRawMany();

    return {
      items: items.map((r) => this.mapChartRow(r)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /**
   * Shared aggregate query behind both the chart list and its Excel export.
   * One row per chart (grouped by chart_id) carrying decision counts, the
   * reviewers involved, the synced/not-synced split, and the chart's worklist
   * context — client, location, sub-speciality and received date — resolved
   * the same way the charts list does. No pagination: callers add offset/limit.
   */
  private buildChartsAggregateQuery(q: ListChartsWithDecisionsDto) {
    // Sub-condition: a chart should appear when it has at least one decision
    // matching the per-decision filters (coderId / decision). The outer query
    // then aggregates ALL decisions on that chart so counts reflect the full
    // picture, not just the filter-matching subset.
    const matchingChartIds = this.decisions
      .createQueryBuilder('d')
      .select('DISTINCT d.chart_id', 'chartId');
    if (q.coderId)  matchingChartIds.andWhere('d.decided_by_user_id = :coderId', { coderId: q.coderId });
    if (q.decision) matchingChartIds.andWhere('d.decision = :decision', { decision: q.decision });

    const qb = this.decisions
      .createQueryBuilder('d')
      .leftJoin(Chart, 'c', 'c.id = d.chart_id')
      .leftJoin(User, 'u', 'u.id = d.decided_by_user_id')
      // Worklist carries the chart's client / location / sub-speciality + the
      // received date. Each chart maps to exactly one worklist, so these joins
      // are 1:1 and don't inflate the per-chart decision counts.
      .leftJoin(Worklist, 'w', 'w.id = c.worklist_id')
      .leftJoin(Client, 'cl', 'cl.id = w.client_id')
      .leftJoin(Location, 'loc', 'loc.id = w.location_id')
      .leftJoin(SubSpeciality, 'ss', 'ss.id = w.sub_speciality_id')
      .select('d.chart_id', 'chartId')
      .addSelect('MAX(c.chart_no)', 'chartNo')
      .addSelect('MAX(c.milestone)', 'milestone')
      .addSelect('MAX(c.chart_status)', 'chartStatus')
      .addSelect('MAX(c.allocated_coder_id)', 'allocatedCoderId')
      .addSelect('MAX(c.allocated_auditor_id)', 'allocatedAuditorId')
      .addSelect('MAX(cl.name)', 'clientName')
      .addSelect('MAX(loc.name)', 'locationName')
      // Prefer the structured sub-speciality; fall back to the chart's
      // custom_fields blob (mirrors the charts-list name resolution).
      .addSelect(`COALESCE(MAX(ss.name), MAX(c.custom_fields->>'subSpeciality'))`, 'subSpecialityName')
      .addSelect('MAX(w.received_date)::text', 'receivedDate')
      .addSelect('COUNT(*)::int', 'totalDecisions')
      .addSelect(`SUM(CASE WHEN d.decision = '${CodeReviewDecision.ACCEPTED}' THEN 1 ELSE 0 END)::int`, 'accepted')
      .addSelect(`SUM(CASE WHEN d.decision = '${CodeReviewDecision.REJECTED}' THEN 1 ELSE 0 END)::int`, 'rejected')
      .addSelect(`SUM(CASE WHEN d.decision = '${CodeReviewDecision.EDITED}'  THEN 1 ELSE 0 END)::int`, 'edited')
      .addSelect(`SUM(CASE WHEN d.decision = '${CodeReviewDecision.ADDED}'   THEN 1 ELSE 0 END)::int`, 'added')
      .addSelect('MAX(d.decided_at)', 'lastDecidedAt')
      .addSelect(
        // Forwarded to the gateway = has a correction_id (EDIT/DELETE/ADD) OR a
        // synced timestamp (covers ACCEPT, which returns no correction_id).
        `SUM(CASE WHEN d.gateway_correction_id IS NOT NULL OR d.gateway_synced_at IS NOT NULL THEN 1 ELSE 0 END)::int`,
        'syncedCount',
      )
      .addSelect(
        // "Should have synced but didn't" — any decision with neither signal.
        `SUM(CASE WHEN d.gateway_correction_id IS NULL AND d.gateway_synced_at IS NULL THEN 1 ELSE 0 END)::int`,
        'notSyncedCount',
      )
      .addSelect(
        // Distinct reviewer names — handy for "who touched this chart?"
        `STRING_AGG(DISTINCT COALESCE(u.full_name, u.email, 'user ' || d.decided_by_user_id::text), ', ')`,
        'coderNames',
      )
      .addSelect('COUNT(DISTINCT d.decided_by_user_id)::int', 'coderCount')
      .where(`d.chart_id IN (${matchingChartIds.getQuery()})`)
      .setParameters(matchingChartIds.getParameters())
      .groupBy('d.chart_id')
      .orderBy('MAX(d.decided_at)', 'DESC');

    if (q.chartNo) qb.andWhere('c.chart_no ILIKE :chartNo', { chartNo: `%${q.chartNo}%` });
    if (q.from)    qb.andHaving('MAX(d.decided_at) >= :from', { from: `${q.from}T00:00:00Z` });
    if (q.to)      qb.andHaving('MAX(d.decided_at) <= :to',   { to:   `${q.to}T23:59:59.999Z` });

    return { qb, matchingChartIds };
  }

  /** Shapes one raw aggregate row into the API/Excel row object. */
  private mapChartRow(r: any) {
    return {
      chartId: Number(r.chartId),
      chartNo: r.chartNo as string | null,
      clientName: (r.clientName as string | null) ?? null,
      locationName: (r.locationName as string | null) ?? null,
      subSpecialityName: (r.subSpecialityName as string | null) ?? null,
      receivedDate: (r.receivedDate as string | null) ?? null,
      milestone: r.milestone as string | null,
      chartStatus: r.chartStatus as string | null,
      allocatedCoderId: r.allocatedCoderId != null ? Number(r.allocatedCoderId) : null,
      allocatedAuditorId: r.allocatedAuditorId != null ? Number(r.allocatedAuditorId) : null,
      totalDecisions: r.totalDecisions ?? 0,
      accepted: r.accepted ?? 0,
      rejected: r.rejected ?? 0,
      edited: r.edited ?? 0,
      added: r.added ?? 0,
      syncedCount: r.syncedCount ?? 0,
      notSyncedCount: r.notSyncedCount ?? 0,
      coderNames: (r.coderNames as string | null) ?? '',
      coderCount: r.coderCount ?? 0,
      lastDecidedAt: r.lastDecidedAt as string,
    };
  }

  /**
   * The chart-centric list rendered to an .xlsx workbook: same filters, no
   * pagination (capped at EXPORT_ROW_LIMIT). Columns mirror the on-screen table
   * plus the worklist context so the file is self-contained for offline review.
   */
  async exportChartsXlsx(q: ListChartsWithDecisionsDto): Promise<Buffer> {
    const { qb } = this.buildChartsAggregateQuery(q);
    const rows = (await qb.limit(EXPORT_ROW_LIMIT).getRawMany()).map((r) => this.mapChartRow(r));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Valerion';
    wb.created = new Date();
    const ws = wb.addWorksheet('Code decisions', {
      views: [{ state: 'frozen', ySplit: 1 }], // freeze header row when scrolling
    });

    ws.columns = [
      { header: 'Chart', key: 'chartNo', width: 18 },
      { header: 'Client', key: 'clientName', width: 24 },
      { header: 'Location', key: 'locationName', width: 24 },
      { header: 'Sub-speciality', key: 'subSpecialityName', width: 22 },
      { header: 'Received date', key: 'receivedDate', width: 16, style: { numFmt: 'yyyy-mm-dd' } },
      { header: 'Milestone', key: 'milestone', width: 18 },
      { header: 'Status', key: 'chartStatus', width: 16 },
      { header: 'Reviewer(s)', key: 'coderNames', width: 30 },
      { header: 'Decisions', key: 'totalDecisions', width: 11, style: { numFmt: '0' } },
      { header: 'Accepted', key: 'accepted', width: 10, style: { numFmt: '0' } },
      { header: 'Rejected', key: 'rejected', width: 10, style: { numFmt: '0' } },
      { header: 'Edited', key: 'edited', width: 9, style: { numFmt: '0' } },
      { header: 'Added', key: 'added', width: 9, style: { numFmt: '0' } },
      { header: 'Synced', key: 'syncedCount', width: 9, style: { numFmt: '0' } },
      { header: 'Not synced', key: 'notSyncedCount', width: 11, style: { numFmt: '0' } },
      { header: 'Date of coding', key: 'lastDecidedAt', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    ];

    const header = ws.getRow(1);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    header.alignment = { vertical: 'middle' };

    for (const r of rows) {
      ws.addRow({
        ...r,
        // Dates as real Date cells so Excel formats/sorts them as dates.
        receivedDate: r.receivedDate ? new Date(`${r.receivedDate}T00:00:00`) : null,
        lastDecidedAt: r.lastDecidedAt ? new Date(r.lastDecidedAt) : null,
      });
    }

    // ── Sheet 2: "Decision details" — one row per individual decision behind
    // the charts above, carrying the exact verdict plus the rejection / edit
    // reasons and edited values the coder actually entered. The summary sheet
    // only has per-chart counts, so this is where a reviewer sees *why* a code
    // was rejected or *what* an edit changed.
    const detail = await this.decisionsForCharts(rows.map((r) => r.chartId));
    const ds = wb.addWorksheet('Decision details', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const wrap = { alignment: { wrapText: true, vertical: 'top' as const } };
    ds.columns = [
      { header: 'Chart', key: 'chartNo', width: 18 },
      { header: 'Code type', key: 'codeType', width: 12 },
      { header: 'Code', key: 'codeValue', width: 14 },
      { header: 'Decision', key: 'decision', width: 12 },
      { header: 'Edited code', key: 'editedCode', width: 14 },
      { header: 'Original description', key: 'originalDescription', width: 42, style: wrap },
      { header: 'Edited description', key: 'editedDescription', width: 42, style: wrap },
      { header: 'Reason (category)', key: 'reasonDropdown', width: 28, style: wrap },
      { header: 'Reason (detail)', key: 'reasonText', width: 50, style: wrap },
      { header: 'Reviewer', key: 'decidedByName', width: 24 },
      { header: 'Synced', key: 'synced', width: 9 },
      { header: 'Date of coding', key: 'decidedAt', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    ];
    const dHeader = ds.getRow(1);
    dHeader.font = { bold: true };
    dHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    dHeader.alignment = { vertical: 'middle' };

    for (const r of detail) {
      ds.addRow({
        chartNo: r.chartNo ?? null,
        codeType: r.codeType ?? null,
        codeValue: r.codeValue ?? null,
        decision: r.decision ?? null,
        editedCode: r.editedCode ?? null,
        originalDescription: r.originalDescription ?? null,
        editedDescription: r.editedDescription ?? null,
        reasonDropdown: r.reasonDropdown ?? null,
        reasonText: r.reasonText ?? null,
        decidedByName: r.decidedByName ?? r.decidedByEmail ?? null,
        synced: r.gatewayCorrectionId || r.gatewaySyncedAt ? 'Yes' : 'No',
        decidedAt: r.decidedAt ? new Date(r.decidedAt) : null,
      });
    }

    return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
  }

  /**
   * Flat per-decision rows for the export's "Decision details" sheet — every
   * decision on the given charts, joined with the deciding user, including the
   * reason + edited-value fields the summary aggregates away. Ordered by chart
   * then time so a chart's decisions read top-to-bottom; capped like the
   * summary so a huge filter can't pull an unbounded result set.
   */
  private async decisionsForCharts(chartIds: number[]) {
    if (!chartIds.length) return [] as any[];
    return this.decisions
      .createQueryBuilder('d')
      .leftJoin(Chart, 'c', 'c.id = d.chart_id')
      .leftJoin(User, 'u', 'u.id = d.decided_by_user_id')
      .select([
        'c.chart_no AS "chartNo"',
        'd.code_type AS "codeType"',
        'd.code_value AS "codeValue"',
        'd.decision AS decision',
        'd.edited_code AS "editedCode"',
        'd.original_description AS "originalDescription"',
        'd.edited_description AS "editedDescription"',
        'd.reason_dropdown AS "reasonDropdown"',
        'd.reason_text AS "reasonText"',
        'u.full_name AS "decidedByName"',
        'u.email AS "decidedByEmail"',
        'd.gateway_correction_id AS "gatewayCorrectionId"',
        'd.gateway_synced_at AS "gatewaySyncedAt"',
        'd.decided_at AS "decidedAt"',
      ])
      .where('d.chart_id IN (:...chartIds)', { chartIds })
      .orderBy('c.chart_no', 'ASC')
      .addOrderBy('d.code_type', 'ASC')
      .addOrderBy('d.decided_at', 'ASC')
      .limit(EXPORT_ROW_LIMIT)
      .getRawMany();
  }

  /**
   * One-stop chart detail: metadata, every code the AI predicted for this
   * chart's encounter (live from the gateway), and every coder decision
   * recorded locally, joined with the gateway's corresponding
   * coder_corrections rows (bulk-fetched in one /admin/corrections call
   * keyed by encounter_id, then matched by gateway_correction_id).
   */
  async chartDetail(chartId: number) {
    const chart = await this.charts.findOne({ where: { id: chartId } });
    if (!chart) {
      throw new NotFoundException({ error: { code: 'not_found', message: `Chart ${chartId} not found.` } });
    }
    const cf = (chart.customFields ?? {}) as Record<string, any>;
    const encounterId: string | null =
      typeof cf?.aiPrediction?.encounterId === 'string' && cf.aiPrediction.encounterId.trim()
        ? cf.aiPrediction.encounterId
        : null;

    // Live AI codes from the gateway (we keep our locally-cached copy too in
    // case the gateway is unreachable — best-effort fallback below).
    let aiCodes: PredictedCodeReviewItem[] = [];
    let aiCodesError: string | null = null;
    if (encounterId) {
      try {
        aiCodes = await this.gateway.getEncounterCodes(encounterId);
      } catch (err) {
        aiCodesError = (err as Error)?.message ?? 'failed to load AI codes';
        this.log.warn(`chartDetail(${chartId}): gateway codes fetch failed — ${aiCodesError}`);
      }
    }

    // All decisions on this chart, joined with the deciding user.
    const decisions = await this.decisions
      .createQueryBuilder('d')
      .leftJoin(User, 'u', 'u.id = d.decided_by_user_id')
      .select([
        'd.id AS id',
        'd.chart_id AS "chartId"',
        'd.code_type AS "codeType"',
        'd.code_value AS "codeValue"',
        'd.predicted_code_id AS "predictedCodeId"',
        'd.original_description AS "originalDescription"',
        'd.decision AS decision',
        'd.edited_code AS "editedCode"',
        'd.edited_description AS "editedDescription"',
        'd.reason_dropdown AS "reasonDropdown"',
        'd.reason_text AS "reasonText"',
        'd.gateway_correction_id AS "gatewayCorrectionId"',
        'd.gateway_synced_at AS "gatewaySyncedAt"',
        'd.decided_by_user_id AS "decidedByUserId"',
        'u.email AS "decidedByEmail"',
        'u.full_name AS "decidedByName"',
        'u.role AS "decidedByRole"',
        'd.decided_at AS "decidedAt"',
      ])
      .where('d.chart_id = :chartId', { chartId })
      .orderBy('d.decided_at', 'DESC')
      .getRawMany();

    // Bulk-fetch the gateway's coder_corrections for this encounter so the FE
    // can render the side-by-side without one round-trip per decision. Only
    // worthwhile if we have an encounter and at least one decision with a
    // stored correction_id (no stored id → no row to fetch).
    const byCorrectionId = new Map<string, GatewayCorrection>();
    let correctionsError: string | null = null;
    const hasAnyStored = decisions.some((d) => d.gatewayCorrectionId);
    if (encounterId && hasAnyStored) {
      try {
        const res = await this.gateway.listCorrections({
          encounter_id: encounterId,
          limit: 200,
        });
        for (const c of res.items ?? []) byCorrectionId.set(c.id, c);
      } catch (err) {
        correctionsError = (err as Error)?.message ?? 'failed to load gateway corrections';
        this.log.warn(`chartDetail(${chartId}): gateway corrections fetch failed — ${correctionsError}`);
      }
    }

    return {
      chart: {
        id: Number(chart.id),
        chartNo: chart.chartNo ?? null,
        milestone: chart.milestone,
        chartStatus: chart.chartStatus,
        priority: chart.priority,
        allocatedCoderId: chart.allocatedCoderId ?? null,
        allocatedAuditorId: chart.allocatedAuditorId ?? null,
        worklistId: Number(chart.worklistId),
        encounterId,
        createdAt: chart.createdAt,
        updatedAt: chart.updatedAt,
      },
      aiCodes,
      aiCodesError,
      decisions: decisions.map((r) => ({
        ...r,
        id: Number(r.id),
        chartId: Number(r.chartId),
        decidedByUserId: Number(r.decidedByUserId),
        // Inline the gateway correction (if any) so the FE doesn't have to
        // make a separate call per row.
        gatewayCorrection: r.gatewayCorrectionId
          ? byCorrectionId.get(r.gatewayCorrectionId) ?? null
          : null,
      })),
      correctionsError,
    };
  }
}
