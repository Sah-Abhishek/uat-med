import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, Clock, FileStack, Pause, RefreshCw, Users } from 'lucide-react';

import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Avatar, PillBadge } from '@/components/ui/Primitives';
import { getActiveWork, type ActiveWorkItem } from '@/api/admin';
import { cn } from '@/lib/utils';

/** Live h/m/s duration that ticks between server refreshes. */
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const KIND_LABEL: Record<ActiveWorkItem['kind'], string> = { CODING: 'Coding', AUDIT: 'Audit' };

export function ActiveWorkPage() {
  // Poll every 8s for new/closed sessions; tick `now` every second so each
  // row's elapsed counts up smoothly between polls.
  const q = useQuery({
    queryKey: ['admin', 'active-work'],
    queryFn: getActiveWork,
    refetchInterval: 8_000,
    refetchOnWindowFocus: true,
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(iv);
  }, []);

  const items = q.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Live Activity"
        subtitle="Charts being worked on right now — coders and auditors with a running or paused timer."
        actions={
          <button
            type="button"
            onClick={() => q.refetch()}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-pill border border-line text-sm font-semibold text-ink hover:bg-surface-2 transition"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', q.isFetching && 'animate-spin')} />
            Refresh
          </button>
        }
      />

      {/* KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <KpiTile label="Active sessions" value={q.data?.total ?? 0} icon={<Activity className="w-4 h-4" />} tone="primary" />
        <KpiTile label="People working" value={q.data?.distinctUsers ?? 0} icon={<Users className="w-4 h-4" />} tone="info" />
        <KpiTile label="Charts in progress" value={q.data?.distinctCharts ?? 0} icon={<FileStack className="w-4 h-4" />} tone="success" />
      </div>

      <Card padding="none">
        {q.isPending ? (
          <p className="p-6 text-sm text-ink-muted">Loading…</p>
        ) : q.isError ? (
          <p className="p-6 text-sm text-danger">Failed to load active work.</p>
        ) : items.length === 0 ? (
          <div className="p-10 text-center">
            <Clock className="w-6 h-6 text-ink-subtle mx-auto mb-2" />
            <p className="text-sm font-semibold text-ink">No charts are being worked on right now</p>
            <p className="text-[11px] text-ink-muted mt-1">
              Sessions appear here the moment a coder or auditor starts a timer.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted border-b border-line">
                  <th className="px-4 py-2.5 font-semibold">User</th>
                  <th className="px-4 py-2.5 font-semibold">Activity</th>
                  <th className="px-4 py-2.5 font-semibold">Chart</th>
                  <th className="px-4 py-2.5 font-semibold">Worklist</th>
                  <th className="px-4 py-2.5 font-semibold">Client / Location</th>
                  <th className="px-4 py-2.5 font-semibold">Started</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Elapsed</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  // Paused rows show the frozen total; running rows tick from startedAt.
                  const liveMs = it.paused
                    ? it.elapsedMs
                    : Math.max(it.elapsedMs, now - Date.parse(it.startedAt));
                  return (
                    <tr key={it.sessionId} className="border-b border-line/60 last:border-b-0 hover:bg-surface-2/40">
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <Avatar name={it.userName ?? 'Unknown'} src={it.avatarUrl ?? undefined} size="sm" />
                          <span className="min-w-0">
                            <span className="block text-xs font-medium text-ink truncate">
                              {it.userName ?? `User #${it.userId}`}
                            </span>
                            {it.userRole && (
                              <span className="block text-[10px] text-ink-subtle">{it.userRole}</span>
                            )}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <PillBadge tone={it.kind === 'AUDIT' ? 'sky' : 'mint'}>
                            {KIND_LABEL[it.kind] ?? it.kind}
                          </PillBadge>
                          {it.paused && <PillBadge tone="butter">Paused</PillBadge>}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <Link
                          to={`/charts/${it.chartId}`}
                          className="font-mono text-xs font-semibold text-primary hover:underline"
                        >
                          {it.chartNo || `#${it.chartId}`}
                        </Link>
                        {it.milestone && (
                          <span className="block text-[10px] text-ink-subtle">{it.milestone}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-ink-muted">{it.worklistNumber ?? '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-ink-muted">
                        {it.clientName ?? '—'}
                        {it.locationName ? <span className="text-ink-subtle"> · {it.locationName}</span> : null}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-ink-muted">{fmtClock(it.startedAt)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {it.paused ? (
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-warn tabular-nums">
                            <Pause className="w-3 h-3" />
                            {fmtElapsed(liveMs)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-success tabular-nums">
                            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                            {fmtElapsed(liveMs)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── KPI tile ─────────────────────────────────────────────── */

const TONE_RING: Record<'primary' | 'info' | 'success', string> = {
  primary: 'bg-primary/10 text-primary',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
};

function KpiTile({
  label, value, icon, tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: 'primary' | 'info' | 'success';
}) {
  return (
    <Card padding="default">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted">{label}</p>
          <p className="mt-1 text-2xl font-bold text-ink tabular-nums">{value}</p>
        </div>
        <div className={cn('shrink-0 w-8 h-8 rounded-lg flex items-center justify-center', TONE_RING[tone])}>
          {icon}
        </div>
      </div>
    </Card>
  );
}
