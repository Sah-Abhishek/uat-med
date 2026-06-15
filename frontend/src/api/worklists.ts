import { api, get, post, patch, del } from './client';
import type {
  Paginated,
  Worklist,
  WorklistDetail,
  WorklistStatus,
  WorklistStatusSummary,
  SortDir,
} from './types';

export interface WorklistListParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: SortDir;
  status?: WorklistStatus;
  clientId?: number;
  locationId?: number;
  primarySpecialityId?: number;
  processId?: number;
  receivedDateFrom?: string;
  receivedDateTo?: string;
  search?: string;
}

export const listWorklists = (params: WorklistListParams = {}) =>
  get<Paginated<Worklist>>('/worklists', params);

export const getStatusSummary = (
  params: { clientId?: number; locationId?: number } = {},
) => get<WorklistStatusSummary>('/worklists/status-summary', params);

export const getWorklist = (id: string) =>
  get<WorklistDetail>(`/worklists/${id}`);

export interface CreateWorklistDto {
  worklistNumber: string;
  clientId: number;
  locationId: number;
  primarySpecialityId: number;
  subSpecialityId: number;
  processId: number;
  receivedDate: string;
  dateOfService?: string;
  dateOfServiceTo?: string;
  numberOfCharts?: number;
}

export const createWorklist = (dto: CreateWorklistDto) =>
  post<Worklist>('/worklists', dto);

export const updateWorklist = (id: string, dto: Partial<CreateWorklistDto>) =>
  patch<Worklist>(`/worklists/${id}`, dto);

export const deleteWorklist = (id: string, worklistNumber: string) =>
  del<{ status: string }>(`/worklists/${id}`, { worklistNumber });

export interface AllocationRange {
  from: number;
  to: number;
  assigneeId: number;
  role: 'CODER' | 'AUDITOR';
}

export const allocateWorklist = (id: string, allocations: AllocationRange[]) =>
  post<{ allocated: number; remaining: number; conflicts: unknown[] }>(
    `/worklists/${id}/allocate`,
    { allocations },
  );

export const reallocateWorklist = (id: string, range: AllocationRange) =>
  post<{ reallocated: number; remaining: number; incompleteAllocation: boolean }>(
    `/worklists/${id}/reallocate`,
    range,
  );

/* ── Bulk upload ────────────────────────────────────────── */

export interface BulkPreviewRow {
  row: number;
  chartNo: string;
  mrNumber: string;
  dos: string;
  admitDate: string;
  dischargeDate: string;
  errors: string[];
}

export interface BulkImportPreview {
  totalRows: number;
  validRows: number;
  rows: BulkPreviewRow[];
  errors: Array<{ row: number; field?: string; message: string }>;
}

export interface BulkImportResult {
  inserted: number;
  skipped: number;
  charts: Array<{ id: string; serialNo: number; chartNo: string; mrNumber: string }>;
  errors: Array<{ row: number; field?: string; message: string }>;
}

export interface BulkDocumentsResult {
  matched: Array<{
    chartId: string;
    chartNo: string;
    filename: string;
    matchedBy: 'folder' | 'chartNo' | 'mrNumber' | 'manual';
    storedKey: string;
  }>;
  unmatched: Array<{
    filename: string;
    reason: 'no_token_match' | 'ambiguous_mrn';
    /** Already uploaded to S3 — assign by reference, no re-upload needed. */
    stagedKey: string;
    stagedUrl: string;
    mimeType: string;
    size: number;
    candidates?: Array<{ chartId: string; chartNo: string }>;
  }>;
  skipped: Array<{ filename: string; reason: string }>;
}

export interface AssignStagedRequest {
  stagedKey: string;
  stagedUrl: string;
  filename: string;
  mimeType: string;
  size: number;
  chartId: string;
}

export interface AssignStagedResult {
  assigned: number;
  skipped: Array<{ stagedKey: string; reason: 'chart_not_in_worklist' | 'chart_not_found' }>;
}

export async function bulkPreviewCharts(worklistId: string, file: File): Promise<BulkImportPreview> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<BulkImportPreview>(
    `/worklists/${worklistId}/charts/bulk-preview`,
    form,
  );
  return data;
}

export interface AddChartItem {
  chartNo?: string;
  mrNumber?: string;
  dos?: string;
  admitDate?: string;
  dischargeDate?: string;
}

export interface AddChartsRequest {
  /** Charts to add with details entered by hand. */
  charts?: AddChartItem[];
  /** Number of blank placeholder charts to add (no details). */
  blankCount?: number;
}

/** Manually add charts to an existing worklist (Manage Charts → Add charts). */
export const addCharts = (worklistId: string, body: AddChartsRequest) =>
  post<BulkImportResult>(`/worklists/${worklistId}/charts`, body);

export async function bulkImportCharts(worklistId: string, file: File): Promise<BulkImportResult> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<BulkImportResult>(
    `/worklists/${worklistId}/charts/bulk-import`,
    form,
  );
  return data;
}

export async function bulkUploadDocuments(
  worklistId: string,
  files: File[],
  manualMappings: Array<{ filename: string; chartId: string }> = [],
): Promise<BulkDocumentsResult> {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  if (manualMappings.length > 0) form.append('manualMappings', JSON.stringify(manualMappings));
  const { data } = await api.post<BulkDocumentsResult>(
    `/worklists/${worklistId}/charts/bulk-documents`,
    form,
  );
  return data;
}

export function downloadBulkTemplateUrl(): string {
  return `${import.meta.env.VITE_API_BASE}/worklists/bulk-template`;
}

export async function assignStagedDocuments(
  worklistId: string,
  assignments: AssignStagedRequest[],
): Promise<AssignStagedResult> {
  return post<AssignStagedResult>(
    `/worklists/${worklistId}/charts/bulk-documents/assign-staged`,
    { assignments },
  );
}

export interface RunAiResult {
  eligible: number;
  triggered: number;
  skipped: Array<{
    chartId: string;
    reason: 'already_done' | 'already_in_flight' | 'no_documents' | 'gateway_error';
    message?: string;
  }>;
}

export async function runAiOnWorklist(worklistId: string): Promise<RunAiResult> {
  return post<RunAiResult>(`/worklists/${worklistId}/charts/run-ai`);
}

export interface ClearStuckAiResult {
  cleared: number;
  chartIds: string[];
}

export async function clearStuckAiOnWorklist(worklistId: string): Promise<ClearStuckAiResult> {
  return post<ClearStuckAiResult>(`/worklists/${worklistId}/charts/clear-stuck-ai`);
}

export interface CreateWorklistFromExcelResult {
  id: string;
  worklistNumber: string;
  inserted: number;
  skipped: number;
  errors: Array<{ row: number; field?: string; message: string }>;
}

export async function createWorklistFromExcel(
  dto: Omit<CreateWorklistDto, 'numberOfCharts'>,
  file: File,
): Promise<CreateWorklistFromExcelResult> {
  const form = new FormData();
  form.append('file', file);
  for (const [k, v] of Object.entries(dto)) {
    if (v !== undefined && v !== null && v !== '') form.append(k, String(v));
  }
  const { data } = await api.post<CreateWorklistFromExcelResult>(
    '/worklists/from-excel',
    form,
  );
  return data;
}
