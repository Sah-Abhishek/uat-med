export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  PENDING = 'PENDING',
}

export enum AttendanceStatus {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  LEAVE = 'LEAVE',
}

export enum WorklistStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  CLOSED = 'CLOSED',
}

export enum ChartMilestone {
  READY_TO_ALLOCATE = 'READY_TO_ALLOCATE',
  READY_TO_CODE = 'READY_TO_CODE',
  CODING_IN_PROGRESS = 'CODING_IN_PROGRESS',
  CODING_DONE = 'CODING_DONE',
  READY_TO_AUDIT = 'READY_TO_AUDIT',
  AUDIT_IN_PROGRESS = 'AUDIT_IN_PROGRESS',
  AUDIT_DONE = 'AUDIT_DONE',
  CLOSED = 'CLOSED',
}

export enum ChartStatus {
  OPEN = 'OPEN',
  COMPLETE = 'COMPLETE',
  INCOMPLETE = 'INCOMPLETE',
  HOLD = 'HOLD',
}

export enum Priority {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  FINALIZED = 'FINALIZED',
}

export enum HccValidate {
  ADD = 'ADD',
  PASS = 'PASS',
  NA = 'NA',
}

export enum CodeReviewType {
  PRIMARY = 'PRIMARY',
  SECONDARY = 'SECONDARY',
  PROCEDURE = 'PROCEDURE',
  EM_LEVEL = 'EM_LEVEL',
  MODIFIER = 'MODIFIER',
}

export enum CodeReviewAction {
  REJECT = 'REJECT',
  EDIT = 'EDIT',
}

export enum CodeReviewDecision {
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  EDITED = 'EDITED',
  /** A code the coder added that the AI didn't suggest. Forwarded to
   * the orchestrator as action='ADD' so it enters the golden dataset. */
  ADDED = 'ADDED',
}

/** An auditor's per-code judgment of a coder's submitted decision. AGREE =
 * the coder got it right; DISAGREE = the coder got it wrong (carries a
 * feedback category + note). Internal QA only — not forwarded to the AI
 * gateway (there is no corrected code to teach). */
export enum CodeAuditVerdict {
  AGREE = 'AGREE',
  DISAGREE = 'DISAGREE',
}

export { Role } from './roles.enum';
