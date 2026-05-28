import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillingSettings } from '../../entities/billing-settings.entity';
import { Chart } from '../../entities/chart.entity';

export interface BillingQuery {
  clientId?: number;
  locationId?: number;
  days?: number;
  endsAt?: string;
}

interface ScopeBuild {
  whereSql: string;
  params: unknown[];
  startDate: string;
  endDate: string;
}

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(BillingSettings) private readonly settings: Repository<BillingSettings>,
    @InjectRepository(Chart) private readonly charts: Repository<Chart>,
  ) {}

  /* ── Settings ───────────────────────────────────────────── */

  async getSettings(): Promise<{ ratePerDocument: number; currency: string; updatedAt: string | null }> {
    const row = await this.settings.findOne({ where: { id: 1 } });
    if (!row) {
      return { ratePerDocument: 0, currency: 'USD', updatedAt: null };
    }
    return {
      ratePerDocument: Number(row.ratePerDocument),
      currency: row.currency,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async updateSettings(
    dto: { ratePerDocument: number; currency?: string },
    userId: number,
  ): Promise<{ ratePerDocument: number; currency: string; updatedAt: string }> {
    if (!Number.isFinite(dto.ratePerDocument) || dto.ratePerDocument < 0) {
      throw new BadRequestException('ratePerDocument must be a non-negative number.');
    }
    if (dto.ratePerDocument > 1_000_000) {
      throw new BadRequestException('ratePerDocument is too large.');
    }
    const existing = await this.settings.findOne({ where: { id: 1 } });
    const row = existing ?? this.settings.create({ id: 1 });
    row.ratePerDocument = dto.ratePerDocument.toFixed(2);
    if (dto.currency) row.currency = dto.currency;
    row.updatedByUserId = userId;
    const saved = await this.settings.save(row);
    return {
      ratePerDocument: Number(saved.ratePerDocument),
      currency: saved.currency,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  /* ── Summary ────────────────────────────────────────────── */

  /**
   * Aggregate billing for the given window. Uses chart.created_at as the
   * upload-time proxy because UploadedDocument rows don't carry their own
   * timestamp — but in practice docs are uploaded at-or-near chart creation,
   * which keeps the per-day series and window filter meaningful.
   */
  async getSummary(q: BillingQuery) {
    const settings = await this.getSettings();
    const rate = settings.ratePerDocument;

    const scope = this.buildScope(q);

    const totalsSql = `
      SELECT
        COUNT(*) FILTER (
          WHERE (c.custom_fields ? 'uploadedDocs')
            AND jsonb_typeof(c.custom_fields->'uploadedDocs') = 'array'
            AND jsonb_array_length(c.custom_fields->'uploadedDocs') > 0
        )::int AS total_charts,
        COALESCE(SUM(
          CASE WHEN jsonb_typeof(c.custom_fields->'uploadedDocs') = 'array'
               THEN jsonb_array_length(c.custom_fields->'uploadedDocs')
               ELSE 0 END
        ), 0)::int AS total_documents
      FROM charts c
      JOIN worklists w ON w.id = c.worklist_id
      ${scope.whereSql}
    `;
    const byClientSql = `
      SELECT
        cl.id::text AS client_id,
        cl.name AS client_name,
        COUNT(DISTINCT c.id)::int AS charts,
        COALESCE(SUM(
          CASE WHEN jsonb_typeof(c.custom_fields->'uploadedDocs') = 'array'
               THEN jsonb_array_length(c.custom_fields->'uploadedDocs')
               ELSE 0 END
        ), 0)::int AS documents
      FROM charts c
      JOIN worklists w ON w.id = c.worklist_id
      JOIN clients cl ON cl.id = w.client_id
      ${scope.whereSql}
        AND (c.custom_fields ? 'uploadedDocs')
        AND jsonb_typeof(c.custom_fields->'uploadedDocs') = 'array'
        AND jsonb_array_length(c.custom_fields->'uploadedDocs') > 0
      GROUP BY cl.id, cl.name
      ORDER BY documents DESC, cl.name ASC
    `;
    const byLocationSql = `
      SELECT
        loc.id::text AS location_id,
        loc.name AS location_name,
        cl.id::text AS client_id,
        cl.name AS client_name,
        COUNT(DISTINCT c.id)::int AS charts,
        COALESCE(SUM(
          CASE WHEN jsonb_typeof(c.custom_fields->'uploadedDocs') = 'array'
               THEN jsonb_array_length(c.custom_fields->'uploadedDocs')
               ELSE 0 END
        ), 0)::int AS documents
      FROM charts c
      JOIN worklists w ON w.id = c.worklist_id
      JOIN clients cl ON cl.id = w.client_id
      JOIN locations loc ON loc.id = w.location_id
      ${scope.whereSql}
        AND (c.custom_fields ? 'uploadedDocs')
        AND jsonb_typeof(c.custom_fields->'uploadedDocs') = 'array'
        AND jsonb_array_length(c.custom_fields->'uploadedDocs') > 0
      GROUP BY loc.id, loc.name, cl.id, cl.name
      ORDER BY documents DESC, loc.name ASC
    `;
    const perDaySql = `
      WITH days AS (
        SELECT generate_series($${scope.params.length + 1}::date, $${scope.params.length + 2}::date, INTERVAL '1 day')::date AS day
      ),
      agg AS (
        SELECT date_trunc('day', c.created_at)::date AS day,
               SUM(
                 CASE WHEN jsonb_typeof(c.custom_fields->'uploadedDocs') = 'array'
                      THEN jsonb_array_length(c.custom_fields->'uploadedDocs')
                      ELSE 0 END
               )::int AS documents
        FROM charts c
        JOIN worklists w ON w.id = c.worklist_id
        ${scope.whereSql}
          AND (c.custom_fields ? 'uploadedDocs')
          AND jsonb_typeof(c.custom_fields->'uploadedDocs') = 'array'
        GROUP BY 1
      )
      SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
             COALESCE(agg.documents, 0)::int AS documents
      FROM days
      LEFT JOIN agg ON agg.day = days.day
      ORDER BY days.day ASC
    `;
    const perDayParams = [...scope.params, scope.startDate, scope.endDate];

    const em = this.charts.manager;
    const [totalsRows, byClient, byLocation, perDay] = await Promise.all([
      em.query(totalsSql, scope.params) as Promise<Array<{ total_charts: number; total_documents: number }>>,
      em.query(byClientSql, scope.params) as Promise<Array<{ client_id: string; client_name: string; charts: number; documents: number }>>,
      em.query(byLocationSql, scope.params) as Promise<Array<{ location_id: string; location_name: string; client_id: string; client_name: string; charts: number; documents: number }>>,
      em.query(perDaySql, perDayParams) as Promise<Array<{ date: string; documents: number }>>,
    ]);

    const totals = totalsRows[0] ?? { total_charts: 0, total_documents: 0 };
    const round2 = (n: number) => Math.round(n * 100) / 100;

    return {
      ratePerDocument: rate,
      currency: settings.currency,
      window: { startDate: scope.startDate, endDate: scope.endDate, days: q.days ?? 30 },
      totals: {
        charts: Number(totals.total_charts),
        documents: Number(totals.total_documents),
        revenue: round2(Number(totals.total_documents) * rate),
      },
      byClient: byClient.map((r) => ({
        clientId: Number(r.client_id),
        clientName: r.client_name,
        charts: Number(r.charts),
        documents: Number(r.documents),
        revenue: round2(Number(r.documents) * rate),
      })),
      byLocation: byLocation.map((r) => ({
        locationId: Number(r.location_id),
        locationName: r.location_name,
        clientId: Number(r.client_id),
        clientName: r.client_name,
        charts: Number(r.charts),
        documents: Number(r.documents),
        revenue: round2(Number(r.documents) * rate),
      })),
      perDay: perDay.map((r) => ({
        date: r.date,
        documents: Number(r.documents),
        revenue: round2(Number(r.documents) * rate),
      })),
    };
  }

  /* ── Drill-down: charts list ────────────────────────────── */

  async listCharts(q: BillingQuery & { page?: number; pageSize?: number }) {
    const settings = await this.getSettings();
    const rate = settings.ratePerDocument;

    const scope = this.buildScope(q);
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20)));
    const offset = (page - 1) * pageSize;

    const baseWhere = `${scope.whereSql}
      AND (c.custom_fields ? 'uploadedDocs')
      AND jsonb_typeof(c.custom_fields->'uploadedDocs') = 'array'
      AND jsonb_array_length(c.custom_fields->'uploadedDocs') > 0`;

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM charts c
      JOIN worklists w ON w.id = c.worklist_id
      ${baseWhere}
    `;
    const listSql = `
      SELECT
        c.id::text AS chart_id,
        c.chart_no AS chart_no,
        w.worklist_number AS worklist_number,
        cl.name AS client_name,
        loc.name AS location_name,
        c.created_at AS uploaded_at,
        jsonb_array_length(c.custom_fields->'uploadedDocs')::int AS documents
      FROM charts c
      JOIN worklists w ON w.id = c.worklist_id
      JOIN clients cl ON cl.id = w.client_id
      JOIN locations loc ON loc.id = w.location_id
      ${baseWhere}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const em = this.charts.manager;
    const [countRows, items] = await Promise.all([
      em.query(countSql, scope.params) as Promise<Array<{ total: number }>>,
      em.query(listSql, scope.params) as Promise<Array<{
        chart_id: string; chart_no: string | null; worklist_number: string | null;
        client_name: string | null; location_name: string | null;
        uploaded_at: Date; documents: number;
      }>>,
    ]);

    const total = countRows[0]?.total ?? 0;
    const round2 = (n: number) => Math.round(n * 100) / 100;

    return {
      page,
      pageSize,
      total: Number(total),
      ratePerDocument: rate,
      currency: settings.currency,
      items: items.map((r) => ({
        chartId: r.chart_id,
        chartNo: r.chart_no,
        worklistNumber: r.worklist_number,
        clientName: r.client_name,
        locationName: r.location_name,
        uploadedAt: r.uploaded_at instanceof Date ? r.uploaded_at.toISOString() : r.uploaded_at,
        documents: Number(r.documents),
        amount: round2(Number(r.documents) * rate),
      })),
    };
  }

  /* ── Scope helpers ──────────────────────────────────────── */

  private buildScope(q: BillingQuery): ScopeBuild {
    const days = Math.max(1, Math.min(365, Number(q.days ?? 30)));
    const endDate = parseDate(q.endsAt) ?? todayLocalISODate();
    const startDate = isoDateMinusDays(endDate, days - 1);

    const params: unknown[] = [startDate, endDate];
    const where: string[] = [
      'c.deleted_at IS NULL',
      'w.deleted_at IS NULL',
      `c.created_at >= $1::date`,
      `c.created_at < ($2::date + INTERVAL '1 day')`,
    ];

    if (q.clientId) {
      params.push(Number(q.clientId));
      where.push(`w.client_id = $${params.length}`);
    }
    if (q.locationId) {
      params.push(Number(q.locationId));
      where.push(`w.location_id = $${params.length}`);
    }
    return {
      whereSql: `WHERE ${where.join(' AND ')}`,
      params,
      startDate,
      endDate,
    };
  }
}

function todayLocalISODate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function isoDateMinusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}

function parseDate(v: string | undefined): string | null {
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
