import { get, post, patch, put, del } from './client';
import { api } from './client';
import type {
  AiEncounterResult,
  AiReportType,
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
  UploadedDocument,
} from './types';

/* ── List ──────────────────────────────────────────────── */

export interface ChartListParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: SortDir;
  priority?: Priority;
  // Filter fields below accept a single value (other callers) OR an array
  // (the multi-select chart filters). The backend matches with IN(...).
  worklistId?: number | string | Array<number | string>;
  serialFrom?: number;
  serialTo?: number;
  allocatedUserId?: number | string | Array<number | string>;
  primarySpecialityId?: number | number[];
  subSpecialityId?: number | number[];
  /** Global header scope (Client / Location). */
  clientId?: number;
  locationId?: number;
  chartNo?: string;
  chartStatus?: ChartStatus | ChartStatus[];
  milestone?: ChartMilestone | ChartMilestone[];
  /** AI-pipeline state, derived server-side from custom_fields. Use 'ERRORED'
   * to surface only charts whose AI prediction failed; 'IN_PROGRESS' is the
   * union of QUEUED + PROCESSING (any pending prediction). */
  aiStatus?:
    | 'QUEUED' | 'PROCESSING' | 'IN_PROGRESS' | 'DONE' | 'ERRORED'
    | Array<'QUEUED' | 'PROCESSING' | 'IN_PROGRESS' | 'DONE' | 'ERRORED'>;
  /** Whether the chart has been reviewed — i.e. worked upon: it has at least
   * one submitted code decision. Derived server-side from chart_code_decisions
   * (there's no column for it). 'YES' keeps only reviewed charts, 'NO' keeps
   * only untouched ones; omit for no filter. */
  reviewed?: 'YES' | 'NO';
  receivedDateFrom?: string;
  receivedDateTo?: string;
  dateOfServiceFrom?: string;
  dateOfServiceTo?: string;
}

export const listCharts = (params: ChartListParams = {}) =>
  get<Paginated<Chart>>('/charts', params);

export const getChartsSummary = (
  params: { clientId?: number; locationId?: number } = {},
) => get<ChartSummary>('/charts/summary', params);

/* ── Detail / update ────────────────────────────────────── */

export const getChart = (id: string) => get<Chart>(`/charts/${id}`);

/**
 * Matches server UpdateChartDto (recommended extended version).
 * All fields are optional — server persists only what's present.
 */
export interface UpdateChartDto {
  chartNo?: string;
  mrNumber?: string;
  priority?: Priority;
  chartStatus?: ChartStatus;
  allocatedCoderId?: number;
  allocatedAuditorId?: number;
  holdReasonId?: number;
  responsiblePartyId?: number;
  primaryHealthPlanId?: number;
  /** Service line (global lookup) id; `null` clears it. */
  serviceLineId?: number | null;
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

export interface ActiveTimer {
  chartId: string;
  chartNo: string | null;
  worklistId: string;
  milestone: ChartMilestone;
  startedAt: string;
  elapsedMs: number;
}

export const getActiveTimer = () => get<ActiveTimer | null>('/charts/active-timer');

/** One Time Tracker row = one timer session (a single start→stop). The same
 * user opening/closing the timer repeatedly yields multiple entries.
 * `elapsedMs` is the live elapsed while `running`. */
export interface ChartTimeEntry {
  id: number;
  userId: number;
  userName: string | null;
  role: string | null;
  avatarUrl: string | null;
  kind: 'CODING' | 'AUDIT';
  startedAt: string;
  stoppedAt: string | null;
  elapsedMs: number;
  running: boolean;
}

export const getChartTimeByUser = (chartId: string | number) =>
  get<{ entries: ChartTimeEntry[] }>(`/charts/${chartId}/time-logs`);

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
  /** Apply one service line to every chart in the selection; `null` clears it. */
  serviceLineId?: number | null;
}

export const bulkModifyCharts = (dto: BulkModifyDto) =>
  post<{ updated: number }>('/charts/bulk/modify', dto);

export interface SelfAllocateResult {
  allocated: number;
  allocatedIds: number[];
  /** Charts skipped because someone else has a running timer on them. */
  skipped: Array<{ chartId: number; reason: string }>;
}

export const selfAllocateCharts = (chartIds: number[]) =>
  post<SelfAllocateResult>('/charts/bulk/self-allocate', { chartIds });

export const bulkDeleteCharts = (chartIds: number[]) =>
  del<{ deleted: number }>('/charts/bulk', { chartIds });

export interface RetryErroredResult {
  /** Errored charts re-queued for the AI pipeline. */
  queued: number;
  /** Errored charts skipped (no documents to reprocess). */
  skipped: Array<{ chartId: string; reason: 'no_documents' }>;
}

/** Re-queue the AI pipeline for every AI-errored chart system-wide. The
 * endpoint lives under /worklists (that's where the serial AI-dispatch queue
 * is implemented) but the action is global and skips charts orphaned by a
 * soft-deleted worklist. Manager / Team Lead only. */
export const retryAiErroredCharts = () =>
  post<RetryErroredResult>('/worklists/retry-ai-errored');

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

/* ── Code Review & Edit decisions ──────────────────────── */

export type CodeDecisionType = 'PRIMARY' | 'SECONDARY' | 'PROCEDURE' | 'EM_LEVEL' | 'MODIFIER';
export type CodeDecisionVerdict = 'ACCEPTED' | 'REJECTED' | 'EDITED' | 'ADDED';

export interface CodeDecisionInput {
  codeType: CodeDecisionType;
  codeValue: string;
  /** Orchestrator UUID for the AI-predicted code this decision is about.
   * Optional only because legacy charts won't have one — new submissions
   * should always include it so the orchestrator can record the action. */
  predictedCodeId?: string;
  originalDescription?: string;
  decision: CodeDecisionVerdict;
  editedCode?: string;
  editedDescription?: string;
  reasonDropdown?: string;
  reasonText?: string;
}

export interface CodeDecisionRecord extends CodeDecisionInput {
  id: number;
  decidedByUserId: number;
  decidedAt: string;
}

export interface SubmitDecisionsResponse {
  items: CodeDecisionRecord[];
  /** Reflects the second leg of the submit — local DB write succeeded
   * regardless. `forwarded:true` means the orchestrator accepted the
   * payload; `skipped` or `error` means it didn't (local audit still saved). */
  orchestrator?: {
    forwarded?: boolean;
    skipped?: boolean;
    encounterId?: string | null;
    totalActions?: number;
    correctionsWritten?: number;
    qdrantSyncFailures?: number;
    error?: string;
    reason?: string;
  };
}

export interface PredictedCodeWithId {
  id: string;
  icd_code: string;
  description: string;
  confidence: number;
  code_type: string;
  sequence_pos: number | null;
  evidence_json: Record<string, unknown> | null;
  status: string;
}

export const listCodeDecisions = (chartId: string) =>
  get<{ items: CodeDecisionRecord[] }>(`/charts/${chartId}/code-decisions`);

export const getPredictedCodes = (chartId: string) =>
  get<{ codes: PredictedCodeWithId[]; encounterId: string | null }>(
    `/charts/${chartId}/predicted-codes`,
  );

export const submitCodeDecisions = (chartId: string, decisions: CodeDecisionInput[]) =>
  post<SubmitDecisionsResponse>(`/charts/${chartId}/code-decisions`, { decisions });

/* ── Code-decision drafts (autosaved pre-submission state) ── */

/** Board category a draft entry belongs to (ADMIT CODE rows are a disabled
 * UI mirror of PRIMARY and are never persisted). */
export type CodeDraftCategory = 'PRIMARY' | 'SECONDARY' | 'PROCEDURE';

/** One in-progress decision, identified by (category, code) — the same
 * stable identity the board dedupes on, so a draft survives prediction
 * reordering and re-fetches. Reasons are saved as-typed (no min-length):
 * preserving half-finished input is the whole point of a draft. */
export interface CodeDecisionDraftEntry {
  category: CodeDraftCategory;
  code: string;
  decision: 'accepted' | 'rejected' | 'edited' | 'added';
  editedCode: string;
  editedDescription: string;
  rejectReason: string;
  reasonDropdown: string;
}

/** Codes the user added that the AI didn't suggest — they have no predicted
 * item to attach to, so the draft carries enough to recreate the row. */
export interface CodeDecisionDraftAddedItem {
  category: CodeDraftCategory;
  code: string;
  description: string;
}

/** Versioned so a future shape change can discard incompatible drafts
 * instead of breaking the restore. Bump `version` on breaking changes. */
export interface CodeDecisionDraftPayload {
  version: 1;
  decisions: CodeDecisionDraftEntry[];
  addedItems: CodeDecisionDraftAddedItem[];
}

/** Fetch a chart's in-progress draft. Omit `userId` for the caller's own
 * draft; QA (Team Lead / Manager) passes a coder's id to watch their live
 * draft in read-only mode. */
export const getCodeDecisionDraft = (chartId: string, userId?: number) =>
  get<{ draft: { payload: CodeDecisionDraftPayload; updatedAt: string } | null }>(
    `/charts/${chartId}/code-decisions/draft`,
    userId != null ? { userId } : undefined,
  );

export const saveCodeDecisionDraft = (chartId: string, payload: CodeDecisionDraftPayload) =>
  put<{ savedAt: string }>(`/charts/${chartId}/code-decisions/draft`, { payload });

export const deleteCodeDecisionDraft = (chartId: string) =>
  del<{ deleted: boolean }>(`/charts/${chartId}/code-decisions/draft`);

/* ── AI: ICD Predictor (encounter flow) ──────────────────── */

export interface ProcessDocumentsInput {
  files: File[];
  /** Same length as files; one report_type per file. Defaults to CLINIC_NOTE on the server. */
  reportTypes?: AiReportType[];
  documentType?: string;
}

interface StartProcessDocumentsResponse {
  encounterId: string;
  taskId: string;
  reportIds: string[];
  uploadedDocs: AiEncounterResult['uploadedDocs'];
}

type EncounterRunStatus = 'PENDING' | 'STARTED' | 'SUCCESS' | 'FAILURE';
interface EncounterStatusResponse {
  status: EncounterRunStatus;
  error?: string;
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Upload medical documents and run the ICD Predictor encounter flow.
 *
 * The pipeline runs in three phases so no single HTTP request is held open
 * long enough for an upstream proxy to 504 us:
 *   1. POST /process-documents — uploads files, queues the AI run, returns
 *      `{ encounterId, taskId }` in <2s.
 *   2. GET  /process-documents/{encounterId}/status?taskId=… — polled every
 *      few seconds; each call is sub-second.
 *   3. POST /process-documents/{encounterId}/finalize — once status flips to
 *      SUCCESS, fetches the final ICD codes and persists them to the chart.
 *
 * Callers see the same Promise<AiEncounterResult> contract as before, so
 * UploadSection.tsx doesn't need to change.
 */
export async function processChartDocuments(
  chartId: string,
  input: ProcessDocumentsInput,
  onUploadProgress?: (pct: number) => void,
): Promise<AiEncounterResult> {
  const fd = new FormData();
  input.files.forEach((f) => fd.append('files', f, f.name));
  if (input.reportTypes?.length) fd.append('reportTypes', input.reportTypes.join(','));
  if (input.documentType) fd.append('documentType', input.documentType);

  // Phase 1 — start. This still uploads the multipart body, so onUploadProgress
  // continues to drive the form's "uploading" → "analyzing" transition.
  const { data: started } = await api.post<StartProcessDocumentsResponse>(
    `/charts/${chartId}/process-documents`,
    fd,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      // Phase 1 only does S3 upload + 3 sub-second gateway calls; allow a bit
      // of headroom for slow client connections on large PDFs.
      timeout: 5 * 60 * 1000,
      onUploadProgress: (e) => {
        if (!onUploadProgress || !e.total) return;
        onUploadProgress(Math.round((e.loaded / e.total) * 100));
      },
    },
  );

  // Phases 2–3 — poll until done, then finalize.
  return pollAndFinalize(chartId, started.encounterId, started.taskId);
}

/**
 * Re-run the ICD Predictor over the chart's CURRENT document set — no upload.
 * The server pulls the already-stored docs from S3, so this just kicks off a
 * fresh encounter and then reuses the same poll → finalize flow as the initial
 * run. Curate the set first with {@link addChartDocuments} / {@link removeChartDocument}.
 */
export async function reprocessChartDocuments(chartId: string): Promise<AiEncounterResult> {
  const { data: started } = await api.post<StartProcessDocumentsResponse>(
    `/charts/${chartId}/reprocess`,
    {},
    { timeout: 60 * 1000 },
  );
  return pollAndFinalize(chartId, started.encounterId, started.taskId);
}

/** Shared phase 2 (poll) + phase 3 (finalize) loop for both process & reprocess. */
async function pollAndFinalize(
  chartId: string,
  encounterId: string,
  taskId: string,
): Promise<AiEncounterResult> {
  // Phase 2 — poll. Each call is cheap; we cap total wall-clock at 10min.
  const start = Date.now();
  while (true) {
    if (Date.now() - start >= POLL_TIMEOUT_MS) {
      throw new Error('AI pipeline timed out — please retry.');
    }
    await sleep(POLL_INTERVAL_MS);
    const { data: s } = await api.get<EncounterStatusResponse>(
      `/charts/${chartId}/process-documents/${encounterId}/status`,
      { params: { taskId }, timeout: 30 * 1000 },
    );
    if (s.status === 'SUCCESS') break;
    if (s.status === 'FAILURE') {
      throw new Error(`AI pipeline failed: ${s.error ?? 'unknown error'}`);
    }
  }

  // Phase 3 — finalize.
  const { data: result } = await api.post<AiEncounterResult>(
    `/charts/${chartId}/process-documents/${encounterId}/finalize`,
    {},
    { timeout: 60 * 1000 },
  );
  return result;
}

/** Upload documents to a chart without running the AI. Returns the updated list. */
export async function addChartDocuments(
  chartId: string,
  input: ProcessDocumentsInput,
  onUploadProgress?: (pct: number) => void,
): Promise<{ uploadedDocs: UploadedDocument[]; added: number }> {
  const fd = new FormData();
  input.files.forEach((f) => fd.append('files', f, f.name));
  if (input.reportTypes?.length) fd.append('reportTypes', input.reportTypes.join(','));
  if (input.documentType) fd.append('documentType', input.documentType);
  const { data } = await api.post<{ uploadedDocs: UploadedDocument[]; added: number }>(
    `/charts/${chartId}/documents`,
    fd,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 5 * 60 * 1000,
      onUploadProgress: (e) => {
        if (!onUploadProgress || !e.total) return;
        onUploadProgress(Math.round((e.loaded / e.total) * 100));
      },
    },
  );
  return data;
}

/** Remove one uploaded document from a chart. Returns the updated list. */
export const removeChartDocument = (chartId: string, docId: string) =>
  del<{ uploadedDocs: UploadedDocument[] }>(`/charts/${chartId}/documents/${docId}`);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
