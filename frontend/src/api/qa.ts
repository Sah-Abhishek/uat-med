import { get } from './client';

export type CodeReviewType = 'PRIMARY' | 'SECONDARY' | 'PROCEDURE' | 'EM_LEVEL' | 'MODIFIER';

export interface QaFilters {
  clientId?: number;
  locationId?: number;
  specialityId?: number;
  coderId?: number;
  auditorId?: number;
  /** Comma-separated list of milestone enum values, e.g. "CODING_DONE,AUDIT_DONE". */
  milestone?: string;
  /** Facility name (matches chart.customFields.facility). */
  facility?: string;
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  q?: string;
}

export interface QaSubmissionRow {
  chartId: number;
  chartNo: string | null;
  mrNumber: string | null;
  milestone: string;
  clientId: number;
  clientName: string | null;
  locationId: number;
  locationName: string | null;
  specialityId: number | null;
  specialityName: string | null;
  coderId: number | null;
  coderName: string | null;
  auditorId: number | null;
  auditorName: string | null;
  lastSubmittedAt: string;
  firstDecidedAt: string;
  totalDecisions: number;
  accepted: number;
  rejected: number;
  edited: number;
  timeTakenMs: number;
}

export interface QaSubmissionsResponse {
  items: QaSubmissionRow[];
  total: number;
  page: number;
  pageSize: number;
}

export const listQaSubmissions = (params: QaFilters & { page?: number; pageSize?: number }) =>
  get<QaSubmissionsResponse>('/qa/submissions', params);

export interface QaAccuracyResponse {
  kpis: {
    totalDecisions: number;
    distinctCharts: number;
    acceptanceRate: number;
    acceptedCount: number;
    rejectedCount: number;
    editedCount: number;
    /** Codes the coder added that the AI didn't suggest (an omission/miss). */
    addedCount: number;
    medianTimePerChartMs: number;
  };
  perCodeType: Array<{
    codeType: CodeReviewType;
    accepted: number;
    rejected: number;
    edited: number;
    added: number;
    total: number;
  }>;
  topRejectReasons: Array<{ reason: string; count: number }>;
  weekly: Array<{
    week: string;
    accepted: number;
    rejected: number;
    edited: number;
    added: number;
    total: number;
  }>;
  daily: Array<{ day: string; submissions: number; decisions: number }>;
}

export const getQaAccuracy = (params: QaFilters) =>
  get<QaAccuracyResponse>('/qa/ai-accuracy', params);

export const listQaCoders = () =>
  get<{ items: Array<{ id: number; name: string }> }>('/qa/coders');

/** Distinct facility values present on charts, optionally scoped by client/location. */
export const listQaFacilities = (params?: { clientId?: number; locationId?: number }) =>
  get<{ items: string[] }>('/qa/facilities', params);
