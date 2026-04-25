import { get, post, patch, put, del } from './client';
import type {
  Chart,
  ChartFeedback,
  ChartMilestone,
  ChartStatus,
  ChartSummary,
  FeedbackStatus,
  Paginated,
  Priority,
  Procedure,
  SortDir,
} from './types';

/* ── List ──────────────────────────────────────────────── */

export interface ChartListParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: SortDir;
  priority?: Priority;
  worklistId?: number | string;
  serialFrom?: number;
  serialTo?: number;
  allocatedUserId?: number | string;
  primarySpecialityId?: number;
  chartNo?: string;
  chartStatus?: ChartStatus;
  milestone?: ChartMilestone;
  receivedDateFrom?: string;
  receivedDateTo?: string;
  dateOfServiceFrom?: string;
  dateOfServiceTo?: string;
}

export const listCharts = (params: ChartListParams = {}) =>
  get<Paginated<Chart>>('/charts', params);

export const getChartsSummary = () => get<ChartSummary>('/charts/summary');

/* ── Detail / update ────────────────────────────────────── */

export const getChart = (id: string) => get<Chart>(`/charts/${id}`);

/**
 * Matches server UpdateChartDto (recommended extended version).
 * All fields are optional — server persists only what's present.
 */
export interface UpdateChartDto {
  priority?: Priority;
  chartStatus?: ChartStatus;
  allocatedCoderId?: number;
  allocatedAuditorId?: number;
  holdReasonId?: number;
  responsiblePartyId?: number;
  primaryHealthPlanId?: number;
  dos?: string;
  admitDate?: string;
  dischargeDate?: string;
  primaryDiagnosis?: string;
  secondaryDiagnoses?: string[];
  procedures?: Procedure[];
  emLevel?: string;
  drgValue?: number;
  coderCommentsToClient?: string;
  rejectionDenialComments?: string;
  deficiencyComments?: string;
  customFields?: Record<string, unknown>;
}

export const updateChart = (id: string, dto: UpdateChartDto) =>
  patch<Chart>(`/charts/${id}`, dto);

/* ── Timer + transition ────────────────────────────────── */

export const startChart = (id: string) =>
  post<{ chartId: string; startedAt: string }>(`/charts/${id}/start`);

export const stopChart = (id: string) =>
  post<{ chartId: string; elapsedMs: number }>(`/charts/${id}/stop`);

export const transitionChart = (
  id: string,
  dto: { milestone: ChartMilestone; chartStatus: ChartStatus },
) => post<Chart>(`/charts/${id}/transition`, dto);

/* ── Bulk actions ──────────────────────────────────────── */

export type AllocationAction =
  | 'ALLOCATE_CODING'
  | 'ALLOCATE_AUDITING'
  | 'REALLOCATE_TO_ORIGINAL_CODER'
  | 'NONE';

export interface BulkModifyDto {
  chartIds: number[];
  priority?: Priority;
  allocation?: {
    action: AllocationAction;
    assigneeId?: number;
  };
}

export const bulkModifyCharts = (dto: BulkModifyDto) =>
  post<{ updated: number }>('/charts/bulk/modify', dto);

export const selfAllocateCharts = (chartIds: number[]) =>
  post<{ allocated: number }>('/charts/bulk/self-allocate', { chartIds });

export const bulkDeleteCharts = (chartIds: number[]) =>
  del<{ deleted: number }>('/charts/bulk', { chartIds });

/* ── Columns visibility ────────────────────────────────── */

export interface ColumnPref {
  key: string;
  visible: boolean;
}
export const getColumnPrefs = () =>
  get<{ columns: ColumnPref[] }>('/charts/columns');

export const saveColumnPrefs = (columns: ColumnPref[]) =>
  put<{ columns: ColumnPref[] }>('/charts/columns', { columns });

/* ── Feedback ──────────────────────────────────────────── */

export const listChartFeedback = (chartId: string) =>
  get<ChartFeedback[]>(`/charts/${chartId}/feedback`);

export interface AddFeedbackDto {
  categoryId: number;
  feedbackTypeId: number;
  feedbackStatus: FeedbackStatus;
  comments?: string;
}

export const addChartFeedback = (chartId: string, dto: AddFeedbackDto) =>
  post<ChartFeedback>(`/charts/${chartId}/feedback`, dto);

export interface UpdateFeedbackDto {
  feedbackStatus?: FeedbackStatus;
  comments?: string;
}

export const updateChartFeedback = (feedbackId: string, dto: UpdateFeedbackDto) =>
  patch<ChartFeedback>(`/charts/feedback/${feedbackId}`, dto);
