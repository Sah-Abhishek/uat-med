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

export { Role } from './roles.enum';
