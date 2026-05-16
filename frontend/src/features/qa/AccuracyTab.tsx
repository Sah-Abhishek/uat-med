import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, BarChart3, CheckCircle2, Clock, FileStack, Loader2, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { getQaAccuracy, type CodeReviewType, type QaFilters } from '@/api/qa';
import { cn } from '@/lib/utils';

interface Props {
  filters: QaFilters;
}

const CODE_TYPE_LABEL: Record<CodeReviewType, string> = {
  PRIMARY: 'Primary Dx',
  SECONDARY: 'Secondary Dx',
  PROCEDURE: 'CPT / Procedure',
  EM_LEVEL: 'ED/EM Level',
  MODIFIER: 'Modifier',
};

// Verdict color tokens — match the modal + table chips for consistency.
const COLOR_ACCEPT  = '#10B981'; // success
const COLOR_EDIT    = '#3B82F6'; // info
const COLOR_REJECT  = '#EF4444'; // danger
const COLOR_PRIMARY = '#1E40AF';
const COLOR_AXIS    = '#94A3B8';
const COLOR_GRID    = '#E2E8F0';

export function AccuracyTab({ filters }: Props) {
  const q = useQuery({
    queryKey: ['qa', 'accuracy', filters],
    queryFn: () => getQaAccuracy(filters),
    placeholderData: (prev) => prev,
  });

  const data = q.data;
  // Treat any "no data in hand yet" state as loading — covers initial load,
  // refetch with no placeholder, AND the post-error state where isPending
  // has flipped false but data is still undefined. Without this guard the
  // KPI tiles below crash on `data!.kpis…`.
  const loading = !data;

  if (q.isError && !data) {
    const msg = (q.error as any)?.response?.data?.error?.message
      ?? (q.error as any)?.message
      ?? 'Failed to load AI accuracy metrics.';
    return (
      <div className="rounded-xl border border-danger/30 bg-danger-soft/30 px-4 py-3 text-sm text-danger">
        {msg}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          label="Total decisions"
          value={loading ? '…' : data.kpis.totalDecisions.toLocaleString()}
          icon={<BarChart3 className="w-4 h-4" />}
          tone="primary"
        />
        <KpiTile
          label="Acceptance"
          value={loading ? '…' : `${(data.kpis.acceptanceRate * 100).toFixed(1)}%`}
          sublabel={loading ? undefined : `${data.kpis.acceptedCount.toLocaleString()} of ${data.kpis.totalDecisions.toLocaleString()}`}
          icon={<CheckCircle2 className="w-4 h-4" />}
          tone="success"
        />
        <KpiTile
          label="Charts submitted"
          value={loading ? '…' : data.kpis.distinctCharts.toLocaleString()}
          icon={<FileStack className="w-4 h-4" />}
          tone="info"
        />
        <KpiTile
          label="Median time / chart"
          value={loading ? '…' : formatDuration(data.kpis.medianTimePerChartMs)}
          icon={<Clock className="w-4 h-4" />}
          tone="warn"
        />
      </div>

      {/* Charts: 2x2 grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartCard
          title="Accept · Edit · Reject by code type"
          subtitle="How the AI's suggestions land per code category"
          icon={<BarChart3 className="w-3.5 h-3.5" />}
          loading={loading}
          empty={!loading && (data?.perCodeType.length ?? 0) === 0}
        >
          <PerCodeTypeChart rows={data?.perCodeType ?? []} />
        </ChartCard>

        <ChartCard
          title="Top rejection reasons"
          subtitle="Where the model is weakest — based on selected dropdown reasons"
          icon={<Activity className="w-3.5 h-3.5" />}
          loading={loading}
          empty={!loading && (data?.topRejectReasons.length ?? 0) === 0}
        >
          <TopRejectChart rows={data?.topRejectReasons ?? []} />
        </ChartCard>

        <ChartCard
          title="Weekly verdict trend"
          subtitle="Accept / Edit / Reject counts by ISO week"
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          loading={loading}
          empty={!loading && (data?.weekly.length ?? 0) === 0}
        >
          <WeeklyTrendChart rows={data?.weekly ?? []} />
        </ChartCard>

        <ChartCard
          title="Submissions per day"
          subtitle="Unique charts that received a decision each day"
          icon={<BarChart3 className="w-3.5 h-3.5" />}
          loading={loading}
          empty={!loading && (data?.daily.length ?? 0) === 0}
        >
          <DailyVolumeChart rows={data?.daily ?? []} />
        </ChartCard>
      </div>
    </div>
  );
}

/* ── KPI tile ─────────────────────────────────────────────── */

const TONE_RING: Record<'primary' | 'success' | 'info' | 'warn', string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  info:    'bg-info/10 text-info',
  warn:    'bg-warn/10 text-warn',
};

function KpiTile({
  label, value, sublabel, icon, tone,
}: {
  label: string;
  value: string;
  sublabel?: string;
  icon: React.ReactNode;
  tone: 'primary' | 'success' | 'info' | 'warn';
}) {
  return (
    <Card padding="default">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted">{label}</p>
          <p className="mt-1 text-2xl font-bold text-ink tabular-nums">{value}</p>
          {sublabel && <p className="text-[11px] text-ink-muted mt-1">{sublabel}</p>}
        </div>
        <div className={cn('shrink-0 w-8 h-8 rounded-lg flex items-center justify-center', TONE_RING[tone])}>
          {icon}
        </div>
      </div>
    </Card>
  );
}

/* ── Chart card wrapper ──────────────────────────────────── */

function ChartCard({
  title, subtitle, icon, loading, empty, children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card padding="default">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="text-sm font-bold text-ink inline-flex items-center gap-1.5">
            {icon && <span className="text-ink-muted">{icon}</span>}
            {title}
          </h4>
          {subtitle && <p className="text-[11px] text-ink-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="h-[280px] w-full">
        {loading ? (
          <div className="h-full flex items-center justify-center text-ink-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : empty ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-ink-muted">
            <p className="text-sm font-semibold text-ink">No data in scope</p>
            <p className="text-[11px] mt-1">Adjust filters or expand the date range.</p>
          </div>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

/* ── Chart 1: per code type stacked bar ──────────────────── */

function PerCodeTypeChart({ rows }: { rows: { codeType: CodeReviewType; accepted: number; edited: number; rejected: number; total: number }[] }) {
  // Convert to percentage shares so comparing across code types with very
  // different volumes still reads correctly. Tooltip surfaces raw counts.
  const data = rows.map((r) => {
    const total = r.total || 1;
    return {
      label: CODE_TYPE_LABEL[r.codeType] ?? r.codeType,
      accepted: r.accepted,
      edited: r.edited,
      rejected: r.rejected,
      total: r.total,
      acceptedPct: (r.accepted / total) * 100,
      editedPct: (r.edited / total) * 100,
      rejectedPct: (r.rejected / total) * 100,
    };
  });

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 24, bottom: 5, left: 8 }}>
        <CartesianGrid horizontal={false} stroke={COLOR_GRID} strokeDasharray="3 3" />
        <XAxis
          type="number"
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          stroke={COLOR_AXIS}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          type="category"
          dataKey="label"
          stroke={COLOR_AXIS}
          tick={{ fontSize: 11 }}
          width={110}
        />
        <Tooltip
          cursor={{ fill: 'rgba(148,163,184,0.08)' }}
          contentStyle={tooltipStyle}
          formatter={(v: number, name: string, ctx: any) => {
            const k = ctx?.dataKey as string;
            const raw =
              k === 'acceptedPct' ? ctx.payload.accepted :
              k === 'editedPct' ? ctx.payload.edited :
              k === 'rejectedPct' ? ctx.payload.rejected :
              v;
            const lbl =
              k === 'acceptedPct' ? 'Accepted' :
              k === 'editedPct' ? 'Edited' :
              k === 'rejectedPct' ? 'Rejected' :
              name;
            return [`${raw} (${(v as number).toFixed(1)}%)`, lbl];
          }}
        />
        <Legend wrapperStyle={legendStyle} />
        <Bar dataKey="acceptedPct" stackId="v" name="Accepted" fill={COLOR_ACCEPT} radius={[4, 0, 0, 4]} />
        <Bar dataKey="editedPct"   stackId="v" name="Edited"   fill={COLOR_EDIT} />
        <Bar dataKey="rejectedPct" stackId="v" name="Rejected" fill={COLOR_REJECT} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Chart 2: top reject reasons ─────────────────────────── */

function TopRejectChart({ rows }: { rows: { reason: string; count: number }[] }) {
  const max = rows[0]?.count ?? 1;
  // Truncate very long labels to keep YAxis readable; full string in tooltip.
  const data = rows.map((r) => ({
    label: r.reason.length > 36 ? `${r.reason.slice(0, 35)}…` : r.reason,
    fullLabel: r.reason,
    count: r.count,
    intensity: r.count / max,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 32, bottom: 5, left: 8 }}>
        <CartesianGrid horizontal={false} stroke={COLOR_GRID} strokeDasharray="3 3" />
        <XAxis type="number" stroke={COLOR_AXIS} tick={{ fontSize: 11 }} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          stroke={COLOR_AXIS}
          tick={{ fontSize: 11 }}
          width={220}
        />
        <Tooltip
          cursor={{ fill: 'rgba(239,68,68,0.06)' }}
          contentStyle={tooltipStyle}
          labelFormatter={(_, p) => p?.[0]?.payload?.fullLabel ?? ''}
          formatter={(v: number) => [`${v} rejection${v === 1 ? '' : 's'}`, '']}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={`rgba(239,68,68,${0.45 + d.intensity * 0.55})`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Chart 3: weekly trend ───────────────────────────────── */

function WeeklyTrendChart({ rows }: { rows: { week: string; accepted: number; edited: number; rejected: number; total: number }[] }) {
  const data = rows.map((r) => ({
    week: shortDate(r.week),
    Accepted: r.accepted,
    Edited: r.edited,
    Rejected: r.rejected,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
        <CartesianGrid stroke={COLOR_GRID} strokeDasharray="3 3" />
        <XAxis dataKey="week" stroke={COLOR_AXIS} tick={{ fontSize: 11 }} />
        <YAxis stroke={COLOR_AXIS} tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={legendStyle} />
        {/* Distinct stroke styles so series remain distinguishable for color-blind viewers. */}
        <Line type="monotone" dataKey="Accepted" stroke={COLOR_ACCEPT} strokeWidth={2} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="Edited"   stroke={COLOR_EDIT}   strokeWidth={2} strokeDasharray="6 3" dot={{ r: 3 }} />
        <Line type="monotone" dataKey="Rejected" stroke={COLOR_REJECT} strokeWidth={2} strokeDasharray="2 3" dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ── Chart 4: daily volume ───────────────────────────────── */

function DailyVolumeChart({ rows }: { rows: { day: string; submissions: number }[] }) {
  const data = rows.map((r) => ({
    day: shortDate(r.day),
    Submissions: r.submissions,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
        <CartesianGrid stroke={COLOR_GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" stroke={COLOR_AXIS} tick={{ fontSize: 11 }} />
        <YAxis stroke={COLOR_AXIS} tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip cursor={{ fill: 'rgba(30,64,175,0.06)' }} contentStyle={tooltipStyle} />
        <Bar dataKey="Submissions" fill={COLOR_PRIMARY} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Shared bits ─────────────────────────────────────────── */

const tooltipStyle: React.CSSProperties = {
  fontSize: 12,
  borderRadius: 8,
  border: '1px solid rgba(148,163,184,0.3)',
  background: 'rgb(var(--surface-rgb, 255 255 255) / 0.98)',
  boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
  padding: '8px 10px',
};
const legendStyle: React.CSSProperties = { fontSize: 11, paddingTop: 4 };

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}
