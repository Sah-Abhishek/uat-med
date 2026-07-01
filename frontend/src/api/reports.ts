import { api, get, post, put, del } from './client';
import type {
  Paginated,
  ReportField,
  ReportQueryResult,
  ReportTemplate,
  SortDir,
} from './types';

/* ── Field catalog ─────────────────────────────────────── */

export const getReportFields = () => get<ReportField[]>('/reports/fields');

/**
 * Distinct values present in the reportable data for a single `select` filter
 * field (e.g. all client names, coder names). Optional `search` narrows the
 * list server-side so large fields (diagnoses, users) stay responsive.
 */
export const getReportFieldValues = (key: string, search?: string) =>
  get<string[]>('/reports/field-values', { key, ...(search ? { search } : {}) });

/* ── Run query ─────────────────────────────────────────── */

export interface QueryReportDto {
  columns: string[];
  filters?: Record<string, unknown>;
  sort?: Array<{ key: string; dir: SortDir }>;
  page?: number;
  pageSize?: number;
}

export const runReportQuery = (dto: QueryReportDto) =>
  post<ReportQueryResult>('/reports/query', dto);

/* ── Templates ─────────────────────────────────────────── */

export const listReportTemplates = (page = 1, pageSize = 50) =>
  get<Paginated<ReportTemplate>>('/reports/templates', { page, pageSize });

export interface SaveTemplateDto {
  name: string;
  columns: string[];
  filters?: Record<string, unknown>;
  isShared?: boolean;
}

export const createReportTemplate = (dto: SaveTemplateDto) =>
  post<{ id: string }>('/reports/templates', dto);

export const getReportTemplate = (id: string | number) =>
  get<ReportTemplate>(`/reports/templates/${id}`);

export const updateReportTemplate = (id: string | number, dto: SaveTemplateDto) =>
  put<ReportTemplate>(`/reports/templates/${id}`, dto);

export const deleteReportTemplate = (id: string | number) =>
  del<{ status: string }>(`/reports/templates/${id}`);

/* ── Excel download ────────────────────────────────────── */

/**
 * Hits POST /reports/export.xlsx, receives the workbook as a binary blob,
 * and triggers a browser download. Filename is derived from the active
 * template name when supplied, otherwise stamped with today's date.
 */
export async function downloadReportXlsx(
  dto: Omit<QueryReportDto, 'page' | 'pageSize'>,
  filenameHint?: string,
): Promise<void> {
  const res = await api.post('/reports/export.xlsx', dto, { responseType: 'blob' });

  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = (filenameHint ?? 'valerion-report')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'valerion-report';

  const blob = res.data as Blob;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}-${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
