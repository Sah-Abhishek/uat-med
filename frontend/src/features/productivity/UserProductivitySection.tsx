import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserCircle2 } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { DatePicker, FancySelect } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Primitives';
import { MilestoneChip } from '@/components/ui/Chip';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { useTableSort, sortRows } from '@/hooks/useTableSort';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import { listUsers } from '@/api/users';
import { getUserProductivity, type UserProductivityChartRow } from '@/api/dashboard';
import { useScope } from '@/scope/store';
import type { ChartMilestone } from '@/api/types';

/* ── Helpers ─────────────────────────────────────────────────────── */

// Local YYYY-MM-DD — matches what the backend's `::date` cast expects.
function todayLocal(): string {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// hh:mm:ss for ≥1h, mm:ss otherwise. 0 collapses to an em-dash so single-shot
// submits (where MAX-MIN=0) don't pretend to have a real duration.
function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}

/* ── Day breakdown chart: a single horizontal stacked bar ────────
 * Visualizes "of the N charts assigned today, this many were finished same-
 * day, this many carried over, this many are still pending". One row,
 * three segments, a legend with counts — no axes, no tooltips, no recharts
 * overhead. The whole point is to read it in under a second.
 *
 * Colors map to the same semantic tokens used by the KPI tiles:
 *   success → same-day (positive)
 *   warn    → carried over (attention, not alarm)
 *   neutral → pending (no judgment)
 * Deliberately avoids danger/red — none of these states are a failure.
 */
function DayBreakdownBar({
  assigned,
  sameDay,
  carried,
  loading,
}: {
  assigned: number;
  sameDay: number;
  carried: number;
  loading?: boolean;
}) {
  const pending = Math.max(0, assigned - sameDay - carried);
  if (loading) {
    return (
      <div className="rounded-card border border-line bg-surface p-4">
        <div className="h-3 w-32 bg-surface-sunken rounded animate-pulse mb-3" />
        <div className="h-3 w-full bg-surface-sunken rounded-full animate-pulse" />
      </div>
    );
  }
  if (assigned === 0) {
    return (
      <div className="rounded-card border border-line bg-surface px-4 py-5 text-center">
        <p className="text-xs text-ink-muted">
          No charts assigned on this day — nothing to break down.
        </p>
      </div>
    );
  }
  const pct = (n: number) => `${(n / assigned) * 100}%`;
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">
          Day breakdown
        </h3>
        <span className="text-xs text-ink-muted tabular-nums">
          Of {formatNumber(assigned)} assigned
        </span>
      </div>
      <div
        className="h-3 rounded-full bg-surface-sunken overflow-hidden flex"
        role="img"
        aria-label={`Day breakdown: ${sameDay} same-day, ${carried} carried over, ${pending} pending`}
      >
        {sameDay > 0 && <div className="bg-success" style={{ width: pct(sameDay) }} />}
        {carried > 0 && <div className="bg-warn" style={{ width: pct(carried) }} />}
        {pending > 0 && <div className="bg-ink-subtle/40" style={{ width: pct(pending) }} />}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3 text-xs">
        <LegendDot color="bg-success" label="Same-day" value={sameDay} />
        <LegendDot color="bg-warn" label="Carried over" value={carried} />
        <LegendDot color="bg-ink-subtle/40" label="Pending" value={pending} />
      </div>
    </div>
  );
}

function LegendDot({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink-muted">
      <span className={cn('w-2.5 h-2.5 rounded-full inline-block', color)} aria-hidden />
      <span>{label}</span>
      <span className="font-bold text-ink tabular-nums">{formatNumber(value)}</span>
    </span>
  );
}

/* ── Local tile (mirrors the SummaryTile pattern used elsewhere) ─── */

type Tone = 'mint' | 'sky' | 'indigo' | 'butter' | 'coral' | 'teal';

function KpiTile({
  label,
  value,
  tone,
  loading,
}: {
  label: string;
  value: number;
  tone: Tone;
  loading?: boolean;
}) {
  const toneMap: Record<Tone, string> = {
    mint: 'bg-tile-mint text-success',
    sky: 'bg-tile-sky text-info',
    indigo: 'bg-tile-indigo text-indigo-500 dark:text-indigo-300',
    butter: 'bg-tile-butter text-primary-ink',
    coral: 'bg-tile-coral text-danger',
    teal: 'bg-tile-teal text-teal-600 dark:text-teal-300',
  };
  return (
    <div className={cn('rounded-card p-4', toneMap[tone])}>
      {loading ? (
        <div className="h-7 w-12 rounded bg-current/10 animate-pulse" />
      ) : (
        <p className="text-2xl font-bold leading-none tracking-tightish tabular-nums">
          {formatNumber(value)}
        </p>
      )}
      <p className="text-[11px] font-semibold mt-1.5">{label}</p>
    </div>
  );
}

/* ── Section ─────────────────────────────────────────────────────── */

export function UserProductivitySection() {
  const clientId = useScope((s) => s.clientId);
  const locationId = useScope((s) => s.locationId);

  const [userId, setUserId] = useState<number | null>(null);
  const [userLabel, setUserLabel] = useState<string>('');
  const [date, setDate] = useState<string>(todayLocal());
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // Server-driven user search (matches the pattern used in the Charts filter).
  const [userSearch, setUserSearch] = useState('');
  const usersQ = useQuery({
    queryKey: ['users', 'productivity', userSearch],
    queryFn: () => listUsers({ pageSize: 50, search: userSearch || undefined }),
    // No `enabled` gate — we want the picker primed before the user opens it.
  });

  // Reset to page 1 whenever the user, date, or scope changes — old pages
  // wouldn't apply to a different dataset.
  useEffect(() => {
    setPage(1);
  }, [userId, date, clientId, locationId]);

  const dataQ = useQuery({
    queryKey: ['dashboard', 'user-productivity', userId, date, clientId, locationId, page, pageSize],
    queryFn: () =>
      getUserProductivity({
        userId: userId!,
        date,
        ...(clientId != null ? { clientId } : {}),
        ...(locationId != null ? { locationId } : {}),
        page,
        pageSize,
      }),
    enabled: !!userId && !!date,
    placeholderData: (prev) => prev,
  });

  // Client-side sort of the current page's rows. Server already orders by
  // first-worked DESC; the hook lets the user re-sort what's on screen.
  const { sort, toggle: onSort } = useTableSort({ sortBy: 'firstWorkedAt', sortDir: 'desc' });
  const sortedItems = useMemo(
    () =>
      sortRows<UserProductivityChartRow>(dataQ.data?.charts ?? [], sort, {
        chartNo: (r) => r.chartNo,
        assignedAt: (r) => r.assignedAt,
        firstWorkedAt: (r) => r.firstWorkedAt,
        timeSpentMs: (r) => r.timeSpentMs,
      }),
    [dataQ.data, sort],
  );

  const totalPages = dataQ.data ? Math.max(1, Math.ceil(dataQ.data.total / pageSize)) : 1;
  const summary = dataQ.data?.summary;
  const empty = !userId;

  return (
    <Card padding="default">
      <div className="space-y-5">
        {/* Header */}
        <div>
          <h2 className="text-base font-bold text-ink">Per-User Productivity</h2>
          <p className="text-xs text-ink-muted mt-1">
            Review a coder or auditor&apos;s day. <span className="text-ink">Worked</span> = first day
            they submitted code decisions on a chart.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[280px] flex-1 max-w-md">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">User</p>
            <FancySelect
              searchable
              onSearch={setUserSearch}
              loading={usersQ.isFetching}
              searchPlaceholder="Search users…"
              placeholder="Pick a user"
              value={userId != null ? String(userId) : ''}
              onChange={(v) => {
                const next = v ? Number(v) : null;
                setUserId(next);
                const match = usersQ.data?.items.find((u) => String(u.id) === v);
                setUserLabel(match?.fullName ?? '');
              }}
              options={(usersQ.data?.items ?? []).map((u) => ({
                value: String(u.id),
                label: u.fullName,
              }))}
            />
          </div>
          <div className="min-w-[180px]">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Date</p>
            <DatePicker value={date} onChange={(v) => setDate(v || todayLocal())} max={todayLocal()} />
          </div>
        </div>

        {/* KPI tiles */}
        {empty ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile
              label="Assigned that day"
              value={summary?.assignedThatDay ?? 0}
              tone="sky"
              loading={dataQ.isPending}
            />
            <KpiTile
              label="Worked same day"
              value={summary?.workedSameDay ?? 0}
              tone="mint"
              loading={dataQ.isPending}
            />
            <KpiTile
              label="Carried over"
              value={summary?.carriedOver ?? 0}
              tone="butter"
              loading={dataQ.isPending}
            />
            <KpiTile
              label="Eventually worked"
              value={summary?.eventuallyWorked ?? 0}
              tone="indigo"
              loading={dataQ.isPending}
            />
          </div>
        )}

        {/* Day breakdown chart */}
        {!empty && (
          <DayBreakdownBar
            assigned={summary?.assignedThatDay ?? 0}
            sameDay={summary?.workedSameDay ?? 0}
            carried={summary?.carriedOver ?? 0}
            loading={dataQ.isPending}
          />
        )}

        {/* Table */}
        {!empty && (
          <div className="rounded-card border border-line overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="bg-surface-sunken/40">
                  <tr>
                    <SortableHeader column="chartNo" sort={sort} onSort={onSort}>Chart #</SortableHeader>
                    <SortableHeader column="assignedAt" sort={sort} onSort={onSort}>Assigned</SortableHeader>
                    <SortableHeader column="firstWorkedAt" sort={sort} onSort={onSort}>First worked</SortableHeader>
                    <SortableHeader column="timeSpentMs" sort={sort} onSort={onSort}>Time on chart</SortableHeader>
                    <th className="table-head">Milestone</th>
                  </tr>
                </thead>
                <tbody>
                  {dataQ.isPending || dataQ.isPlaceholderData ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={`skel-${i}`} className="border-t border-line/60">
                        {Array.from({ length: 5 }).map((__, j) => (
                          <td key={j} className="table-cell">
                            <div className="h-3 w-20 rounded bg-surface-sunken animate-pulse" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : sortedItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-sm text-ink-muted">
                        {userLabel ? (
                          <>No charts worked yet for <span className="text-ink font-semibold">{userLabel}</span>.</>
                        ) : (
                          <>No charts worked yet.</>
                        )}
                      </td>
                    </tr>
                  ) : (
                    sortedItems.map((r) => (
                      <tr key={r.chartId} className="border-t border-line/60 hover:bg-surface-sunken/40 transition-colors">
                        <td className="table-cell font-mono text-xs">{r.chartNo ?? '—'}</td>
                        <td className="table-cell text-ink-muted whitespace-nowrap">
                          {r.assignedAt ? formatDate(r.assignedAt) : '—'}
                        </td>
                        <td className="table-cell text-ink-muted whitespace-nowrap">
                          {formatDate(r.firstWorkedAt)}
                        </td>
                        <td className="table-cell font-mono tabular-nums">{formatDuration(r.timeSpentMs)}</td>
                        <td className="table-cell">
                          <MilestoneChip milestone={r.milestone as ChartMilestone} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {dataQ.data && dataQ.data.total > pageSize && (
              <Pagination
                page={page}
                pageCount={totalPages}
                onPageChange={setPage}
                pageSize={pageSize}
                total={dataQ.data.total}
              />
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/* ── Empty state ─────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="rounded-card border border-dashed border-line bg-surface-sunken/30 px-6 py-10 text-center">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-surface mb-3">
        <UserCircle2 className="w-5 h-5 text-ink-muted" />
      </div>
      <p className="text-sm font-semibold text-ink">Pick a user to see their productivity</p>
      <p className="text-xs text-ink-muted mt-1">
        We&apos;ll show what was assigned on the selected day, what they finished same-day, what
        carried over, and every chart they&apos;ve ever submitted decisions on.
      </p>
    </div>
  );
}
