// Types aligned to the live OpenAPI spec (v2.1.0).
// BigInt IDs come back as strings — always type them as string, never number.

/* ── Auth ─────────────────────────────────────────────────── */

export type Role = 'TEAMLEAD' | 'MANAGER' | 'AUDITOR' | 'CODER';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING';

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
    'id' | 'email' | 'role' | 'fullName' | 'clientId' | 'locationId'
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

export type WorklistStatus = 'OPEN' | 'IN_PROGRESS' | 'CLOSED';

export interface Worklist {
  id: string;
  worklistNumber: string;
  clientId: number;
  locationId: number;
  primarySpecialityId: number;
  processId: number;
  status: WorklistStatus;
  receivedDate: string;
  dateOfService: string | null;
  dateOfServiceTo: string | null;
  totalCharts: number;
  allocatedCharts: number;
  closedCharts: number;
  importTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorklistDetail extends Worklist {
  client: { id: number; name: string } | null;
  location: { id: number; name: string } | null;
  primarySpeciality: { id: number; name: string } | null;
  process: { id: number; name: string } | null;
  netChange: number;
  chartSummary: {
    total: number;
    allocated: number;
    unallocated: number;
    notStarted: number;
    inProgress: number;
    closed: number;
  };
}

export interface WorklistStatusSummary {
  open: number;
  inProgress: number;
  closed: number;
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

export type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'DONE';

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
  dischargeDate: string | null;
  primaryDiagnosis: string | null;
  secondaryDiagnoses: string[] | null;
  procedures: Procedure[] | null;
  emLevel: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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
}

export interface UploadedDocument {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
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
}

export interface ChartSummary {
  priorityCounts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    done: number;
  };
  milestones: {
    readyToCode: number;
    codingDone: number;
    readyToAudit: number;
    auditDone: number;
  };
  statusToday: {
    complete: number;
    incomplete: number;
  };
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
  createdByUserId: string;
  createdByUserName: string;
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

export interface ReportField {
  key: string;
  label: string;
  filterable: boolean;
  sortable: boolean;
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
