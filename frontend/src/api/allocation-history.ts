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
  role: AllocationRole;
  /** Previous slot holder — null when the slot was unassigned before. */
  from: AllocationParty | null;
  /** New slot holder — null when the slot was cleared. */
  to: AllocationParty | null;
  /** Who made the change — null for a system/unknown actor. */
  changedBy: AllocationParty | null;
  source: AllocationSource;
  /** Chart milestone captured at the moment of the change. */
  milestone: string | null;
  /** Chart status captured at the moment of the change. */
  chartStatus: string | null;
  /** ISO timestamp the event was recorded. */
  at: string;
}

export interface ListAllocationHistoryParams {
  chartNo?: string;
  role?: AllocationRole;
  source?: AllocationSource;
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

export const ALLOCATION_SOURCE_LABELS: Record<AllocationSource, string> = {
  DETAIL_SAVE: 'Detail save',
  BULK_ALLOCATE_CODING: 'Bulk — coding',
  BULK_ALLOCATE_AUDITING: 'Bulk — auditing',
  BULK_REALLOCATE_TO_ORIGINAL: 'Bulk — back to original',
  WORKLIST_ALLOCATE: 'Worklist allocate',
  SELF_ALLOCATE: 'Self-allocate',
  AUDIT_REALLOCATION: 'Audit reallocation',
};

export function allocationSourceLabel(s: string): string {
  return ALLOCATION_SOURCE_LABELS[s as AllocationSource] ?? s;
}
