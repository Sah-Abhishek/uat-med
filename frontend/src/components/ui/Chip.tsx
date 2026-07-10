import { cn } from '@/lib/utils';
import type {
  AiStatus,
  ChartMilestone,
  ChartStatus,
  Priority,
  WorklistStatus,
} from '@/api/types';

/* ── Chart status (OPEN | COMPLETE | INCOMPLETE | HOLD) ───── */
const CHART_STATUS_STYLES: Record<ChartStatus, string> = {
  OPEN: 'bg-warn-soft text-warn',
  COMPLETE: 'bg-success-soft text-success',
  INCOMPLETE: 'bg-danger-soft text-danger',
  HOLD: 'bg-surface-sunken text-ink-muted',
};
const CHART_STATUS_LABEL: Record<ChartStatus, string> = {
  OPEN: 'Open',
  COMPLETE: 'Complete',
  INCOMPLETE: 'Incomplete',
  HOLD: 'Hold',
};

export function ChartStatusChip({ status }: { status: ChartStatus }) {
  return <span className={cn('chip', CHART_STATUS_STYLES[status])}>{CHART_STATUS_LABEL[status]}</span>;
}

/* Reports-style colored-text status (no background) */
const CHART_STATUS_TEXT_COLOR: Record<ChartStatus, string> = {
  OPEN: 'text-warn',
  COMPLETE: 'text-success',
  INCOMPLETE: 'text-danger',
  HOLD: 'text-ink-muted',
};
export function ChartStatusText({ status }: { status: ChartStatus }) {
  return (
    <span className={cn('font-medium text-sm', CHART_STATUS_TEXT_COLOR[status])}>
      {CHART_STATUS_LABEL[status]}
    </span>
  );
}

/* ── Worklist status (OPEN | IN_PROGRESS | CLOSED | COMPLETED) ── */
const WORKLIST_STATUS_STYLES: Record<WorklistStatus, string> = {
  OPEN: 'bg-warn-soft text-warn',
  IN_PROGRESS: 'bg-info-soft text-info',
  CLOSED: 'bg-success-soft text-success',
  COMPLETED: 'bg-success text-white',
};
const WORKLIST_STATUS_LABEL: Record<WorklistStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  CLOSED: 'Closed',
  COMPLETED: 'Completed',
};
export function WorklistStatusChip({ status }: { status: WorklistStatus }) {
  return <span className={cn('chip', WORKLIST_STATUS_STYLES[status])}>{WORKLIST_STATUS_LABEL[status]}</span>;
}

/* ── Priority (CRITICAL | HIGH | MEDIUM | LOW | FINALIZED) ── */
const PRIORITY_STYLES: Record<Priority, string> = {
  CRITICAL: 'bg-danger-soft text-danger',
  HIGH: 'bg-warn-soft text-warn',
  MEDIUM: 'bg-info-soft text-info',
  LOW: 'bg-surface-sunken text-ink-muted',
  FINALIZED: 'bg-success-soft text-success',
};
const PRIORITY_LABEL: Record<Priority, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  // §4.7 Finalized bucket (Managers): Coding/Audit Done + Complete.
  FINALIZED: 'Finalized',
};
export function PriorityChip({ priority }: { priority?: Priority | null }) {
  // No priority value → render nothing (no empty pill). A coder's completed
  // charts now come back with a null priority (the non-manual "Finalized" chip
  // was removed), so guard against a falsy value here.
  if (!priority || !PRIORITY_LABEL[priority]) return null;
  return (
    <span className={cn('chip', PRIORITY_STYLES[priority])}>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

/* ── Milestone (8 values including READY_TO_ALLOCATE + CLOSED) ────────────────── */
const MILESTONE_STYLES: Record<ChartMilestone, string> = {
  READY_TO_ALLOCATE: 'bg-surface-sunken text-ink-muted',
  READY_TO_CODE: 'bg-info-soft text-info',
  CODING_IN_PROGRESS: 'bg-warn-soft text-warn',
  CODING_DONE: 'bg-success-soft text-success',
  READY_TO_AUDIT: 'bg-info-soft text-info',
  AUDIT_IN_PROGRESS: 'bg-warn-soft text-warn',
  AUDIT_DONE: 'bg-success-soft text-success',
  CLOSED: 'bg-surface-sunken text-ink-muted',
};
const MILESTONE_LABEL: Record<ChartMilestone, string> = {
  READY_TO_ALLOCATE: 'Ready to Allocate',
  READY_TO_CODE: 'Ready to Code',
  CODING_IN_PROGRESS: 'Coding',
  CODING_DONE: 'Coding Done',
  READY_TO_AUDIT: 'Ready to Audit',
  AUDIT_IN_PROGRESS: 'Auditing',
  AUDIT_DONE: 'Audit Done',
  CLOSED: 'Closed',
};
export function MilestoneChip({ milestone }: { milestone: ChartMilestone }) {
  return (
    <span className={cn('chip', MILESTONE_STYLES[milestone])}>
      {MILESTONE_LABEL[milestone]}
    </span>
  );
}

/* ── AI pipeline status (NONE | QUEUED | PROCESSING | DONE | ERRORED) ─── */
const AI_STATUS_STYLES: Record<AiStatus, string> = {
  NONE: 'bg-surface-sunken text-ink-subtle',
  QUEUED: 'bg-info-soft text-info',
  PROCESSING: 'bg-warn-soft text-warn',
  DONE: 'bg-success-soft text-success',
  ERRORED: 'bg-danger-soft text-danger',
};
const AI_STATUS_LABEL: Record<AiStatus, string> = {
  NONE: '—',
  QUEUED: 'Queued',
  PROCESSING: 'Processing',
  DONE: 'Done',
  ERRORED: 'Errored',
};
export function AiStatusChip({ status }: { status: AiStatus }) {
  if (status === 'NONE') {
    return <span className="text-ink-subtle text-xs">—</span>;
  }
  return <span className={cn('chip', AI_STATUS_STYLES[status])}>{AI_STATUS_LABEL[status]}</span>;
}

/* ── Generic pill badge (mint "X Selected", etc.) ─────────── */
export function PillBadge({
  tone = 'mint',
  children,
  className,
}: {
  tone?: 'mint' | 'butter' | 'coral' | 'sky';
  children: React.ReactNode;
  className?: string;
}) {
  const toneMap = {
    mint: 'bg-success-soft text-success',
    butter: 'bg-primary-soft text-primary-ink dark:text-primary',
    coral: 'bg-danger-soft text-danger',
    sky: 'bg-info-soft text-info',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center px-3 py-1 rounded-pill text-xs font-semibold',
        toneMap[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
