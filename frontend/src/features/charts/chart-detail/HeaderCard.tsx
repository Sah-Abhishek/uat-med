import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Cog,
  Hospital,
  MapPin,
  User,
  Clipboard,
  Search,
  Play,
  Square,
  AlertCircle,
  Lock,
  UserPlus,
  Sparkles,
  Copy,
  Check,
} from 'lucide-react';
import type { ApiErrorShape, Chart } from '@/api/types';
import { startChart, stopChart, getActiveTimer, selfAllocateCharts } from '@/api/charts';
import { getWorklist } from '@/api/worklists';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/auth/store';
import { formatDate } from '@/lib/utils';
import { MetaItem, PriorityBadge } from './shared';

function formatTime(s: number) {
  const hh = Math.floor(s / 3600).toString().padStart(2, '0');
  const mm = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
  const ss = Math.floor(s % 60).toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

interface HeaderCardProps {
  chart: Chart;
  /** When false, the Stop button is gated until the user saves. Defaults to true. */
  canStop?: boolean;
  /** QA read-only view (?qa=1). Renders the timer panel non-interactive — the
   * page's QA banner is where a viewer self-allocates to take the chart over,
   * so we suppress the timer's own (QA-unaware) self-allocate prompt here. */
  qaReadOnly?: boolean;
}

export function HeaderCard({ chart, canStop = true, qaReadOnly = false }: HeaderCardProps) {
  // Cache shared with useFieldConfig — same query key, dedupes the network call.
  const { data: worklist } = useQuery({
    queryKey: ['worklist', chart.worklistId],
    queryFn: () => getWorklist(chart.worklistId),
    enabled: !!chart.worklistId,
    staleTime: 60_000,
  });

  // The AI-pipeline encounter ID lives in customFields.aiPrediction (set when a
  // prediction runs); there's no column for it. Present only after the chart has
  // been through the ICD Predictor, so we render the chip only when it exists.
  const cf = chart.customFields as { aiPrediction?: { encounterId?: unknown } } | undefined;
  const encounterId =
    typeof cf?.aiPrediction?.encounterId === 'string' && cf.aiPrediction.encounterId.trim()
      ? cf.aiPrediction.encounterId
      : null;

  return (
    <div className="card p-6 grid grid-cols-[1fr_auto] gap-6">
      <div>
        <div className="flex items-center gap-4 mb-3">
          <h2 className="text-xl font-bold text-ink">
            Chart: <span className="font-mono">{chart.chartNo ?? '—'}</span>
          </h2>
          <span className="text-[13px] text-ink-muted">Priority</span>
          <PriorityBadge priority={chart.priority} />
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-5">
          <MetaItem icon={<Building2 className="w-3.5 h-3.5" />}>
            Client: {worklist?.client?.name ?? '—'}
          </MetaItem>
          <MetaItem icon={<Cog className="w-3.5 h-3.5" />}>
            Process: {worklist?.process?.name ?? '—'}
          </MetaItem>
          <MetaItem icon={<Hospital className="w-3.5 h-3.5" />}>
            Primary Specialty: {worklist?.primarySpeciality?.name ?? '—'}
          </MetaItem>
          <MetaItem icon={<MapPin className="w-3.5 h-3.5" />}>
            Location: {worklist?.location?.name ?? '—'}
          </MetaItem>
          <MetaItem icon={<User className="w-3.5 h-3.5" />}>
            Allocated: {chart.allocatedCoderName ?? chart.allocatedAuditorName ?? '—'}
          </MetaItem>
          <MetaItem icon={<Clipboard className="w-3.5 h-3.5" />}>
            Sub Specialty: {worklist?.subSpeciality?.name ?? chart.subSpecialityName ?? '—'}
          </MetaItem>
          <MetaItem icon={<Search className="w-3.5 h-3.5" />}>
            QC Status: {chart.qcStatus ?? '—'}
          </MetaItem>
          {encounterId && <EncounterId encounterId={encounterId} />}
        </div>

        <div className="grid grid-cols-4 gap-0 border-t border-line pt-4 mb-3">
          <Stat label="Worklist #" value={worklist?.worklistNumber ?? chart.worklistNumber} />
          <Stat label="Milestone" value={chart.milestone} />
          <Stat label="Status" value={chart.chartStatus} />
          <Stat label="Audited week" value="—" />
        </div>

        <div className="grid grid-cols-4 gap-0 mb-3">
          <Stat label="S. No." value={String(chart.serialNo)} />
          <Stat label="Date of Service" value={formatDate(chart.dateOfService) || '—'} />
          <Stat label="Received date" value={formatDate(worklist?.receivedDate) || '—'} />
          <Stat label="Completion date" value="—" />
        </div>

        <div className="grid grid-cols-4 gap-0">
          <Stat label="Date of Coder Allocation" value={formatDate(chart.coderAllocatedAt) || '—'} />
          <Stat label="Date of Auditor Allocation" value={formatDate(chart.auditorAllocatedAt) || '—'} />
        </div>
      </div>

      <TimerPanel chart={chart} canStop={canStop} qaReadOnly={qaReadOnly} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-[13px] font-semibold text-ink truncate">{value || '—'}</div>
      <div className="text-[11px] text-ink-subtle">{label}</div>
    </div>
  );
}

/** AI-pipeline encounter ID shown as a monospace chip with click-to-copy — the
 * value is a long UUID support staff cross-reference against the gateway, so
 * copying it verbatim matters more than reading it. */
function EncounterId({ encounterId }: { encounterId: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(encounterId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (insecure context / denied) — leave the value visible */
    }
  };

  return (
    <MetaItem icon={<Sparkles className="w-3.5 h-3.5" />}>
      <span className="inline-flex items-center gap-1.5">
        Encounter ID:
        <button
          type="button"
          onClick={copy}
          title={copied ? 'Copied' : `${encounterId} — click to copy`}
          className="inline-flex items-center gap-1 font-mono text-[11.5px] text-ink hover:text-primary transition max-w-[220px]"
        >
          <span className="truncate">{encounterId}</span>
          {copied ? (
            <Check className="w-3 h-3 text-success shrink-0" />
          ) : (
            <Copy className="w-3 h-3 text-ink-subtle shrink-0" />
          )}
        </button>
      </span>
    </MetaItem>
  );
}

function TimerPanel({ chart, canStop, qaReadOnly }: { chart: Chart; canStop: boolean; qaReadOnly: boolean }) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [conflict, setConflict] = useState<{
    chartId: string;
    chartNo: string | null;
  } | null>(null);
  const [stopBlocked, setStopBlocked] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const running = startedAt != null;

  // You can only use the timer on a chart that's allocated to you (as coder or
  // auditor). Admins/teamleads aren't exempt — they self-allocate it first.
  const allocatedToMe =
    !!user &&
    (String(chart.allocatedCoderId ?? '') === user.id ||
      String(chart.allocatedAuditorId ?? '') === user.id);

  // Clear the "save first" warning as soon as the user saves (canStop flips back to true).
  useEffect(() => {
    if (canStop) setStopBlocked(false);
  }, [canStop]);

  function attemptStop() {
    if (!canStop) {
      setStopBlocked(true);
      return;
    }
    stopMut.mutate();
  }

  // Restore the running timer on mount: a refresh shouldn't appear to reset it.
  // Also tells us if the active chart is a *different* chart, so we can lock UI
  // and surface a banner without the user having to click Start.
  const active = useQuery({
    queryKey: ['active-timer'],
    queryFn: getActiveTimer,
    enabled: user?.role === 'CODER' || user?.role === 'AUDITOR' || user?.role === 'TEAMLEAD' || user?.role === 'MANAGER',
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!active.data) return;
    if (active.data.chartId === chart.id) {
      // Same chart — restore from server's start time. Also seed `elapsed`
      // immediately so the first paint after this effect shows the real
      // time (not 00:00:00 for ~1s until the interval ticks).
      const startedAtMs = Date.parse(active.data.startedAt);
      setStartedAt(startedAtMs);
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
      setStoppedAt(null);
      setConflict(null);
    } else {
      // Different chart is currently active — lock this one until the user
      // navigates back and stops it.
      setStartedAt(null);
      setConflict({ chartId: active.data.chartId, chartNo: active.data.chartNo });
    }
  }, [active.data, chart.id]);

  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt!) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [running, startedAt]);

  // Invalidate every cache that depends on the milestone — the chart itself,
  // the charts list (so the row shows the new milestone), the chart-summary tiles,
  // and the active-timer queries.
  function invalidateAfterTimerChange() {
    qc.invalidateQueries({ queryKey: ['chart', chart.id] });
    qc.invalidateQueries({ queryKey: ['charts'] });
    qc.invalidateQueries({ queryKey: ['active-timer'] });
    // Time Tracker reflects the new/closed session immediately on start/stop.
    qc.invalidateQueries({ queryKey: ['chart-time', chart.id] });
  }

  const startMut = useMutation({
    mutationFn: () => startChart(chart.id),
    onSuccess: (res) => {
      setStartedAt(Date.parse(res.startedAt));
      setStoppedAt(null);
      setElapsed(0);
      setConflict(null);
      setErrorMsg(null);
      invalidateAfterTimerChange();
    },
    onError: (err) => {
      const e = err as unknown as ApiErrorShape;
      if (e.status === 409 && e.code === 'timer_conflict') {
        const meta = e.meta ?? {};
        setConflict({
          chartId: String(meta.activeChartId ?? ''),
          chartNo: (meta.activeChartNo as string | null) ?? null,
        });
      } else if (e.code === 'chart_busy' || e.code === 'not_allocated') {
        // Someone else is timing this chart, or it isn't allocated to us.
        setErrorMsg(e.message);
      }
    },
  });
  const stopMut = useMutation({
    mutationFn: () => stopChart(chart.id),
    onSuccess: () => {
      setStoppedAt(Date.now());
      setStartedAt(null);
      invalidateAfterTimerChange();
    },
  });

  // Self-allocate this chart from the detail page, so the user can start the
  // timer without going back to the Charts list. Blocked server-side when
  // someone else is actively working on it.
  const selfAllocateMut = useMutation({
    mutationFn: () => selfAllocateCharts([Number(chart.id)]),
    onSuccess: (res) => {
      if (res.allocated > 0) {
        setErrorMsg(null);
        invalidateAfterTimerChange(); // refetch chart → allocatedToMe flips true
      } else {
        setErrorMsg(res.skipped?.[0]?.reason ?? 'Could not allocate this chart.');
      }
    },
  });

  const canTime = user?.role === 'CODER' || user?.role === 'AUDITOR' || user?.role === 'TEAMLEAD' || user?.role === 'MANAGER';

  const startStr = startedAt
    ? new Date(startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';
  const stopStr = stoppedAt
    ? new Date(stoppedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  // While `getActiveTimer` is in flight, or the query has resolved with a
  // running timer for this chart but our local `startedAt` hasn't been
  // synced yet, render a placeholder so we don't flash 00:00:00 at the user.
  const restoringTimer =
    !!active.data && active.data.chartId === chart.id && !running;
  const isResolving = canTime && (active.isPending || restoringTimer);

  // QA read-only view: the timer isn't usable here (you're reviewing someone
  // else's submitted work). Render a non-interactive readout and point at the
  // page's QA banner, which is where a viewer self-allocates to take over.
  if (qaReadOnly) {
    return (
      <div className="rounded-card border border-line bg-gradient-to-br from-primary-soft/40 to-warn-soft/40 p-5 min-w-[260px]">
        <p className="text-[11px] uppercase tracking-[0.1em] text-ink-muted font-semibold mb-2">
          Timer
        </p>
        <p className="text-3xl font-bold font-mono tabular-nums text-ink-subtle mb-1">
          {formatTime(Math.floor((chart.coderTimeMs ?? 0) / 1000))}
        </p>
        <p className="text-[11px] text-ink-subtle leading-snug">
          Read-only QA view — self-allocate this chart to work on it.
        </p>
      </div>
    );
  }

  // Not allocated to this user → no timer. Show a self-allocate prompt instead
  // (this is what an admin sees when opening a chart they haven't taken).
  if (canTime && !allocatedToMe) {
    return (
      <div className="rounded-card border border-line bg-gradient-to-br from-primary-soft/40 to-warn-soft/40 p-5 min-w-[260px]">
        <p className="text-[11px] uppercase tracking-[0.1em] text-ink-muted font-semibold mb-3">
          Timer
        </p>
        <div className="flex items-start gap-2 mb-3">
          <Lock className="w-4 h-4 text-ink-subtle mt-0.5 shrink-0" />
          <p className="text-[12px] text-ink-muted leading-snug">
            Self-allocate this chart to yourself to work on it.
          </p>
        </div>
        <Button
          size="sm"
          leftIcon={<UserPlus className="w-3.5 h-3.5" />}
          loading={selfAllocateMut.isPending}
          onClick={() => selfAllocateMut.mutate()}
          className="w-full"
        >
          Self-allocate
        </Button>
        {errorMsg && (
          <div className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2">
            <p className="text-[11px] text-danger leading-snug">{errorMsg}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-gradient-to-br from-primary-soft/40 to-warn-soft/40 p-5 min-w-[260px]">
      <p className="text-[11px] uppercase tracking-[0.1em] text-ink-muted font-semibold mb-2">
        Timer
      </p>
      {isResolving ? (
        <div className="mb-4">
          <p className="text-3xl font-bold font-mono tabular-nums text-ink-subtle">
            ··:··:··
          </p>
          <p className="text-[11px] text-ink-subtle mt-0.5">Checking timer…</p>
        </div>
      ) : (
        <p className="text-3xl font-bold font-mono tabular-nums text-ink mb-4">
          {formatTime(elapsed)}
        </p>
      )}
      {stopBlocked && (
        <div className="mb-3 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-warn mt-0.5 shrink-0" />
            <p className="text-[11px] text-warn leading-snug font-semibold">
              Save the chart before stopping the timer.
            </p>
          </div>
        </div>
      )}
      {conflict && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-danger mt-0.5 shrink-0" />
            <div className="text-[11px] text-danger leading-snug">
              <p className="font-semibold mb-1">Another chart is already in progress.</p>
              <p>Save it before working on this chart.</p>
              {conflict.chartId && (
                <Link
                  to={`/charts/${conflict.chartId}`}
                  className="inline-block mt-1.5 font-semibold underline"
                >
                  Go to {conflict.chartNo ? `#${conflict.chartNo}` : 'active chart'}
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
      {errorMsg && !conflict && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-danger mt-0.5 shrink-0" />
            <p className="text-[11px] text-danger leading-snug font-semibold">{errorMsg}</p>
          </div>
        </div>
      )}
      {canTime && (
        <div className="flex gap-2 mb-4">
          <Button
            size="sm"
            leftIcon={<Play className="w-3.5 h-3.5" />}
            disabled={running || !!conflict || isResolving}
            loading={startMut.isPending}
            onClick={() => startMut.mutate()}
            className="flex-1"
          >
            Start
          </Button>
          <Button
            size="sm"
            variant="danger"
            leftIcon={<Square className="w-3.5 h-3.5" />}
            disabled={!running}
            loading={stopMut.isPending}
            onClick={attemptStop}
            className="flex-1"
          >
            Stop
          </Button>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-line">
        <MiniStat label="Start" value={startStr} />
        <MiniStat label="Stop" value={stopStr} />
        {/* Total = all durable logged sessions on this chart + the live one. */}
        <MiniStat
          label="Total"
          value={formatTime(Math.floor((chart.coderTimeMs ?? 0) / 1000) + (running ? elapsed : 0))}
        />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-[11px] font-semibold text-ink truncate">{value}</p>
      <p className="text-[10px] text-ink-subtle">{label}</p>
    </div>
  );
}
