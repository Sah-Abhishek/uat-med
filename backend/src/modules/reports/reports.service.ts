import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import * as ExcelJS from 'exceljs';

import { ReportTemplate } from '../../entities/report-template.entity';
import { Chart } from '../../entities/chart.entity';
import { Role } from '../../common/enums/roles.enum';
import { AuthenticatedUser } from '../../common/types/request-user.type';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { QueryReportDto } from './dto/query-report.dto';
import { SaveTemplateDto } from './dto/save-template.dto';

/**
 * Catalog of report fields. Each entry declares:
 *   - key:        the FE-facing identifier (used as Customize-columns checkbox + filter key)
 *   - label:      the column header users see in the table and the Excel sheet
 *   - sql:        the SQL expression that produces the value (after the JOIN block in build())
 *   - filterable: whether the FE may pass `filters[key]` (we apply a case-insensitive substring match)
 *   - sortable:   whether the FE may pass `sort[].key`
 *
 * Adding a new field is as simple as appending an entry here — the runQuery,
 * filtering, sorting, and Excel export all read from this single source of truth.
 */
/**
 * How the FE should render this field's filter control:
 *   - text:   a free-text substring input (worklist/chart/serial/MR numbers)
 *   - date:   a date-range picker → { from, to }
 *   - select: a multi-select dropdown → string[] (IN-clause). Options are either
 *             the static `options` on the field (enums) or, when omitted, the
 *             distinct values present in the data (GET /reports/field-values).
 */
export type FilterKind = 'text' | 'date' | 'select';

export interface FilterOption {
  value: string;
  label: string;
}

interface FieldDef {
  key: string;
  label: string;
  sql: string;
  filterable: boolean;
  sortable: boolean;
  /** Treat the value as a date when set; ExcelJS will format it accordingly. */
  type?: 'date' | 'number';
  /** Override the FE filter control. Defaults: date type → 'date', else 'select'. */
  filterKind?: FilterKind;
  /** Static labelled options for a `select` filter (enums). Omit → FE fetches
   *  distinct values live from /reports/field-values. */
  options?: FilterOption[];
  /** Source dropdown options from a master table's distinct names instead of
   *  the (possibly sparse) chart data. Use for configured pick-lists whose FK
   *  is rarely populated on charts (hold reason, responsible party, health
   *  plan) — otherwise the dropdown would show only values already in use. */
  valuesFrom?: { table: string; column: string };
}

// Enum option lists mirror the Charts filter modal so the two pages read the
// same labels. `select` fields without static options are populated live.
const CHART_STATUS_OPTIONS: FilterOption[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'COMPLETE', label: 'Complete' },
  { value: 'INCOMPLETE', label: 'Incomplete' },
  { value: 'HOLD', label: 'Hold' },
];
const MILESTONE_OPTIONS: FilterOption[] = [
  { value: 'READY_TO_CODE', label: 'Ready to Code' },
  { value: 'CODING_IN_PROGRESS', label: 'Coding' },
  { value: 'CODING_DONE', label: 'Coding Done' },
  { value: 'READY_TO_AUDIT', label: 'Ready to Audit' },
  { value: 'AUDIT_IN_PROGRESS', label: 'Auditing' },
  { value: 'AUDIT_DONE', label: 'Audit Done' },
  { value: 'CLOSED', label: 'Closed' },
];
const PRIORITY_OPTIONS: FilterOption[] = [
  { value: 'CRITICAL', label: 'Critical' },
  { value: 'HIGH', label: 'High' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LOW', label: 'Low' },
  // Stored as FINALIZED; shown as "Done" everywhere in the UI.
  { value: 'FINALIZED', label: 'Done' },
];
/**
 * Sentinel option value meaning "no value set". When present in a select
 * filter's array, applyFilters matches rows where the field IS NULL or empty
 * (rather than a literal match). Lets a dropdown offer a "Blank" choice.
 */
const BLANK_FILTER_VALUE = '__BLANK__';
const QC_STATUS_OPTIONS: FilterOption[] = [
  { value: 'Agree', label: 'Agree' },
  { value: 'Feedback Implemented', label: 'Feedback Implemented' },
  { value: 'Feedback Rejected', label: 'Feedback Rejected' },
  { value: 'Feedback Provided', label: 'Feedback Provided' },
  { value: BLANK_FILTER_VALUE, label: 'Blank' },
];

const FIELDS: FieldDef[] = [
  { key: 'worklistNumber',    label: 'Worklist Number',    sql: 'wl.worklist_number',                       filterable: true,  sortable: true,  filterKind: 'text' },
  { key: 'serialNo',          label: 'S.No',               sql: 'c.serial_no',                              filterable: true,  sortable: true,  type: 'number', filterKind: 'text' },
  { key: 'chartNo',           label: 'Chart Number',       sql: 'c.chart_no',                               filterable: true,  sortable: true,  filterKind: 'text' },
  { key: 'mrNumber',          label: 'MR Number',          sql: 'c.mr_number',                              filterable: true,  sortable: true,  filterKind: 'text' },
  { key: 'client',            label: 'Client',             sql: 'cl.name',                                  filterable: true,  sortable: true },
  { key: 'location',          label: 'Location',           sql: 'lo.name',                                  filterable: true,  sortable: true },
  { key: 'primarySpeciality', label: 'Primary Speciality', sql: 'ps.name',                                  filterable: true,  sortable: true },
  { key: 'process',           label: 'Process',            sql: 'pr.name',                                  filterable: true,  sortable: true },
  { key: 'dos',               label: 'Date of Service',    sql: 'c.dos',                                    filterable: true,  sortable: true,  type: 'date' },
  { key: 'receivedDate',      label: 'Received Date',      sql: 'wl.received_date',                         filterable: true,  sortable: true,  type: 'date' },
  { key: 'dateOfCompletion',  label: 'Date of Completion', sql: `CASE WHEN c.chart_status = 'COMPLETE' THEN c.updated_at ELSE NULL END`, filterable: true, sortable: true, type: 'date' },
  { key: 'codingCompletedAt', label: 'Date of Coding',     sql: 'c.coding_completed_at',                     filterable: true,  sortable: true,  type: 'date' },
  { key: 'allocatedCoder',    label: 'Allocated Coder',    sql: 'uc.full_name',                             filterable: true,  sortable: true },
  { key: 'allocatedAuditor',  label: 'Allocated Auditor',  sql: 'ua.full_name',                             filterable: true,  sortable: true },
  { key: 'milestone',         label: 'Milestone',          sql: 'c.milestone',                              filterable: true,  sortable: true,  options: MILESTONE_OPTIONS },
  { key: 'chartStatus',       label: 'Chart Status',       sql: 'c.chart_status',                           filterable: true,  sortable: true,  options: CHART_STATUS_OPTIONS },
  { key: 'priority',          label: 'Priority',           sql: 'c.priority',                               filterable: true,  sortable: true,  options: PRIORITY_OPTIONS },
  { key: 'holdReason',        label: 'Hold Reason',        sql: `CASE WHEN jsonb_typeof(c.custom_fields#>'{_formDraft,holdReason}')='array' THEN (SELECT string_agg(v, ', ') FROM jsonb_array_elements_text(c.custom_fields#>'{_formDraft,holdReason}') v) END`, filterable: true,  sortable: true,  valuesFrom: { table: 'hold_reasons',        column: 'name' } },
  { key: 'responsibleParty',  label: 'Responsible Party',  sql: `CASE WHEN jsonb_typeof(c.custom_fields#>'{_formDraft,responsibleParty}')='array' THEN (SELECT string_agg(v, ', ') FROM jsonb_array_elements_text(c.custom_fields#>'{_formDraft,responsibleParty}') v) END`, filterable: true,  sortable: true,  valuesFrom: { table: 'responsible_parties', column: 'name' } },
  { key: 'primaryHealthPlan', label: 'Primary Health Plan',sql: `c.custom_fields#>>'{_formDraft,primaryHealth}'`,                                 filterable: true,  sortable: true,  valuesFrom: { table: 'primary_health_plans', column: 'name' } },
  { key: 'facility',          label: 'Facility',           sql: `c.custom_fields#>>'{_formDraft,facility}'`,             filterable: true,  sortable: true,  filterKind: 'select' },
  { key: 'primaryDiagnosis',  label: 'Primary Diagnosis',  sql: 'c.primary_diagnosis',                      filterable: true,  sortable: true },
  { key: 'secondaryDiagnoses',label: 'Secondary Dx',       sql: `CASE WHEN jsonb_typeof(c.custom_fields#>'{aiPrediction,secondary}')='array' THEN (SELECT string_agg(e->>'code', ', ') FROM jsonb_array_elements(c.custom_fields#>'{aiPrediction,secondary}') e) END`, filterable: false, sortable: false },
  { key: 'emLevel',           label: 'E/M Level',          sql: 'c.em_level',                               filterable: true,  sortable: true },
  { key: 'coderCommentsToClient', label: 'Coder Comments to Client', sql: 'c.coder_comments_to_client',       filterable: true,  sortable: false, filterKind: 'text' },
  { key: 'facilityEM',        label: 'Facility E/M',       sql: `(SELECT c.custom_fields->>(cfc.id::text) FROM custom_field_configs cfc WHERE cfc.name='Facility E/M' AND cfc.location_id=wl.location_id LIMIT 1)`, filterable: true,  sortable: true,  filterKind: 'text' },
  { key: 'infusion',          label: 'Infusion',           sql: `(SELECT c.custom_fields->>(cfc.id::text) FROM custom_field_configs cfc WHERE cfc.name='Infusion' AND cfc.location_id=wl.location_id LIMIT 1)`, filterable: true,  sortable: true,  filterKind: 'text' },
  { key: 'qcStatus',          label: 'QC Status',          sql: `c.custom_fields#>>'{_formDraft,qcStatus}'`,             filterable: true,  sortable: false, options: QC_STATUS_OPTIONS },
  { key: 'feedbackCategory',  label: 'Feedback Category',  sql: `c.custom_fields->>'feedbackCategory'`,     filterable: true,  sortable: false },
  { key: 'feedbackType',      label: 'Feedback Type',      sql: `c.custom_fields->>'feedbackType'`,         filterable: true,  sortable: false },
];

/** Derive the FE filter control for a field (date type → date, else select). */
function filterKindOf(f: FieldDef): FilterKind {
  return f.filterKind ?? (f.type === 'date' ? 'date' : 'select');
}

const FIELD_BY_KEY = new Map(FIELDS.map(f => [f.key, f]));

/** Cap on rows we'll stream into a single Excel file synchronously. */
const EXPORT_ROW_LIMIT = 50_000;

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(ReportTemplate) private readonly templates: Repository<ReportTemplate>,
    @InjectRepository(Chart) private readonly charts: Repository<Chart>,
  ) {}

  fields() {
    return FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      filterable: f.filterable,
      sortable: f.sortable,
      type: f.type,
      filterKind: filterKindOf(f),
      options: f.options,
    }));
  }

  /**
   * Distinct values present in the reportable dataset for a single `select`
   * field, honouring the caller's role scoping. Powers the multi-select filter
   * dropdowns whose options aren't a fixed enum (client, coder, hold reason, …).
   * Enum fields ship their static option list, so we short-circuit those.
   */
  async fieldValues(key: string, search: string | undefined, user: AuthenticatedUser): Promise<string[]> {
    const f = FIELD_BY_KEY.get(key);
    if (!f || !f.filterable) return [];
    if (f.options) return f.options.map((o) => o.value);
    // Configured pick-lists source their full option set from the master table
    // (charts rarely reference them, so deriving from chart data would be empty).
    if (f.valuesFrom) return this.distinctFromTable(f.valuesFrom, search);

    const expr = f.sql;
    const qb = this.buildBaseQuery(user)
      .select(expr, 'v')
      .distinct(true)
      .andWhere(`${expr} IS NOT NULL`)
      .andWhere(`CAST(${expr} AS TEXT) <> ''`)
      .orderBy(expr, 'ASC')
      .limit(500);

    const term = search?.trim();
    if (term) qb.andWhere(`CAST(${expr} AS TEXT) ILIKE :s`, { s: `%${term}%` });

    const rows = await qb.getRawMany<{ v: unknown }>();
    return rows
      .map((r) => normalizeCell(r.v))
      .filter((v): v is string | number => v != null)
      .map(String);
  }

  /**
   * Distinct non-empty values of a single column across a whole master table
   * (deduped across locations). Powers dropdowns for configured pick-lists.
   * Names are the same strings the report SQL projects, so they slot straight
   * into the IN-clause filter.
   */
  private async distinctFromTable(src: { table: string; column: string }, search: string | undefined): Promise<string[]> {
    const col = `t.${src.column}`;
    const qb = this.charts.manager.createQueryBuilder()
      .select(col, 'v')
      .distinct(true)
      .from(src.table, 't')
      .where(`${col} IS NOT NULL`)
      .andWhere(`${col} <> ''`)
      .orderBy(col, 'ASC')
      .limit(1000);

    const term = search?.trim();
    if (term) qb.andWhere(`${col} ILIKE :s`, { s: `%${term}%` });

    const rows = await qb.getRawMany<{ v: unknown }>();
    return rows
      .map((r) => normalizeCell(r.v))
      .filter((v): v is string | number => v != null)
      .map(String);
  }

  /**
   * Tabular report query. Returns rows as `string[]` aligned with `columns`.
   * Honours every filterable field in the catalog (case-insensitive substring
   * match), every sortable field, and paginates with `page` / `pageSize`.
   */
  async runQuery(dto: QueryReportDto, user: AuthenticatedUser) {
    const columns = (dto.columns ?? []).filter(c => FIELD_BY_KEY.has(c));
    if (!columns.length) {
      return { columns: [], rows: [], total: 0, page: dto.page ?? 1, pageSize: dto.pageSize ?? 50 };
    }

    const qb = this.buildBaseQuery(user);
    this.applyFilters(qb, dto.filters);

    // Paginated count + page slice
    const total = await qb.clone().getCount();

    // Build the projection from the catalog so the SQL matches the FE-facing
    // column keys exactly.
    const select = columns.map(k => `${FIELD_BY_KEY.get(k)!.sql} AS "${k}"`);
    qb.select(select);
    qb.addSelect('c.id', 'id');

    this.applySort(qb, dto.sort);

    const page = Math.max(1, dto.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, dto.pageSize ?? 50));
    qb.offset((page - 1) * pageSize).limit(pageSize);

    const records = await qb.getRawMany<Record<string, unknown>>();
    const rows = records.map(r => columns.map(k => normalizeCell(r[k])));

    return { columns, rows, total, page, pageSize };
  }

  /**
   * Synchronously builds an XLSX workbook for the given report query and
   * returns it as a Buffer the controller streams to the client. Respects the
   * caller's filters; ignores pagination (capped at EXPORT_ROW_LIMIT to keep
   * the response bounded).
   */
  async exportToExcel(dto: QueryReportDto, user: AuthenticatedUser): Promise<Buffer> {
    const columns = (dto.columns ?? []).filter(c => FIELD_BY_KEY.has(c));
    if (!columns.length) {
      throw new NotFoundException('No valid columns selected for export.');
    }

    const qb = this.buildBaseQuery(user);
    this.applyFilters(qb, dto.filters);

    const select = columns.map(k => `${FIELD_BY_KEY.get(k)!.sql} AS "${k}"`);
    qb.select(select);
    this.applySort(qb, dto.sort);
    qb.limit(EXPORT_ROW_LIMIT);

    const records = await qb.getRawMany<Record<string, unknown>>();

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Valerion Reports';
    wb.created = new Date();

    const ws = wb.addWorksheet('Report', {
      views: [{ state: 'frozen', ySplit: 1 }], // freeze header row when scrolling
    });

    ws.columns = columns.map(key => {
      const f = FIELD_BY_KEY.get(key)!;
      return {
        header: f.label,
        key,
        width: Math.min(40, Math.max(12, f.label.length + 4)),
        style: f.type === 'date'
          ? { numFmt: 'yyyy-mm-dd' }
          : f.type === 'number'
          ? { numFmt: '0' }
          : undefined,
      };
    });

    // Style header row
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEFEFEF' },
    };
    header.alignment = { vertical: 'middle' };

    for (const r of records) {
      const row: Record<string, unknown> = {};
      for (const k of columns) {
        const f = FIELD_BY_KEY.get(k)!;
        const v = r[k];
        row[k] = f.type === 'date' && v ? new Date(v as string) : normalizeCell(v);
      }
      ws.addRow(row);
    }

    // ExcelJS types `writeBuffer` as `Promise<ArrayBuffer>` in some setups,
    // but at runtime it returns a Node Buffer. Casting via unknown keeps the
    // controller's `res.send(buffer)` happy on every path.
    return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
  }

  /* ── Templates ───────────────────────────────────────── */

  async listTemplates(page: number, pageSize: number, user: AuthenticatedUser) {
    const qb = this.templates.createQueryBuilder('t')
      .where('t.owner_id = :uid OR t.is_shared = true', { uid: user.id })
      .orderBy('t.updated_at', 'DESC')
      .skip((page - 1) * pageSize).take(pageSize);
    const [items, total] = await qb.getManyAndCount();
    return new PaginatedResponseDto(items, total, page, pageSize);
  }

  async createTemplate(dto: SaveTemplateDto, ownerId: number) {
    const t = await this.templates.save(this.templates.create({
      ownerId,
      name: dto.name,
      columns: dto.columns,
      filters: dto.filters ?? {},
      isShared: dto.isShared ?? false,
    }));
    return { id: t.id };
  }

  async getTemplate(id: number, user: AuthenticatedUser) {
    const t = await this.templates.findOne({ where: { id } });
    if (!t) throw new NotFoundException();
    if (!t.isShared && t.ownerId !== user.id && user.role !== Role.TEAMLEAD && user.role !== Role.MANAGER) {
      throw new ForbiddenException();
    }
    return t;
  }

  async updateTemplate(id: number, dto: SaveTemplateDto, user: AuthenticatedUser) {
    const t = await this.templates.findOne({ where: { id } });
    if (!t) throw new NotFoundException();
    if (t.ownerId !== user.id && user.role !== Role.TEAMLEAD && user.role !== Role.MANAGER) {
      throw new ForbiddenException();
    }
    Object.assign(t, dto);
    return this.templates.save(t);
  }

  async deleteTemplate(id: number, user: AuthenticatedUser) {
    const t = await this.templates.findOne({ where: { id } });
    if (!t) throw new NotFoundException();
    if (t.ownerId !== user.id && user.role !== Role.TEAMLEAD && user.role !== Role.MANAGER) {
      throw new ForbiddenException();
    }
    await this.templates.delete(id);
    return { status: 'deleted' };
  }

  /* ── Internals ───────────────────────────────────────── */

  /**
   * The single JOIN graph used by both runQuery and exportToExcel — keeps
   * SELECT projections in lockstep regardless of which entry point is hit.
   */
  private buildBaseQuery(user: AuthenticatedUser): SelectQueryBuilder<Chart> {
    const qb = this.charts.createQueryBuilder('c')
      .leftJoin('worklists',           'wl',  'wl.id = c.worklist_id')
      .leftJoin('clients',             'cl',  'cl.id = wl.client_id')
      .leftJoin('locations',           'lo',  'lo.id = wl.location_id')
      .leftJoin('primary_specialities','ps',  'ps.id = wl.primary_speciality_id')
      .leftJoin('processes',           'pr',  'pr.id = wl.process_id')
      .leftJoin('users',               'uc',  'uc.id = c.allocated_coder_id')
      .leftJoin('users',               'ua',  'ua.id = c.allocated_auditor_id')
      .leftJoin('hold_reasons',        'hr',  'hr.id = c.hold_reason_id')
      .leftJoin('responsible_parties', 'rp',  'rp.id = c.responsible_party_id')
      .leftJoin('primary_health_plans','php', 'php.id = c.primary_health_plan_id')
      .where('c.deleted_at IS NULL');

    // Role scoping: coder/auditor can never reach this endpoint via FE, but
    // belt-and-braces here in case the controller guard is loosened.
    if (user.role === Role.CODER) {
      qb.andWhere('c.allocated_coder_id = :uid', { uid: user.id });
    } else if (user.role === Role.AUDITOR) {
      qb.andWhere('c.allocated_auditor_id = :uid', { uid: user.id });
    }
    return qb;
  }

  /**
   * Apply filters from the catalog. String fields get a case-insensitive
   * substring match (ILIKE %v%). Arrays become IN-clauses. Date ranges accept
   * either { from, to } or a single { from } / { to }.
   */
  private applyFilters(qb: SelectQueryBuilder<Chart>, filters: Record<string, any> | undefined) {
    if (!filters) return;
    let i = 0;
    for (const [key, raw] of Object.entries(filters)) {
      const f = FIELD_BY_KEY.get(key);
      if (!f || !f.filterable) continue;
      if (raw === '' || raw == null) continue;

      const expr = f.sql;

      if (Array.isArray(raw)) {
        if (!raw.length) continue;
        // A "Blank" option (sentinel) matches NULL/empty rather than a literal;
        // split it out so the rest still go through a plain IN-clause. Both are
        // OR'd so "Agree" + "Blank" means "= Agree OR is unset".
        const values = raw.map((v) => String(v));
        const concrete = values.filter((v) => v !== BLANK_FILTER_VALUE);
        const wantsBlank = values.includes(BLANK_FILTER_VALUE);
        const clauses: string[] = [];
        const params: Record<string, unknown> = {};
        if (concrete.length) {
          const p = `f${i++}`;
          clauses.push(`${expr} IN (:...${p})`);
          params[p] = concrete;
        }
        if (wantsBlank) {
          clauses.push(`(${expr} IS NULL OR CAST(${expr} AS TEXT) = '')`);
        }
        if (clauses.length) qb.andWhere(`(${clauses.join(' OR ')})`, params);
        continue;
      }

      if (typeof raw === 'object' && (('from' in raw) || ('to' in raw))) {
        // For date fields, cast to DATE so both bounds are inclusive by calendar
        // day even when the column carries a time component (e.g. updated_at).
        const lhs = f.type === 'date' ? `CAST(${expr} AS DATE)` : expr;
        if (raw.from) {
          const p = `f${i++}`;
          qb.andWhere(`${lhs} >= :${p}`, { [p]: raw.from });
        }
        if (raw.to) {
          const p = `f${i++}`;
          qb.andWhere(`${lhs} <= :${p}`, { [p]: raw.to });
        }
        continue;
      }

      const p = `f${i++}`;
      qb.andWhere(`CAST(${expr} AS TEXT) ILIKE :${p}`, { [p]: `%${String(raw)}%` });
    }
  }

  private applySort(qb: SelectQueryBuilder<Chart>, sort: Array<{ key: string; dir: 'asc' | 'desc' }> | undefined) {
    if (!sort?.length) {
      qb.orderBy('c.created_at', 'DESC');
      return;
    }
    sort.forEach((s, idx) => {
      const f = FIELD_BY_KEY.get(s.key);
      if (!f || !f.sortable) return;
      const dir = s.dir === 'desc' ? 'DESC' : 'ASC';
      const action = idx === 0 ? 'orderBy' : 'addOrderBy';
      qb[action](f.sql, dir);
    });
  }
}

/**
 * Postgres returns dates as Date objects, jsonb as parsed objects/arrays, and
 * bigints as strings. Coerce each to something the FE table can render and
 * Excel will format predictably.
 */
function normalizeCell(v: unknown): string | number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'bigint') return Number(v);
  return v as string | number;
}
