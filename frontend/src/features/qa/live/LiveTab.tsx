import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Radio, Users } from 'lucide-react';
import { getQaLive } from '@/api/qa';
import { useAuth } from '@/auth/store';
import { LiveCardList } from './LiveCard';
import { LiveToastStack, type LiveToast } from './LiveToastStack';
import { DECISION_VARIANT, DECISION_VERB, decodeDecisions, draftKey, type LiveDecision } from './shared';

const POLL_MS = 4_000;
/** A decision on a row idle longer than this never toasts (defends against a
 * stale draft scrolling into the 30-min window for the first time). */
const FRESH_MS = 90_000;
/** Per-user: more than this many events in one poll collapse to a count. */
const COALESCE = 3;
/** Across all users: more than this in one poll collapses to a single line. */
const GLOBAL_CAP = 8;
/** Max toasts visible at once (FIFO). */
const STACK_CAP = 4;

/** Baseline value we keep per (chart,user,category,code). Only `decision`
 * drives toasts; the rest is for rendering messages / reopen detection. */
interface PrevEntry {
  decision: LiveDecision;
  userName: string;
  code: string;
  dk: string; // draftKey (chartId:userId)
}

interface DiffEvent {
  kind: 'decide' | 'reopen';
  userId: string;
  userName: string;
  code: string;
  decision?: LiveDecision;
  dk: string;
}

export function LiveTab() {
  const navigate = useNavigate();
  const currentUserId = useAuth((s) => s.user?.id ?? null);

  const q = useQuery({
    queryKey: ['qa', 'live'],
    queryFn: getQaLive,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  const [toasts, setToasts] = useState<LiveToast[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // Open the chart in read-only QA mode and auto-open its Review & Edit modal
  // seeded from THIS coder's live draft (see ChartDetailPage `liveUserId`).
  const openChart = (chartId: number, userId: number) =>
    navigate(`/charts/${chartId}?qa=1&liveUserId=${userId}`);
  const openFromKey = (key: string) => {
    const [chartId, userId] = key.split(':');
    openChart(Number(chartId), Number(userId));
  };

  const prevByKey = useRef<Map<string, PrevEntry>>(new Map());
  const seededRef = useRef(false);
  const seedServerMsRef = useRef(0);
  const skewMsRef = useRef(0);
  const toastIdRef = useRef(0);

  // Tick for relative "updated 12s ago" / liveness dots between polls.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(iv);
  }, []);

  // Self-exclusion is done server-side; this is a defensive client fallback in
  // case the same account is open in two places.
  const drafts = useMemo(
    () => (q.data?.drafts ?? []).filter((d) => String(d.user.id) !== String(currentUserId)),
    [q.data, currentUserId],
  );

  // ── Diff each successful fetch exactly once. Keyed on dataUpdatedAt (a stable
  // monotonic number that advances on every successful poll) — never on `data`
  // identity, never on a removed v5 onSuccess. A re-run with the same snapshot
  // produces zero events because the baseline already advanced (StrictMode-safe).
  useEffect(() => {
    const data = q.data;
    if (!data) return;

    const serverMs = Date.parse(data.serverNow);
    skewMsRef.current = Date.now() - serverMs;

    // Build the fresh snapshot + per-draft freshness (server-relative age).
    const newMap = new Map<string, PrevEntry>();
    const ageByDraft = new Map<string, number>();
    for (const d of data.drafts) {
      if (String(d.user.id) === String(currentUserId)) continue;
      const dk = draftKey(d);
      ageByDraft.set(dk, serverMs - Date.parse(d.updatedAt));
      const userName = d.user.fullName ?? `User #${d.user.id}`;
      for (const e of decodeDecisions(d.payload)) {
        const code = e.code?.trim();
        if (!code) continue; // can't say "rejected ''" — wait for the code
        newMap.set(`${dk}:${e.category}:${code}`, { decision: e.decision, userName, code, dk });
      }
    }

    // First successful poll seeds silently: current state is the baseline, so
    // only decisions made AFTER the QA opened the tab produce toasts.
    if (!seededRef.current) {
      prevByKey.current = newMap;
      seedServerMsRef.current = serverMs;
      seededRef.current = true;
      return;
    }

    const events: DiffEvent[] = [];

    // New or decision-changed entries → "decide" events. Gated so a decision
    // that predates the seed (mount race) or sits on a stale row never toasts.
    for (const [key, val] of newMap) {
      const prev = prevByKey.current.get(key);
      if (prev && prev.decision === val.decision) continue; // unchanged / silent edit
      const age = ageByDraft.get(val.dk) ?? Infinity;
      const updatedMs = serverMs - age;
      if (updatedMs < seedServerMsRef.current) continue; // landed before we watched
      if (age > FRESH_MS) continue; // stale row
      events.push({
        kind: 'decide',
        userId: val.dk.split(':')[1],
        userName: val.userName,
        code: val.code,
        decision: val.decision,
        dk: val.dk,
      });
    }

    // Disappeared keys: a real reopen (row still present) toasts; a whole row
    // vanishing (final Submit or 30-min stale-out) does not — we can't tell
    // those apart, and a false "submitted" is worse than silence.
    for (const [key, prev] of prevByKey.current) {
      if (newMap.has(key)) continue;
      const age = ageByDraft.get(prev.dk);
      if (age === undefined || age > FRESH_MS) continue;
      events.push({
        kind: 'reopen',
        userId: prev.dk.split(':')[1],
        userName: prev.userName,
        code: prev.code,
        dk: prev.dk,
      });
    }

    // Overwrite the baseline AFTER computing removals (else we'd lose them).
    prevByKey.current = newMap;

    if (events.length === 0) return;

    const nextId = () => (toastIdRef.current += 1);
    const fresh: LiveToast[] = [];

    if (events.length > GLOBAL_CAP) {
      const users = new Set(events.map((e) => e.userId)).size;
      fresh.push({
        id: nextId(),
        variant: 'info',
        message: `${events.length} new decisions across ${users} ${users === 1 ? 'coder' : 'coders'}`,
        draftKey: null,
      });
    } else {
      const byUser = new Map<string, DiffEvent[]>();
      for (const e of events) {
        const arr = byUser.get(e.userId);
        if (arr) arr.push(e);
        else byUser.set(e.userId, [e]);
      }
      for (const evs of byUser.values()) {
        if (evs.length > COALESCE) {
          fresh.push({
            id: nextId(),
            variant: 'info',
            message: `${evs[0].userName} decided ${evs.length} codes`,
            draftKey: evs[0].dk,
          });
        } else {
          for (const e of evs) {
            fresh.push(
              e.kind === 'reopen'
                ? { id: nextId(), variant: 'info', message: `${e.userName} reopened ${e.code}`, draftKey: e.dk }
                : {
                    id: nextId(),
                    variant: DECISION_VARIANT[e.decision!],
                    message: `${e.userName} ${DECISION_VERB[e.decision!]} ${e.code}`,
                    draftKey: e.dk,
                  },
            );
          }
        }
      }
    }

    setToasts((prev) => [...prev, ...fresh].slice(-STACK_CAP));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on
    // dataUpdatedAt so each fetch is processed once; q.data is consistent with it.
  }, [q.dataUpdatedAt]);

  const dismissToast = (id: number) => setToasts((p) => p.filter((t) => t.id !== id));

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
        <p className="text-[11px] text-ink-subtle">Decisions stream in as coders work · auto-refreshing</p>
      </div>

      {q.isPending ? (
        <p className="py-10 text-center text-sm text-ink-muted">Loading live activity…</p>
      ) : q.isError ? (
        <p className="py-10 text-center text-sm text-danger">Failed to load live activity.</p>
      ) : drafts.length === 0 ? (
        <div className="py-16 text-center">
          <Radio className="w-7 h-7 text-ink-subtle mx-auto mb-2" />
          <p className="text-sm font-semibold text-ink">No one is coding right now</p>
          <p className="text-[11px] text-ink-muted mt-1">
            Charts appear here the moment a coder or auditor makes a decision. New decisions pop as
            notifications.
          </p>
        </div>
      ) : (
        <LiveCardList drafts={drafts} now={now} skewMs={skewMsRef.current} onOpen={openChart} />
      )}

      <LiveToastStack toasts={toasts} onDismiss={dismissToast} onSeeMore={openFromKey} />
    </div>
  );
}
