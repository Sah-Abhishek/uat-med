import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Primitives';
import { getChartTimeByUser, type ChartTimeEntry } from '@/api/charts';
import { cn } from '@/lib/utils';

/** h:mm:ss-ish compact duration for a session row. */
function fmtDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Local clock time for a session's start/stop. */
function fmtClock(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const KIND_LABEL: Record<ChartTimeEntry['kind'], string> = {
  CODING: 'Coding',
  AUDIT: 'Audit',
};

export function TimeTracker({ chartId }: { chartId: string }) {
  const q = useQuery({
    queryKey: ['chart-time', chartId],
    queryFn: () => getChartTimeByUser(chartId),
    refetchOnWindowFocus: true,
    // While a session is running the time is live, so poll; otherwise rest.
    refetchInterval: (query) =>
      query.state.data?.entries.some((e) => e.running) ? 10_000 : false,
  });

  const entries = q.data?.entries ?? [];
  const totalMs = entries.reduce((sum, e) => sum + e.elapsedMs, 0);

  return (
    <Card padding="default">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.1em] text-ink-muted font-semibold">
            Time Tracker
          </p>
          <p className="text-[11px] text-ink-subtle">Each coding / audit session</p>
        </div>
        {entries.length > 0 && (
          <span
            className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-ink"
            title={`${entries.length} session${entries.length === 1 ? '' : 's'} · total`}
          >
            <Clock className="w-3.5 h-3.5 text-ink-subtle" />
            {fmtDuration(totalMs)}
          </span>
        )}
      </div>

      {q.isPending ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Clock className="w-3.5 h-3.5 text-ink-subtle" />
          No time tracked yet
        </div>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2.5">
              <Avatar name={e.userName ?? 'Unknown'} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-ink truncate">
                  {e.userName ?? `User #${e.userId}`}
                </p>
                <p className="text-[10px] text-ink-subtle inline-flex items-center gap-1.5">
                  <span>
                    {KIND_LABEL[e.kind] ?? e.kind} · {fmtClock(e.startedAt)}
                    {e.running ? '' : ` – ${fmtClock(e.stoppedAt)}`}
                  </span>
                  {e.running && (
                    <span className="inline-flex items-center gap-1 text-success font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                      live
                    </span>
                  )}
                </p>
              </div>
              <span
                className={cn(
                  'shrink-0 font-mono text-xs tabular-nums',
                  e.running ? 'text-success font-semibold' : 'text-ink',
                )}
              >
                {fmtDuration(e.elapsedMs)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
