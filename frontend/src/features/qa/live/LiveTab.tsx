import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Radio, Users } from 'lucide-react';
import { getQaLive } from '@/api/qa';
import { useAuth } from '@/auth/store';
import { LiveCardList } from './LiveCard';

const POLL_MS = 4_000;

/**
 * QA Live tab — a directory of who's working a chart right now. Polls
 * /qa/live for the cards; clicking a coder opens their chart in read-only QA
 * mode, where the per-chart live decision toasts take over (see
 * ChartLiveDecisionToasts). No toasts here by design — notifications are
 * scoped to the chart the QA actually opened.
 */
export function LiveTab() {
  const navigate = useNavigate();
  const currentUserId = useAuth((s) => s.user?.id ?? null);

  const q = useQuery({
    queryKey: ['qa', 'live'],
    queryFn: getQaLive,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const [now, setNow] = useState(() => Date.now());
  const skewMsRef = useRef(0);

  // Open the chart in read-only QA mode and auto-open its Review & Edit modal
  // seeded from THIS coder's live draft; the name rides along for the toasts.
  const openChart = (chartId: number, userId: number, name: string) =>
    navigate(`/charts/${chartId}?qa=1&liveUserId=${userId}&liveName=${encodeURIComponent(name)}`);

  // Tick for the "working 12m" durations between polls.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(iv);
  }, []);

  // Skew-correct the client clock against the server's, refreshed each poll.
  useEffect(() => {
    if (q.data) skewMsRef.current = Date.now() - Date.parse(q.data.serverNow);
  }, [q.dataUpdatedAt]);

  // Self-exclusion is done server-side; this is a defensive client fallback in
  // case the same account is open in two places.
  const drafts = useMemo(
    () => (q.data?.drafts ?? []).filter((d) => String(d.user.id) !== String(currentUserId)),
    [q.data, currentUserId],
  );

  const distinctUsers = new Set(drafts.map((d) => d.user.id)).size;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success/60" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
          </span>
          <h3 className="text-sm font-bold text-ink">Live</h3>
          <span className="text-xs text-ink-muted inline-flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" />
            {distinctUsers} working now
          </span>
          {q.isFetching && <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-subtle" />}
        </div>
        <p className="text-[11px] text-ink-subtle">Open a coder to watch their decisions live · auto-refreshing</p>
      </div>

      {q.isPending ? (
        <p className="py-10 text-center text-sm text-ink-muted">Loading live activity…</p>
      ) : q.isError ? (
        <p className="py-10 text-center text-sm text-danger">Failed to load live activity.</p>
      ) : drafts.length === 0 ? (
        <div className="py-16 text-center">
          <Radio className="w-7 h-7 text-ink-subtle mx-auto mb-2" />
          <p className="text-sm font-semibold text-ink">No one is working a chart right now</p>
          <p className="text-[11px] text-ink-muted mt-1">
            A coder or auditor appears here the moment they start a chart's timer. Open one to watch
            their decisions stream in.
          </p>
        </div>
      ) : (
        <LiveCardList drafts={drafts} now={now} skewMs={skewMsRef.current} onOpen={openChart} />
      )}
    </div>
  );
}
