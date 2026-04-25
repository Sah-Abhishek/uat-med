import { get, post, put, del } from './client';
import type {
  ExportFormat,
  ExportTask,
  Paginated,
  ReportField,
  ReportQueryResult,
  ReportTemplate,
  SortDir,
} from './types';

/* ── Field catalog ─────────────────────────────────────── */

export const getReportFields = () => get<ReportField[]>('/reports/fields');

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

export const listReportTemplates = () =>
  get<Paginated<ReportTemplate>>('/reports/templates');

export interface SaveTemplateDto {
  name: string;
  columns: string[];
  filters?: Record<string, unknown>;
  isShared?: boolean;
}

export const createReportTemplate = (dto: SaveTemplateDto) =>
  post<{ id: string }>('/reports/templates', dto);

export const getReportTemplate = (id: string) =>
  get<ReportTemplate>(`/reports/templates/${id}`);

export const updateReportTemplate = (id: string, dto: SaveTemplateDto) =>
  put<ReportTemplate>(`/reports/templates/${id}`, dto);

export const deleteReportTemplate = (id: string) =>
  del<{ status: string }>(`/reports/templates/${id}`);

/* ── Async export ──────────────────────────────────────── */

export interface ExportRequest {
  columns: string[];
  filters?: Record<string, unknown>;
  format: ExportFormat;
}

export const startReportExport = (dto: ExportRequest) =>
  post<{ taskId: string; status: 'queued' }>('/reports/export', dto);

export const getExportStatus = (taskId: string) =>
  get<ExportTask>(`/reports/export/${taskId}`);
