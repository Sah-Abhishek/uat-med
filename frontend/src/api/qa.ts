import { get } from './client';
import type { CodeDecisionDraftPayload } from './charts';

export type CodeReviewType = 'PRIMARY' | 'SECONDARY' | 'PROCEDURE' | 'EM_LEVEL' | 'MODIFIER';

export interface QaFilters {
  clientId?: number;
  locationId?: number;
  specialityId?: number;
  /** Sub-speciality id (worklist.sub_speciality_id). Location-scoped. */
  subSpecialityId?: number;
  coderId?: number;
  auditorId?: number;
  worklistId?: number;
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
  worklistNumber: string | null;
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
  daily: Array<{
    day: string;
    submissions: number;
    decisions: number;
    accepted: number;
    rejected: number;
    edited: number;
    added: number;
  }>;
}

export const getQaAccuracy = (params: QaFilters) =>
  get<QaAccuracyResponse>('/qa/ai-accuracy', params);

export const listQaCoders = () =>
  get<{ items: Array<{ id: number; name: string }> }>('/qa/coders');

/**
 * Worklists (by worklist number) that have at least one submitted chart.
 * Optionally scoped by client, filtered by `search` (matches worklist number),
 * and capped by `limit` (default 10 server-side) — drives the searchable dropdown.
 */
export const listQaWorklists = (params?: { clientId?: number; search?: string; limit?: number }) =>
  get<{ items: Array<{ id: number; name: string }>; total: number }>('/qa/worklists', params);

/** Distinct facility values present on charts, optionally scoped by client/location. */
export const listQaFacilities = (params?: { clientId?: number; locationId?: number }) =>
  get<{ items: string[] }>('/qa/facilities', params);

/* ── Live mode — watch in-progress decisions in real time ──── */

export interface QaLiveUser {
  id: number;
  fullName: string | null;
  role: string | null;
  avatarUrl: string | null;
}

/** One coder/auditor's in-progress board on one chart, as autosaved to the
 * code-decision draft. `payload` is the same versioned blob the Review & Edit
 * modal writes — decode it via {@link CodeDecisionDraftPayload}. `updatedAt`
 * is the row's last autosave, used to tell live from idle and to gate stale
 * toasts. */
export interface QaLiveDraft {
  chartId: number;
  chartNo: string | null;
  milestone: string | null;
  /** Derived server-side from milestone (AUDIT_* ⇒ AUDIT, else CODING). */
  kind: 'CODING' | 'AUDIT';
  user: QaLiveUser;
  clientName: string | null;
  locationName: string | null;
  subSpecialityName: string | null;
  payload: CodeDecisionDraftPayload | null;
  updatedAt: string; // ISO
}

export interface QaLiveResponse {
  /** Server clock at response time — subtract from the client clock to correct
   * skew before computing liveness from `updatedAt`. */
  serverNow: string; // ISO
  drafts: QaLiveDraft[];
}

/** Charts being worked on right now (drafts touched in the last 30 min),
 * excluding the caller and soft-deleted/orphaned charts. Poll this. */
export const getQaLive = () => get<QaLiveResponse>('/qa/live');
