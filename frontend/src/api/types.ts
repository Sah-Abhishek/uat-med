// Types aligned to the live OpenAPI spec (v2.1.0).
// BigInt IDs come back as strings — always type them as string, never number.

/* ── Auth ─────────────────────────────────────────────────── */

export type Role = 'TEAMLEAD' | 'MANAGER' | 'AUDITOR' | 'CODER';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING';

/** Minimal lookup shape — backend joins enough for the UI to render labels. */
export interface NamedRef {
  id: number;
  name: string;
}

export interface User {
  id: string;
  employeeId: string | null;
  email: string;
  fullName: string;
  role: Role;
  status: UserStatus;
  designation: string | null;
  primarySpecialityId: number | null;
  clientId: number | null;
  locationId: number | null;
  /** Populated by GET /users/:id — null on list endpoints that skip the joins. */
  primarySpeciality?: NamedRef | null;
  client?: NamedRef | null;
  location?: NamedRef | null;
  dateOfBirth: string | null;
  dateOfJoining: string | null;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'bearer';
  expiresIn: number;
  refreshToken: string;
  user: Pick<
    User,
    'id' | 'email' | 'role' | 'fullName' | 'clientId' | 'locationId' | 'avatarUrl'
  >;
}

/* ── Shared envelopes ────────────────────────────────────── */

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  status: number;
  details?: Record<string, string[]>;
  /** Extra keys the server attached to the error envelope (besides code/message/details). */
  meta?: Record<string, unknown>;
}

export type SortDir = 'asc' | 'desc';
export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: SortDir;
}

/* ── Worklists ────────────────────────────────────────────── */

/** COMPLETED is derived server-side (all charts completed — 0.00% pending),
 * never stored; the other three are the persisted statuses. */
export type WorklistStatus = 'OPEN' | 'IN_PROGRESS' | 'CLOSED' | 'COMPLETED';

export interface Worklist {
  id: string;
  worklistNumber: string;
  clientId: number;
  locationId: number;
  primarySpecialityId: number;
  subSpecialityId: number | null;
  processId: number;
  // Resolved display names from the joined config hierarchy (list endpoint).
  // Null when the related row is missing; fall back to the id for display.
  clientName: string | null;
  locationName: string | null;
  specialityName: string | null;
  subSpecialityName: string | null;
  processName: string | null;
  status: WorklistStatus;
  receivedDate: string;
  dateOfService: string | null;
  dateOfServiceTo: string | null;
  totalCharts: number;
  allocatedCharts: number;
  closedCharts: number;
  /** Charts that finished coding/audit or are fully closed — drives Progress %. */
  completedCharts: number;
  importTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorklistDetail extends Worklist {
  client: { id: number; name: string } | null;
  location: { id: number; name: string } | null;
  primarySpeciality: { id: number; name: string } | null;
  subSpeciality: { id: number; name: string } | null;
  process: { id: number; name: string } | null;
  netChange: number;
  /** Total documents uploaded across this worklist's charts. */
  documentsCount: number;
  chartSummary: {
    total: number;
    allocated: number;
    unallocated: number;
    notStarted: number;
    inProgress: number;
    closed: number;
    /** Coding done + audit done + closed — drives the progress % / donut. */
    completed: number;
  };
  /**
   * AI pipeline counts. Optional to tolerate deployment version skew: an older
   * backend build (frontend ahead of backend) may omit this field. Consumers
   * must guard against it being undefined.
   */
  aiStatusCounts?: {
    queued: number;
    processing: number;
    done: number;
    errored: number;
    /** Charts that haven't been sent to the AI pipeline yet. */
    none: number;
  };
}

export interface WorklistStatusSummary {
  open: number;
  inProgress: number;
  closed: number;
  completed: number;
}

/* ── Charts ───────────────────────────────────────────────── */
// Aligned to spec — chartStatus drops IN_PROGRESS (not a server value);
// milestone adds CLOSED; priority adds DONE.

export type ChartMilestone =
  | 'READY_TO_ALLOCATE'
  | 'READY_TO_CODE'
  | 'CODING_IN_PROGRESS'
  | 'CODING_DONE'
  | 'READY_TO_AUDIT'
  | 'AUDIT_IN_PROGRESS'
  | 'AUDIT_DONE'
  | 'CLOSED';

export type ChartStatus = 'OPEN' | 'COMPLETE' | 'INCOMPLETE' | 'HOLD';

// Backend enum value is FINALIZED; the UI shows it as "Done" via Chip labels.
export type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'FINALIZED';

export interface Procedure {
  code: string;
  description?: string;
}

export interface Chart {
  id: string;
  worklistId: string;
  worklistNumber: string;
  serialNo: number;
  chartNo: string | null;
  mrNumber: string | null;
  milestone: ChartMilestone;
  chartStatus: ChartStatus;
  priority: Priority;
  allocatedCoderId: string | null;
  allocatedAuditorId: string | null;
  dateOfService: string | null;
  admitDate: string | null;
  dischargeDate: string | null;
  primaryDiagnosis: string | null;
  secondaryDiagnoses: string[] | null;
  procedures: Procedure[] | null;
  emLevel: string | null;
  /** Numeric DRG value — TypeORM serialises numeric columns as strings. */
  drgValue: string | number | null;
  coderCommentsToClient: string | null;
  rejectionDenialComments: string | null;
  deficiencyComments: string | null;
  /** Service line (global lookup) chosen at upload. id is null when unset;
   * serviceLineName is resolved server-side for display (list + detail). */
  serviceLineId: string | number | null;
  serviceLineName: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /* List-view enrichments — present on responses from `GET /charts`, where
   * the backend joins lookup tables and batch-resolves user names so the
   * configurable Charts table can render them without N+1 fetches. */
  clientName?: string | null;
  locationName?: string | null;
  specialityName?: string | null;
  subSpecialityName?: string | null;
  processName?: string | null;
  receivedDate?: string | null;
  qcStatus?: string | null;
  originalCoderId?: string | null;
  originalAuditorId?: string | null;
  originalCoderName?: string | null;
  originalAuditorName?: string | null;
  allocatedCoderName?: string | null;
  allocatedAuditorName?: string | null;
  allocatedCoderAvatarUrl?: string | null;
  allocatedAuditorAvatarUrl?: string | null;
  coderAllocatedAt?: string | null;
  auditorAllocatedAt?: string | null;
  /** Total durable work-timer time logged on this chart (sum of completed
   * sessions, ms). Present on the chart-detail response. The header timer adds
   * the live running session on top. */
  coderTimeMs?: number;
  /** The current user's OWN logged time on this chart (ms). The editable timer
   * uses this so a new worker (e.g. an auditor) starts from zero rather than the
   * coder's elapsed; coderTimeMs stays the chart total for the QA read-only view. */
  myTimeMs?: number;
}

export type AiReportType =
  | 'HP'
  | 'DISCHARGE_SUMMARY'
  | 'OPERATIVE_NOTE'
  | 'LAB'
  | 'RADIOLOGY'
  | 'ED_NOTE'
  | 'CLINIC_NOTE'
  | 'PATHOLOGY';

export interface AiPredictedCode {
  code: string;
  description: string;
  confidence?: number;
  codeType?: string;
  sequencePos?: number;
  justification?: string;
  /** Gateway UUID (predicted_code_id) for this AI suggestion. Present only when
   * the code came from the live /predicted-codes response (or a snapshot the
   * backend has since synced) — the Review modal forwards it on submit. */
  predictedCodeId?: string;
}

export interface UploadedDocument {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  /** S3 object key — present on docs uploaded after the add/remove feature landed. */
  key?: string;
  reportType: AiReportType;
  reportId?: string;
}

export interface AiCodingTip {
  tip: string;
  relatedCode?: string;
  potentialImpact?: string;
}

export interface AiComplianceAlert {
  alert: string;
  severity?: string;
  regulation?: string;
  recommendedAction?: string;
}

export interface AiDocumentationGap {
  gap: string;
  impact?: string;
  priority?: string;
  suggestion?: string;
}

export interface AiPhysicianQuery {
  query: string;
  reason?: string;
  priority?: string;
  impactOnCoding?: string;
}

export interface AiEncounterResult {
  encounterId: string;
  reportIds: string[];
  status: string;
  reportCount: number;
  codes: AiPredictedCode[];
  primary: AiPredictedCode[];
  secondary: AiPredictedCode[];
  procedures: AiPredictedCode[];
  clinicalSummary?: Record<string, unknown>;
  auditNotes?: string;
  pipelineTiming?: Record<string, unknown>;
  uploadedDocs: UploadedDocument[];
  // Surfaced from final_codes_json.agent4_full.feedback by the backend.
  codingTips?: AiCodingTip[];
  complianceAlerts?: AiComplianceAlert[];
  documentationGaps?: AiDocumentationGap[];
  physicianQueries?: AiPhysicianQuery[];
  // Document-processing timing, persisted on finalize (customFields.aiPrediction).
  /** When the prediction was finalized (ISO). */
  generatedAt?: string;
  /** When the pipeline run started (ISO); null on legacy runs. */
  startedAt?: string | null;
  /** When the pipeline run completed (ISO). */
  completedAt?: string;
  /** Milliseconds the AI took to process the documents; null if unknown. */
  processingMs?: number | null;
}

export interface ChartSummary {
  priorityCounts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    finalized: number;
  };
  milestones: {
    readyToCode: number;
    codingDoneToday: number;
    readyToAudit: number;
    auditDoneToday: number;
  };
  statusToday: {
    complete: number;
    incomplete: number;
  };
  aiStatusCounts: {
    queued: number;
    processing: number;
    done: number;
    errored: number;
  };
}

/* ── AI pipeline state derived from a chart's customFields ── */
export type AiStatus = 'NONE' | 'QUEUED' | 'PROCESSING' | 'DONE' | 'ERRORED';

/**
 * Resolve the user-visible AI state for a chart. Order matters: an in-flight
 * pending row takes precedence over any prior result, then errors over success.
 */
export function deriveAiStatus(customFields: Record<string, unknown> | undefined | null): AiStatus {
  if (!customFields) return 'NONE';
  const pending = customFields.pendingPrediction as { gatewayStatus?: string } | undefined;
  if (pending) return pending.gatewayStatus === 'STARTED' ? 'PROCESSING' : 'QUEUED';
  if (customFields.aiPredictionError) return 'ERRORED';
  if (customFields.aiPrediction) return 'DONE';
  return 'NONE';
}

/* ── Chart feedback ──────────────────────────────────────── */

export type FeedbackStatus =
  | 'Feedback Provided'
  | 'Agree'
  | 'Reject'
  | 'Feedback Implemented';

export interface ChartFeedback {
  id: string;
  chartId: string;
  categoryId: number;
  categoryName: string;
  feedbackTypeId: number;
  feedbackTypeName: string;
  feedbackStatus: FeedbackStatus;
  comments: string | null;
  createdByUserId: string | null;
  createdByUserName: string | null;
  createdByAvatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ── HCC ──────────────────────────────────────────────────── */

export type HccValidate = 'ADD' | 'PASS' | 'NA';

export interface HccRecord {
  id: string;
  memberId: string;
  memberName: string;
  medicareNo: string | null;
  dob: string;
  payor: string | null;
  dos: string;
  reviewDate: string | null;
  v24Icd: string | null;
  v24IcdDescription: string | null;
  v24HccValue: number | null;
  v28Icd: string | null;
  v28IcdDescription: string | null;
  v28HccValue: number | null;
  validate: HccValidate;
  reasonCode: string | null;
  source: string | null;
  reviewerNote: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type HccFieldType = 'text' | 'number' | 'date' | 'dropdown' | 'multiline';
export type ValidationRule = 'MANDATORY' | 'NON_MANDATORY' | 'NOT_APPLICABLE';

export interface HccFieldDef {
  id: number;
  name: string;
  type: HccFieldType;
  isMultiSelect: boolean;
  validation: ValidationRule;
  preserveNext: boolean;
  options: string[];
}

/* ── Dashboard ───────────────────────────────────────────── */

export interface DashboardMilestones {
  inProgress: number;
  readyToCode: number;
  readyToAllocate: number;
}

export interface DashboardStatus {
  complete: number;
  incomplete: number;
}

export interface DashboardUnallocated {
  worklists: { unallocated: number; total: number };
  charts: { unallocated: number; total: number };
}

export interface DashboardSelf {
  readyToCode: number;
  codingDoneToday: number;
  readyToAudit: number;
  auditDoneToday: number;
  completeToday: number;
  incompleteToday: number;
  inProgressChart: { id: string; chartNo: string } | null;
  inProgressStartedAt: string | null;
}

export interface DateCount { date: string; count: number; }
export interface DateValue { date: string; value: number; }

export interface AllocationStats {
  chartsByMilestone: Array<{ milestone: ChartMilestone; count: number }>;
  chartCompletion: { complete: number; incomplete: number; open: number; hold: number };
  qualityControl: {
    feedbackProvided: number;
    agree: number;
    feedbackRejected: number;
    feedbackImplemented: number;
    unaudited: number;
  };
  worklistByStatus: { open: number; inProgress: number; closed: number };
  progressToDate: DateCount[];
}

export interface UnallocatedVolume {
  byWorklist: Array<{ worklist: string; count: number }>;
  bySpeciality: Array<{ speciality: string; count: number }>;
  byReceivedDate: DateCount[];
  byDateOfService: DateCount[];
}

export interface ProductivityStats {
  volumePerDay: DateCount[];
  avgCodingMinutes: DateValue[];
  reworkCount: number;
}

/* ── Attendance ──────────────────────────────────────────── */

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LEAVE';

export interface AttendanceDay {
  date: string;
  status: AttendanceStatus;
}

export interface MonthAttendance {
  month: string;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  days: AttendanceDay[];
}

export interface SignupRequest {
  id: string;
  email: string;
  requestedAt: string;
}

/* ── Reports ─────────────────────────────────────────────── */

export interface ReportFieldOption {
  value: string;
  label: string;
}

/** How the Reports filter bar should render a field's control. */
export type ReportFilterKind = 'text' | 'date' | 'select';

export interface ReportField {
  key: string;
  label: string;
  filterable: boolean;
  sortable: boolean;
  type?: 'date' | 'number';
  filterKind?: ReportFilterKind;
  /** Static labelled options for a `select` filter (enums); absent → fetched live. */
  options?: ReportFieldOption[];
}

export interface ReportQueryResult {
  columns: string[];
  rows: Array<Array<string | number | null>>;
  total: number;
  page: number;
  pageSize: number;
}

export interface ReportTemplate {
  id: string;
  name: string;
  columns: string[];
  filters: Record<string, unknown>;
  sort: Array<{ key: string; dir: SortDir }>;
  ownerId: string;
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ExportFormat = 'xlsx' | 'csv';
export type ExportStatus = 'queued' | 'running' | 'done' | 'failed';

export interface ExportTask {
  taskId: string;
  status: ExportStatus;
  rowsExported?: number;
  downloadUrl?: string;
  errorMessage?: string;
}
