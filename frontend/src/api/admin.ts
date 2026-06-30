import { api, get } from './client';
import type { Paginated, Role } from './types';

export type DecisionVerdict = 'ACCEPTED' | 'REJECTED' | 'EDITED' | 'ADDED';

/** One row in the admin verification page. Joined from chart_code_decisions
 * with chart # and the deciding user, plus the optional gateway correction id
 * filled in when the forward succeeded. */
export interface AdminCodeDecision {
  id: number;
  chartId: number;
  chartNo: string | null;
  codeType: 'PRIMARY' | 'SECONDARY' | 'PROCEDURE' | 'EM_LEVEL' | 'MODIFIER';
  codeValue: string;
  predictedCodeId: string | null;
  originalDescription: string | null;
  decision: DecisionVerdict;
  editedCode: string | null;
  editedDescription: string | null;
  reasonDropdown: string | null;
  reasonText: string | null;
  gatewayCorrectionId: string | null;
  /** When this decision was successfully forwarded to the AI gateway. Set for
   * every forwarded action including ACCEPT (which carries no correction_id),
   * so it's the source of truth for "did this reach the AI". */
  gatewaySyncedAt: string | null;
  decidedByUserId: number;
  decidedByEmail: string | null;
  decidedByName: string | null;
  decidedByRole: Role | null;
  decidedAt: string;
}

export interface ListCodeDecisionsParams {
  chartId?: number;
  coderId?: number;
  decision?: DecisionVerdict;
  from?: string;       // YYYY-MM-DD
  to?: string;         // YYYY-MM-DD
  page?: number;
  pageSize?: number;
}

export const listCodeDecisions = (params: ListCodeDecisionsParams = {}) =>
  get<Paginated<AdminCodeDecision>>('/admin/code-decisions', params);

/** Mirror of the gateway's GatewayCorrection (doc §5.1). */
export interface GatewayCorrection {
  id: string;
  report_id: string | null;
  encounter_id: string | null;
  action_type: 'EDIT' | 'DELETE' | 'ADD';
  wrong_code: string | null;
  wrong_code_description: string | null;
  correct_code: string | null;
  correct_description: string | null;
  code_type: string | null;
  sequence_pos: number | null;
  reason: string | null;
  confidence_was: number | null;
  coder_id: string;
  reviewed_at: string;
  ip_hash: string | null;
  synced_to_qdrant: boolean;
}

export interface AdminCodeDecisionDetail {
  local: AdminCodeDecision;
  gateway: GatewayCorrection | null;
  gatewayError: string | null;
}

export const getCodeDecisionDetail = (id: number | string) =>
  get<AdminCodeDecisionDetail>(`/admin/code-decisions/${id}`);

/* ── Chart-centric admin endpoints ──────────────────────────── */

export interface AdminChartWithDecisions {
  chartId: number;
  chartNo: string | null;
  /** Worklist context, resolved server-side via the chart's worklist. */
  clientName: string | null;
  locationName: string | null;
  subSpecialityName: string | null;
  /** Worklist received date (YYYY-MM-DD). */
  receivedDate: string | null;
  milestone: string | null;
  chartStatus: string | null;
  allocatedCoderId: number | null;
  allocatedAuditorId: number | null;
  totalDecisions: number;
  accepted: number;
  rejected: number;
  edited: number;
  added: number;
  syncedCount: number;
  notSyncedCount: number;
  coderNames: string;
  coderCount: number;
  lastDecidedAt: string;
}

export interface ListChartsWithDecisionsParams {
  chartNo?: string;
  coderId?: number;
  decision?: DecisionVerdict;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export const listChartsWithDecisions = (params: ListChartsWithDecisionsParams = {}) =>
  get<Paginated<AdminChartWithDecisions>>('/admin/code-decisions/charts', params);

/**
 * Downloads the chart-decision list as an .xlsx file honoring the current
 * filters (pagination is ignored server-side — the whole filtered set is
 * exported). Receives the workbook as a binary blob and triggers a browser
 * download.
 */
export async function exportChartsWithDecisionsXlsx(
  params: ListChartsWithDecisionsParams = {},
): Promise<void> {
  const { page: _page, pageSize: _pageSize, ...filters } = params;
  const res = await api.get('/admin/code-decisions/charts/export.xlsx', {
    params: filters,
    responseType: 'blob',
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const blob = res.data as Blob;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `code-decisions-${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** AI-side predicted code shape (live from gateway via /api/review/encounter/.../codes). */
export interface AiPredictedCode {
  id: string;
  icd_code: string;
  description: string;
  confidence: number;
  code_type: string;
  sequence_pos: number | null;
  evidence_json: {
    justification?: string;
    audit_notes?: string;
    source_reports?: string[];
    source_chunks?: unknown[];
    [k: string]: unknown;
  } | null;
  status: string;
}

export interface AdminChartDecisionDetail extends AdminCodeDecision {
  /** Inline gateway correction (bulk-fetched server-side). Null when the
   * gateway has no matching row — happens for ACCEPT (intentional), for
   * legacy decisions written before the column existed, or when the forward
   * failed at submit time. */
  gatewayCorrection: GatewayCorrection | null;
}

export interface AdminChartDetail {
  chart: {
    id: number;
    chartNo: string | null;
    milestone: string;
    chartStatus: string;
    priority: string;
    allocatedCoderId: number | null;
    allocatedAuditorId: number | null;
    worklistId: number;
    encounterId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  aiCodes: AiPredictedCode[];
  aiCodesError: string | null;
  decisions: AdminChartDecisionDetail[];
  correctionsError: string | null;
}

export const getChartDecisionsDetail = (chartId: number | string) =>
  get<AdminChartDetail>(`/admin/code-decisions/charts/${chartId}`);

/* ── Active work (Live Activity) ─────────────────────────── */

/** One chart being worked on right now = a running timer session. */
export interface ActiveWorkItem {
  sessionId: number;
  userId: number;
  userName: string | null;
  userRole: Role | null;
  avatarUrl: string | null;
  chartId: number;
  chartNo: string | null;
  serialNo: number | null;
  milestone: string | null;
  worklistId: number | null;
  worklistNumber: string | null;
  clientName: string | null;
  locationName: string | null;
  kind: 'CODING' | 'AUDIT';
  startedAt: string;
  /** Live elapsed since the timer started (ms); frozen total for paused rows. */
  elapsedMs: number;
  /** True for a chart the user has paused (on break) rather than actively timing. */
  paused?: boolean;
}

export interface ActiveWorkResponse {
  items: ActiveWorkItem[];
  total: number;
  distinctUsers: number;
  distinctCharts: number;
}

export const getActiveWork = () => get<ActiveWorkResponse>('/admin/active-work');
