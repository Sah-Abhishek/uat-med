import { get } from './client';
import type { Paginated } from './types';

export type AllocationRole = 'CODER' | 'AUDITOR';

/** How an allocation change happened — mirrors the backend AllocationSource. */
export type AllocationSource =
  | 'DETAIL_SAVE'
  | 'BULK_ALLOCATE_CODING'
  | 'BULK_ALLOCATE_AUDITING'
  | 'BULK_REALLOCATE_TO_ORIGINAL'
  | 'WORKLIST_ALLOCATE'
  | 'SELF_ALLOCATE'
  | 'AUDIT_REALLOCATION';

/** How a manual priority-PIN change happened — mirrors the backend PrioritySource. */
export type PrioritySource =
  | 'DETAIL_SAVE_PIN'
  | 'BULK_MODIFY_PIN'
  | 'REVIEWER_COMMENT_HIGH_PIN'
  | 'TIMER_TOUCH_UNPIN';

export type EventType = 'ALLOCATION' | 'PRIORITY';
export type EventSource = AllocationSource | PrioritySource;

/** A user referenced by an event (previous holder, new holder, or actor). */
export interface AllocationParty {
  id: number;
  name: string | null;
}

/** One row of the global allocation-history audit trail. */
export interface AllocationEventRow {
  id: number;
  chartId: number;
  chartNo: string | null;
  worklistId: number | null;
  worklistNumber: string | null;
  clientName: string | null;
  locationName: string | null;
  /** 'ALLOCATION' (coder/auditor change) or 'PRIORITY' (manual pin change). */
  eventType: EventType;
  /** Set for ALLOCATION events; null for PRIORITY events. */
  role: AllocationRole | null;
  /** PRIORITY events: pin bucket before → after (null = not pinned). */
  fromPriority: string | null;
  toPriority: string | null;
  /** Previous slot holder — null when the slot was unassigned before. */
  from: AllocationParty | null;
  /** New slot holder — null when the slot was cleared. */
  to: AllocationParty | null;
  /** Who made the change — null for a system/unknown actor. */
  changedBy: AllocationParty | null;
  source: EventSource;
  /** Chart milestone captured at the moment of the change. */
  milestone: string | null;
  /** Chart status captured at the moment of the change. */
  chartStatus: string | null;
  /** ISO timestamp the event was recorded. */
  at: string;
}

export interface ListAllocationHistoryParams {
  chartNo?: string;
  eventType?: EventType;
  role?: AllocationRole;
  source?: EventSource;
  /** Events where this user is the previous OR new holder (from OR to). */
  userId?: number;
  /** Events performed by this actor. */
  changedById?: number;
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  page?: number;
  pageSize?: number;
}

/** Manager-only global audit trail of every coder/auditor allocation change. */
export const listAllocationHistory = (params: ListAllocationHistoryParams = {}) =>
  get<Paginated<AllocationEventRow>>('/charts/allocation-history', params);

/** One row of the "By user" view: how many distinct charts have ever been
 *  allocated to this user (as coder and/or auditor), from the audit log. */
export interface AllocationUserRow {
  userId: number;
  name: string | null;
  role: string;
  coderCharts: number;
  auditorCharts: number;
  totalCharts: number;
}

/** Manager-only per-user allocation totals derived from the audit log. */
export const listAllocationHistoryByUser = () =>
  get<{ users: AllocationUserRow[] }>('/charts/allocation-history/users');

/* ── Display helpers ─────────────────────────────────────── */

export const ALLOCATION_SOURCE_LABELS: Record<EventSource, string> = {
  DETAIL_SAVE: 'Detail save',
  BULK_ALLOCATE_CODING: 'Bulk — coding',
  BULK_ALLOCATE_AUDITING: 'Bulk — auditing',
  BULK_REALLOCATE_TO_ORIGINAL: 'Bulk — back to original',
  WORKLIST_ALLOCATE: 'Worklist allocate',
  SELF_ALLOCATE: 'Self-allocate',
  AUDIT_REALLOCATION: 'Audit reallocation',
  DETAIL_SAVE_PIN: 'Detail save (pin)',
  BULK_MODIFY_PIN: 'Bulk modify (pin)',
  REVIEWER_COMMENT_HIGH_PIN: 'Reviewer comment (HIGH pin)',
  TIMER_TOUCH_UNPIN: 'Timer start (auto-unpin)',
};

export function allocationSourceLabel(s: string): string {
  return ALLOCATION_SOURCE_LABELS[s as EventSource] ?? s;
}
