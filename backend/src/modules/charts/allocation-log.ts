import { Repository } from 'typeorm';
import { ChartAllocationEvent } from '../../entities/chart-allocation-event.entity';

/** How an allocation change happened — one per code path that mutates a coder/auditor slot. */
export type AllocationSource =
  | 'DETAIL_SAVE'
  | 'BULK_ALLOCATE_CODING'
  | 'BULK_ALLOCATE_AUDITING'
  | 'BULK_REALLOCATE_TO_ORIGINAL'
  | 'WORKLIST_ALLOCATE'
  | 'SELF_ALLOCATE'
  | 'AUDIT_REALLOCATION';

export interface AllocationEventInput {
  chartId: number;
  role: 'CODER' | 'AUDITOR';
  fromUserId?: number | null;
  toUserId?: number | null;
  changedById?: number | null;
  source: AllocationSource;
  milestone?: string | null;
  chartStatus?: string | null;
  worklistId?: number | null;
}

const norm = (v: number | null | undefined): number | null => (v == null ? null : Number(v));

/**
 * Append a coder/auditor allocation-change event. No-ops when the slot didn't
 * actually change owner (from === to) so plain re-saves don't create noise.
 * Pass the request-scoped repository, or a transaction manager's repository when
 * inside `ds.transaction(...)`, so the event commits with the allocation.
 */
export async function logAllocationEvent(
  repo: Repository<ChartAllocationEvent>,
  e: AllocationEventInput,
): Promise<void> {
  const from = norm(e.fromUserId);
  const to = norm(e.toUserId);
  if (from === to) return;
  await repo.save(
    repo.create({
      chartId: e.chartId,
      role: e.role,
      fromUserId: from,
      toUserId: to,
      changedById: norm(e.changedById),
      source: e.source,
      milestone: e.milestone ?? null,
      chartStatus: e.chartStatus ?? null,
      worklistId: e.worklistId ?? null,
    }),
  );
}
