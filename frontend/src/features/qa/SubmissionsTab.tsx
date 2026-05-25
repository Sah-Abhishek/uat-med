import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, FileSearch, Loader2, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { useTableSort, sortRows, type SortState } from '@/hooks/useTableSort';
import {
  listQaSubmissions,
  type QaFilters,
  type QaSubmissionRow,
} from '@/api/qa';
import { cn } from '@/lib/utils';

interface Props {
  filters: QaFilters;
  onResetFilters: () => void;
}

const PAGE_SIZE = 25;

export function SubmissionsTab({ filters, onResetFilters }: Props) {
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  // Client-side sort: reorders the rows on the page currently in view. The
  // initial undefined keeps the server's default order (last submitted desc).
  const { sort, toggle: onSort } = useTableSort({ sortBy: undefined, sortDir: 'asc' });

  const q = useQuery({
    queryKey: ['qa', 'submissions', filters, page],
    queryFn: () => listQaSubmissions({ ...filters, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  // Sort the current page's rows in the browser by the clicked column.
  const items = sortRows(q.data?.items ?? [], sort, {
    lastSubmitted: (r) => r.lastSubmittedAt,
    chartNo: (r) => r.chartNo,
    client: (r) => r.clientName,
    specialty: (r) => r.specialityName,
    coder: (r) => r.coderName,
    auditor: (r) => r.auditorName,
    milestone: (r) => r.milestone,
    codes: (r) => r.totalDecisions,
    time: (r) => r.timeTakenMs,
  });
  const total = q.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (q.isError && !q.data) {
    const msg = (q.error as any)?.response?.data?.error?.message
      ?? (q.error as any)?.message
      ?? 'Failed to load submissions.';
    return (
      <div className="rounded-xl border border-danger/30 bg-danger-soft/30 px-4 py-3 text-sm text-danger">
        {msg}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-line">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-sunken/40 sticky top-0 z-10">
              <tr className="text-left text-[10px] uppercase tracking-wide text-ink-muted">
                <QaTh column="lastSubmitted" sort={sort} onSort={onSort}>Last submitted</QaTh>
                <QaTh column="chartNo" sort={sort} onSort={onSort}>Chart #</QaTh>
                <QaTh column="client" sort={sort} onSort={onSort}>Client / Location</QaTh>
                <QaTh column="specialty" sort={sort} onSort={onSort}>Specialty</QaTh>
                <QaTh column="coder" sort={sort} onSort={onSort}>Coder</QaTh>
                <QaTh column="auditor" sort={sort} onSort={onSort}>Auditor</QaTh>
                <QaTh column="milestone" sort={sort} onSort={onSort}>Milestone</QaTh>
                <QaTh column="codes" sort={sort} onSort={onSort} align="right">Codes</QaTh>
                <QaTh>Verdicts</QaTh>
                <QaTh align="right">AI accuracy</QaTh>
                <QaTh column="time" sort={sort} onSort={onSort} align="right">Time</QaTh>
              </tr>
            </thead>
            <tbody>
              {q.isPending && !q.data ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-6 py-12">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <FileSearch className="w-8 h-8 text-ink-muted/60" />
                      <div>
                        <p className="text-sm font-semibold text-ink">No submissions match these filters</p>
                        <p className="text-xs text-ink-muted mt-1">
                          Try widening the date range or clearing filters.
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={onResetFilters}>
                        Reset filters
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <SubmissionRow
                    key={row.chartId + row.lastSubmittedAt}
                    row={row}
                    onClick={() => navigate(`/charts/${row.chartId}?qa=1`)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {items.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-line bg-surface-sunken/30 text-xs text-ink-muted">
            <div>
              {q.isFetching && <Loader2 className="inline w-3 h-3 animate-spin mr-1" />}
              Showing <span className="font-mono text-ink">{(page - 1) * PAGE_SIZE + 1}</span>
              {' – '}
              <span className="font-mono text-ink">{Math.min(page * PAGE_SIZE, total)}</span>
              {' of '}
              <span className="font-mono text-ink">{total}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 px-2 h-7 rounded border border-line text-xs font-semibold text-ink hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft className="w-3 h-3" /> Prev
              </button>
              <span className="px-2 font-mono text-ink">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex items-center gap-1 px-2 h-7 rounded border border-line text-xs font-semibold text-ink hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Next <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** QA submissions header cell — SortableHeader styled to match this compact
 * table. Pass `column`/`onSort` to make it sortable; omit for computed columns. */
function QaTh({
  children,
  column,
  sort,
  onSort,
  align,
}: {
  children: React.ReactNode;
  column?: string;
  sort?: SortState;
  onSort?: (column: string) => void;
  align?: 'right';
}) {
  return (
    <SortableHeader
      column={column}
      sort={sort}
      onSort={onSort}
      align={align}
      className="px-3 py-2.5 font-semibold"
    >
      {children}
    </SortableHeader>
  );
}

function SubmissionRow({ row, onClick }: { row: QaSubmissionRow; onClick: () => void }) {
  return (
    <tr
      onClick={onClick}
      className="border-t border-line hover:bg-surface-sunken/40 cursor-pointer transition group"
    >
      <td className="px-3 py-2.5 whitespace-nowrap text-ink">
        <div className="text-sm font-medium" title={new Date(row.lastSubmittedAt).toLocaleString()}>
          {formatRelative(row.lastSubmittedAt)}
        </div>
      </td>
      <td className="px-3 py-2.5 font-mono font-semibold text-ink">{row.chartNo ?? '—'}</td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <div className="text-sm text-ink">{row.clientName ?? '—'}</div>
        <div className="text-[11px] text-ink-muted">{row.locationName ?? '—'}</div>
      </td>
      <td className="px-3 py-2.5 text-sm text-ink whitespace-nowrap">
        {row.specialityName ?? <span className="text-ink-muted">—</span>}
      </td>
      <td className="px-3 py-2.5 text-sm text-ink whitespace-nowrap">
        {row.coderName ?? <span className="text-ink-muted">—</span>}
      </td>
      <td className="px-3 py-2.5 text-sm text-ink whitespace-nowrap">
        {row.auditorName ?? <span className="text-ink-muted">—</span>}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <MilestonePill milestone={row.milestone} />
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-ink">{row.totalDecisions}</td>
      <td className="px-3 py-2.5">
        <VerdictStrip accepted={row.accepted} rejected={row.rejected} edited={row.edited} />
      </td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap">
        <AccuracyCell accepted={row.accepted} total={row.totalDecisions} />
      </td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap font-mono text-ink-muted">
        {formatDuration(row.timeTakenMs)}
      </td>
    </tr>
  );
}

function VerdictStrip({
  accepted, rejected, edited,
}: { accepted: number; rejected: number; edited: number }) {
  const total = accepted + rejected + edited;
  if (total === 0) return <span className="text-ink-muted text-xs">—</span>;
  return (
    <div className="inline-flex items-center gap-1">
      {accepted > 0 && (
        <span
          className="inline-flex items-center gap-0.5 px-1.5 h-5 rounded-md bg-success-soft/60 text-success text-[10px] font-semibold border border-success/30"
          title={`${accepted} accepted`}
        >
          <Check className="w-2.5 h-2.5" strokeWidth={3} />
          {accepted}
        </span>
      )}
      {edited > 0 && (
        <span
          className="inline-flex items-center gap-0.5 px-1.5 h-5 rounded-md bg-info-soft/60 text-info text-[10px] font-semibold border border-info/30"
          title={`${edited} edited`}
        >
          <Pencil className="w-2.5 h-2.5" strokeWidth={3} />
          {edited}
        </span>
      )}
      {rejected > 0 && (
        <span
          className="inline-flex items-center gap-0.5 px-1.5 h-5 rounded-md bg-danger-soft/60 text-danger text-[10px] font-semibold border border-danger/30"
          title={`${rejected} rejected`}
        >
          <X className="w-2.5 h-2.5" strokeWidth={3} />
          {rejected}
        </span>
      )}
    </div>
  );
}

const MILESTONE_TONE: Record<string, string> = {
  READY_TO_ALLOCATE:  'bg-surface-sunken text-ink-muted border-line',
  READY_TO_CODE:      'bg-info-soft/40 text-info border-info/30',
  CODING_IN_PROGRESS: 'bg-warn-soft/40 text-warn border-warn/30',
  CODING_DONE:        'bg-success-soft/40 text-success border-success/30',
  READY_TO_AUDIT:     'bg-info-soft/40 text-info border-info/30',
  AUDIT_IN_PROGRESS:  'bg-warn-soft/40 text-warn border-warn/30',
  AUDIT_DONE:         'bg-success-soft/40 text-success border-success/30',
  CLOSED:             'bg-surface-sunken text-ink-muted border-line',
};

function MilestonePill({ milestone }: { milestone: string }) {
  const tone = MILESTONE_TONE[milestone] ?? 'bg-surface-sunken text-ink-muted border-line';
  return (
    <span className={cn(
      'inline-flex items-center px-2 h-5 rounded-md border text-[10px] font-semibold uppercase tracking-wide',
      tone,
    )}>
      {milestone.replace(/_/g, ' ')}
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-t border-line">
      {Array.from({ length: 11 }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-3 rounded bg-surface-sunken/60 animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

function AccuracyCell({ accepted, total }: { accepted: number; total: number }) {
  if (total === 0) return <span className="text-ink-muted text-xs">—</span>;
  const pct = (accepted / total) * 100;
  // Colored ring around the number — green ≥80, amber 60–79, red <60.
  const tone =
    pct >= 80 ? 'text-success' :
    pct >= 60 ? 'text-warn' :
    'text-danger';
  return (
    <span
      className={cn('inline-flex items-baseline gap-1 font-mono font-semibold', tone)}
      title={`${accepted} of ${total} accepted as-is`}
    >
      {pct.toFixed(0)}<span className="text-[10px] opacity-70">%</span>
    </span>
  );
}

/* ── Formatters ──────────────────────────────────────────── */

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '—';
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const d = Math.round(hr / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w} wk ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}
