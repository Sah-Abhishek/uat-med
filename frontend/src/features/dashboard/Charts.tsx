import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Loader2 } from 'lucide-react';

/**
 * Shared recharts color palette. Tones loosely match the Tailwind theme tokens
 * (primary / info / warn / success / danger / muted) so the charts blend with
 * the rest of the UI without us reaching into CSS variables at runtime.
 */
export const CHART_COLORS = {
  primary: '#5B6CFF',
  info: '#3B82F6',
  warn: '#F59E0B',
  success: '#10B981',
  danger: '#EF4444',
  muted: '#94A3B8',
  teal: '#14B8A6',
  indigo: '#6366F1',
};

export const DONUT_PALETTE = [
  CHART_COLORS.primary,
  CHART_COLORS.info,
  CHART_COLORS.warn,
  CHART_COLORS.success,
  CHART_COLORS.danger,
  CHART_COLORS.teal,
  CHART_COLORS.indigo,
  CHART_COLORS.muted,
];

/* ── Container ──────────────────────────────────────────── */

export function ChartCard({
  title,
  subtitle,
  children,
  loading,
  empty,
  height = 260,
  rightSlot,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  loading?: boolean;
  empty?: boolean;
  height?: number;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="text-sm font-semibold text-ink">{title}</h4>
          {subtitle && <p className="text-[11px] text-ink-muted mt-0.5">{subtitle}</p>}
        </div>
        {rightSlot}
      </div>
      <div style={{ height }} className="relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />
          </div>
        ) : empty ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-ink-muted">
            No data in the selected range.
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/* ── Tooltip ────────────────────────────────────────────── */

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 shadow-card text-xs">
      <p className="font-semibold text-ink mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color ?? p.payload?.fill }} />
          <span className="text-ink-muted">{p.name}:</span>
          <span className="font-semibold text-ink">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Horizontal bar chart ───────────────────────────────── */

export function HorizontalBar({
  data,
  xKey,
  yKey,
  color = CHART_COLORS.primary,
}: {
  // Permissive shape — recharts itself accepts any[] for `data` and validates
  // via the `dataKey` prop at render time. Keeping this loose lets typed
  // domain objects (DateCount, milestone rows, etc.) flow in without ceremony.
  data: any[];
  xKey: string;
  yKey: string;
  color?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
        <YAxis type="category" dataKey={yKey} tick={{ fontSize: 11 }} width={140} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
        <Bar dataKey={xKey} fill={color} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Vertical bar chart ────────────────────────────────── */

export function VerticalBar({
  data,
  xKey,
  yKey,
  color = CHART_COLORS.primary,
}: {
  // Permissive shape — recharts itself accepts any[] for `data` and validates
  // via the `dataKey` prop at render time. Keeping this loose lets typed
  // domain objects (DateCount, milestone rows, etc.) flow in without ceremony.
  data: any[];
  xKey: string;
  yKey: string;
  color?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
        <Bar dataKey={yKey} fill={color} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Line / area chart for daily series ────────────────── */

export function DailyAreaChart({
  data,
  xKey = 'date',
  yKey = 'count',
  color = CHART_COLORS.primary,
}: {
  // Permissive shape — recharts itself accepts any[] for `data` and validates
  // via the `dataKey` prop at render time. Keeping this loose lets typed
  // domain objects (DateCount, milestone rows, etc.) flow in without ceremony.
  data: any[];
  xKey?: string;
  yKey?: string;
  color?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
        <defs>
          <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 10 }}
          tickFormatter={shortDate}
          interval="preserveStartEnd"
        />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey={yKey}
          stroke={color}
          strokeWidth={2}
          fill={`url(#grad-${color.replace('#', '')})`}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DailyLineChart({
  data,
  xKey = 'date',
  yKey = 'value',
  color = CHART_COLORS.warn,
}: {
  // Permissive shape — recharts itself accepts any[] for `data` and validates
  // via the `dataKey` prop at render time. Keeping this loose lets typed
  // domain objects (DateCount, milestone rows, etc.) flow in without ceremony.
  data: any[];
  xKey?: string;
  yKey?: string;
  color?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 10 }} tickFormatter={shortDate} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip content={<CustomTooltip />} />
        <Line type="monotone" dataKey={yKey} stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ── Donut chart ────────────────────────────────────────── */

export function DonutChart({
  data,
}: {
  data: Array<{ name: string; value: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="55%"
          outerRadius="85%"
          paddingAngle={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={DONUT_PALETTE[i % DONUT_PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/* ── Helpers ───────────────────────────────────────────── */

/** Renders 'Mar 5' from 'YYYY-MM-DD'. Stable, locale-agnostic short label. */
function shortDate(iso: string): string {
  if (!iso || typeof iso !== 'string') return String(iso ?? '');
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
