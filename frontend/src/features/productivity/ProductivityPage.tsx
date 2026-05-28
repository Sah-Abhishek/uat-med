import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, CalendarRange, Gauge, Loader2, Sparkles, UserPlus, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FancySelect } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Primitives';
import {
  listClients,
  listLocations,
  listPrimarySpecialities,
} from '@/api/configurations';
import { listQaFacilities } from '@/api/qa';
import {
  getAiProcessingStatus,
  getAiProcessingStatusSeries,
  getThroughput,
  getThroughputCharts,
  type ThroughputFilters,
} from '@/api/dashboard';
import { cn, formatDate } from '@/lib/utils';
import { UserProductivitySection } from './UserProductivitySection';

/* Allocated = indigo, Worked = green. Kept distinct so the comparison reads clearly. */
const COLOR_ALLOCATED = '#6366F1';
const COLOR_WORKED = '#10B981';
const COLOR_AXIS = '#94A3B8';
const COLOR_GRID = '#E2E8F0';

const WINDOW_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '60', label: 'Last 60 days' },
  { value: '90', label: 'Last 90 days' },
];

export function ProductivityPage() {
  const [filters, setFilters] = useState<ThroughputFilters>({ days: 30 });
  const patch = (p: Partial<ThroughputFilters>) => setFilters((f) => ({ ...f, ...p }));
  const reset = () => setFilters({ days: 30 });

  const q = useQuery({
    queryKey: ['dashboard', 'throughput', filters],
    queryFn: () => getThroughput(filters),
    placeholderData: (prev) => prev,
  });
  const data = q.data;
  const loading = !data;

  const avg = (rows?: Array<{ count: number }>) =>
    rows && rows.length ? Math.round(rows.reduce((s, r) => s + r.count, 0) / rows.length) : 0;

  // Merge the two series by date for the comparison chart.
  const combined = (data?.allocatedPerDay ?? []).map((a, i) => ({
    date: shortDate(a.date),
    Allocated: a.count,
    'Worked on': data?.workedPerDay[i]?.count ?? 0,
  }));

  return (
    <div className="p-8 max-w-[1600px] space-y-5">
      <PageHeader
        title="Productivity"
        subtitle="Charts allocated and worked on — today and day by day"
      />

      <FilterBar filters={filters} onChange={patch} onReset={reset} />

      {q.isError && !data ? (
        <div className="rounded-xl border border-danger/30 bg-danger-soft/30 px-4 py-3 text-sm text-danger">
          {(q.error as any)?.response?.data?.error?.message ??
            (q.error as any)?.message ??
            'Failed to load productivity metrics.'}
        </div>
      ) : (
        <>
          {/* ── KPI tiles ─────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile
              label="Allocated today"
              value={loading ? '…' : data.allocatedToday.toLocaleString()}
              icon={<UserPlus className="w-4 h-4" />}
              tone="indigo"
            />
            <KpiTile
              label="Worked on today"
              value={loading ? '…' : data.workedToday.toLocaleString()}
              icon={<Activity className="w-4 h-4" />}
              tone="success"
            />
            <KpiTile
              label={`Avg allocated / day`}
              value={loading ? '…' : avg(data.allocatedPerDay).toLocaleString()}
              sublabel={loading ? undefined : `over ${data.days} days`}
              icon={<Gauge className="w-4 h-4" />}
              tone="info"
            />
            <KpiTile
              label={`Avg worked / day`}
              value={loading ? '…' : avg(data.workedPerDay).toLocaleString()}
              sublabel={loading ? undefined : `over ${data.days} days`}
              icon={<Gauge className="w-4 h-4" />}
              tone="warn"
            />
          </div>

          {/* ── Per-day bars ──────────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard
              title="Charts allocated per day"
              subtitle="Distinct charts assigned to a coder or auditor each day"
              icon={<UserPlus className="w-3.5 h-3.5" />}
              loading={loading}
              empty={!loading && noData(data?.allocatedPerDay)}
            >
              <PerDayBars rows={data?.allocatedPerDay ?? []} name="Allocated" color={COLOR_ALLOCATED} gradId="alloc" />
            </ChartCard>

            <ChartCard
              title="Charts worked on per day"
              subtitle="Distinct charts with at least one coding/audit decision each day"
              icon={<Activity className="w-3.5 h-3.5" />}
              loading={loading}
              empty={!loading && noData(data?.workedPerDay)}
            >
              <PerDayBars rows={data?.workedPerDay ?? []} name="Worked on" color={COLOR_WORKED} gradId="worked" />
            </ChartCard>
          </div>

          {/* ── Comparison ────────────────────────────────── */}
          <ChartCard
            title="Allocated vs worked on"
            subtitle="How allocation keeps pace with coding/audit throughput"
            icon={<CalendarRange className="w-3.5 h-3.5" />}
            loading={loading}
            empty={!loading && noData(data?.allocatedPerDay) && noData(data?.workedPerDay)}
          >
            <ComparisonChart rows={combined} />
          </ChartCard>

          {/* ── AI processing status (live) ───────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ProcessingStatusCard filters={filters} />
            <ProcessingStatusTrend filters={filters} />
          </div>

          {/* ── Drill-down table ──────────────────────────── */}
          <ChartsTable filters={filters} />

          {/* ── Per-user productivity ─────────────────────── */}
          <UserProductivitySection />
        </>
      )}
    </div>
  );
}

/* ── Drill-down table: the actual charts behind the metrics ─ */

function ChartsTable({ filters }: { filters: ThroughputFilters }) {
  const [kind, setKind] = useState<'allocated' | 'worked'>('allocated');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Reset to the first page whenever the scope or the tab changes.
  useEffect(() => { setPage(1); }, [filters, kind]);

  const q = useQuery({
    queryKey: ['dashboard', 'throughput', 'charts', { filters, kind, page }],
    queryFn: () => getThroughputCharts({ ...filters, kind, page, pageSize }),
    placeholderData: (prev) => prev,
  });
  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const colSpan = kind === 'allocated' ? 8 : 9;

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-line">
        <div>
          <h4 className="text-sm font-bold text-ink">Charts ({total.toLocaleString()})</h4>
          <p className="text-[11px] text-ink-muted">
            {kind === 'allocated' ? 'Allocated in this window' : 'Worked on in this window'}
          </p>
        </div>
        <div className="inline-flex rounded-pill border border-line bg-surface p-0.5">
          {(['allocated', 'worked'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                'px-3 h-7 rounded-pill text-xs font-semibold transition',
                kind === k ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink',
              )}
            >
              {k === 'allocated' ? 'Allocated' : 'Worked on'}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px]">
          <thead>
            <tr>
              <th className="table-head">Chart #</th>
              <th className="table-head">Worklist</th>
              <th className="table-head">Client</th>
              <th className="table-head">Location</th>
              <th className="table-head">Speciality</th>
              <th className="table-head">Milestone</th>
              <th className="table-head">Assignee</th>
              {kind === 'allocated' ? (
                <th className="table-head">Allocated on</th>
              ) : (
                <>
                  <th className="table-head">Last worked</th>
                  <th className="table-head text-right">Decisions</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {q.isPending && !q.data ? (
              <tr><td colSpan={colSpan} className="py-16 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-ink-muted" /></td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={colSpan} className="py-16 text-center text-sm text-ink-muted">No charts {kind === 'allocated' ? 'allocated' : 'worked on'} in this window.</td></tr>
            ) : (
              items.map((r) => (
                <tr key={r.chartId} className="hover:bg-surface-sunken/40 transition">
                  <td className="table-cell font-bold">
                    <Link to={`/charts/${r.chartId}`} className="text-ink hover:text-primary transition">
                      {r.chartNo ?? `#${r.chartId}`}
                    </Link>
                  </td>
                  <td className="table-cell text-ink-muted font-mono text-xs">{r.worklistNumber ?? '—'}</td>
                  <td className="table-cell">{dash(r.clientName)}</td>
                  <td className="table-cell">{dash(r.locationName)}</td>
                  <td className="table-cell">{dash(r.specialityName)}</td>
                  <td className="table-cell"><MilestonePill milestone={r.milestone} /></td>
                  <td className="table-cell">{dash(r.assigneeName)}</td>
                  {kind === 'allocated' ? (
                    <td className="table-cell text-ink-muted whitespace-nowrap">{r.allocatedAt ? formatDate(r.allocatedAt) : '—'}</td>
                  ) : (
                    <>
                      <td className="table-cell text-ink-muted whitespace-nowrap">{r.lastWorkedAt ? formatDate(r.lastWorkedAt) : '—'}</td>
                      <td className="table-cell text-right tabular-nums">{r.decisions}</td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {items.length > 0 && (
        <Pagination page={page} pageCount={totalPages} onPageChange={setPage} />
      )}
    </Card>
  );
}

function dash(v: React.ReactNode) {
  return v === null || v === undefined || v === '' ? <span className="text-ink-subtle text-xs">—</span> : v;
}

function MilestonePill({ milestone }: { milestone: string }) {
  const label = milestone
    ? milestone.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    : '—';
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-pill text-[10px] font-semibold bg-surface-sunken text-ink-muted border border-line whitespace-nowrap">
      {label}
    </span>
  );
}

function noData(rows?: Array<{ count: number }>) {
  return !rows || rows.every((r) => r.count === 0);
}

/* ── Filter bar ──────────────────────────────────────────── */

function FilterBar({
  filters,
  onChange,
  onReset,
}: {
  filters: ThroughputFilters;
  onChange: (p: Partial<ThroughputFilters>) => void;
  onReset: () => void;
}) {
  const clientsQ = useQuery({ queryKey: ['configurations', 'clients'], queryFn: () => listClients() });
  const locationsQ = useQuery({
    queryKey: ['configurations', 'locations', filters.clientId],
    queryFn: () => listLocations(filters.clientId!),
    enabled: !!filters.clientId,
  });
  const specialitiesQ = useQuery({
    queryKey: ['configurations', 'primary-specialities', filters.clientId],
    queryFn: () => listPrimarySpecialities(filters.clientId),
  });
  const facilitiesQ = useQuery({
    queryKey: ['qa', 'facilities', filters.clientId, filters.locationId],
    queryFn: () => listQaFacilities({ clientId: filters.clientId, locationId: filters.locationId }),
  });
  const facilityOptions = facilitiesQ.data?.items ?? [];

  const hasAny =
    !!filters.clientId || !!filters.locationId || !!filters.specialityId || !!filters.facility;

  return (
    <div className="rounded-xl border border-line bg-surface-sunken/30 p-4">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-2">
          <FancySelect
            value={String(filters.days ?? 30)}
            onChange={(v) => onChange({ days: Number(v) })}
            options={WINDOW_OPTIONS}
            placeholder="Window"
          />
        </div>
        <div className="md:col-span-2">
          <FancySelect
            value={filters.clientId ? String(filters.clientId) : ''}
            onChange={(v) => onChange({ clientId: v ? Number(v) : undefined, locationId: undefined, facility: undefined })}
            options={[
              { value: '', label: 'All clients' },
              ...(clientsQ.data?.items ?? []).map((c) => ({ value: String(c.id), label: c.name })),
            ]}
            placeholder="All clients"
          />
        </div>
        <div className="md:col-span-2">
          <FancySelect
            value={filters.locationId ? String(filters.locationId) : ''}
            onChange={(v) => onChange({ locationId: v ? Number(v) : undefined, facility: undefined })}
            options={[
              { value: '', label: 'All locations' },
              ...(locationsQ.data?.items ?? []).map((l) => ({ value: String(l.id), label: l.name })),
            ]}
            placeholder="All locations"
            disabled={!filters.clientId}
          />
        </div>
        <div className="md:col-span-2">
          <FancySelect
            value={filters.facility ?? ''}
            onChange={(v) => onChange({ facility: v || undefined })}
            options={[
              { value: '', label: 'All facilities' },
              ...facilityOptions.map((f) => ({ value: f, label: f })),
            ]}
            placeholder="All facilities"
            disabled={facilityOptions.length === 0}
          />
        </div>
        <div className="md:col-span-3">
          <FancySelect
            value={filters.specialityId ? String(filters.specialityId) : ''}
            onChange={(v) => onChange({ specialityId: v ? Number(v) : undefined })}
            options={[
              { value: '', label: 'All specialties' },
              ...(specialitiesQ.data?.items ?? []).map((s) => ({ value: String(s.id), label: s.name })),
            ]}
            placeholder="All specialties"
          />
        </div>
        <div className="md:col-span-1 flex justify-end">
          <Button type="button" variant="ghost" onClick={onReset} disabled={!hasAny} leftIcon={<X className="w-3 h-3" />} title="Reset filters">
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── KPI tile ─────────────────────────────────────────────── */

const TONE_RING: Record<'indigo' | 'success' | 'info' | 'warn', string> = {
  indigo: 'bg-indigo-500/10 text-indigo-500 dark:text-indigo-300',
  success: 'bg-success/10 text-success',
  info: 'bg-info/10 text-info',
  warn: 'bg-warn/10 text-warn',
};

function KpiTile({
  label,
  value,
  sublabel,
  icon,
  tone,
}: {
  label: string;
  value: string;
  sublabel?: string;
  icon: React.ReactNode;
  tone: 'indigo' | 'success' | 'info' | 'warn';
}) {
  return (
    <Card padding="default">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted">{label}</p>
          <p className="mt-1 text-2xl font-bold text-ink tabular-nums">{value}</p>
          {sublabel && <p className="text-[11px] text-ink-muted mt-1 truncate">{sublabel}</p>}
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
  title,
  subtitle,
  icon,
  loading,
  empty,
  children,
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
            <p className="text-sm font-semibold text-ink">No activity in this window</p>
            <p className="text-[11px] mt-1">Widen the window or clear filters.</p>
          </div>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

/* ── Per-day bar chart ───────────────────────────────────── */

function PerDayBars({
  rows,
  name,
  color,
  gradId,
}: {
  rows: Array<{ date: string; count: number }>;
  name: string;
  color: string;
  gradId: string;
}) {
  const data = rows.map((r) => ({ date: shortDate(r.date), [name]: r.count }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} barCategoryGap="22%" margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.95} />
            <stop offset="100%" stopColor={color} stopOpacity={0.55} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={COLOR_GRID} strokeDasharray="4 4" strokeOpacity={0.6} vertical={false} />
        <XAxis dataKey="date" stroke={COLOR_AXIS} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
        <YAxis stroke={COLOR_AXIS} tick={{ fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: 'rgba(148,163,184,0.08)' }}
          content={<ChartTooltip formatItem={(e) => ({ label: name, value: e.value, color })} />}
        />
        <Bar dataKey={name} fill={`url(#${gradId})`} radius={[6, 6, 0, 0]} maxBarSize={30} animationDuration={700} animationEasing="ease-out" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Allocated vs worked comparison ──────────────────────── */

function ComparisonChart({ rows }: { rows: Array<{ date: string; Allocated: number; 'Worked on': number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
        <defs>
          <linearGradient id="cmpAlloc" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLOR_ALLOCATED} stopOpacity={0.25} />
            <stop offset="100%" stopColor={COLOR_ALLOCATED} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="cmpWorked" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLOR_WORKED} stopOpacity={0.25} />
            <stop offset="100%" stopColor={COLOR_WORKED} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={COLOR_GRID} strokeDasharray="4 4" strokeOpacity={0.6} vertical={false} />
        <XAxis dataKey="date" stroke={COLOR_AXIS} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
        <YAxis stroke={COLOR_AXIS} tick={{ fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
        <Tooltip
          content={<ChartTooltip formatItem={(e) => ({ label: e.name, value: e.value, color: e.color })} />}
        />
        <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={9} />
        <Area type="monotone" dataKey="Allocated" stroke={COLOR_ALLOCATED} strokeWidth={2.5} fill="url(#cmpAlloc)" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} animationDuration={700} animationEasing="ease-out" />
        <Area type="monotone" dataKey="Worked on" stroke={COLOR_WORKED} strokeWidth={2.5} strokeDasharray="6 3" fill="url(#cmpWorked)" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} animationDuration={700} animationEasing="ease-out" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ── AI processing status (live donut) ───────────────────── */

/* Processed = green, In progress = amber, Error = red. */
const COLOR_PROCESSED = '#10B981';
const COLOR_INPROGRESS = '#F59E0B';
const COLOR_ERROR = '#EF4444';

function ProcessingStatusCard({ filters }: { filters: ThroughputFilters }) {
  // Polls every 10s (matching the server-side pipeline watcher tick) so the
  // donut auto-updates as charts move through QUEUED → PROCESSING → DONE/ERROR.
  const q = useQuery({
    queryKey: ['dashboard', 'ai-status', filters],
    queryFn: () => getAiProcessingStatus(filters),
    placeholderData: (prev) => prev,
    refetchInterval: 10_000,
  });
  const data = q.data;
  const loading = !data;
  const total = data ? data.processed + data.inProgress + data.error : 0;

  const slices = [
    { name: 'Processed', value: data?.processed ?? 0, color: COLOR_PROCESSED },
    { name: 'In progress', value: data?.inProgress ?? 0, color: COLOR_INPROGRESS },
    { name: 'Error', value: data?.error ?? 0, color: COLOR_ERROR },
  ];
  const nonZero = slices.filter((s) => s.value > 0);

  return (
    <ChartCard
      title="Total AI processing status"
      subtitle="Live pipeline state across charts — auto-updates every 10s"
      icon={<Sparkles className="w-3.5 h-3.5" />}
      loading={loading}
      empty={!loading && total === 0}
    >
      <div className="h-full flex items-center gap-6">
        <div className="relative flex-1 h-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={nonZero}
                dataKey="value"
                nameKey="name"
                innerRadius="62%"
                outerRadius="88%"
                paddingAngle={nonZero.length > 1 ? 2 : 0}
                stroke="none"
                animationDuration={500}
                animationEasing="ease-out"
              >
                {nonZero.map((s) => (
                  <Cell key={s.name} fill={s.color} />
                ))}
              </Pie>
              <Tooltip
                content={<ChartTooltip formatItem={(e) => ({ label: e.name, value: e.value, color: e.payload?.color })} />}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-2xl font-bold text-ink tabular-nums">{total.toLocaleString()}</span>
            <span className="text-[11px] text-ink-muted">total charts</span>
          </div>
        </div>
        <div className="space-y-3 pr-2 shrink-0">
          {slices.map((s) => (
            <div key={s.name} className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="text-sm text-ink-muted w-24">{s.name}</span>
              <span className="text-sm font-bold text-ink tabular-nums ml-auto">{s.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

/* ── AI processing status, day by day (live line chart) ──── */

function ProcessingStatusTrend({ filters }: { filters: ThroughputFilters }) {
  // Same 10s polling as the donut so the trend keeps pace with the pipeline.
  const q = useQuery({
    queryKey: ['dashboard', 'ai-status', 'series', filters],
    queryFn: () => getAiProcessingStatusSeries(filters),
    placeholderData: (prev) => prev,
    refetchInterval: 10_000,
  });
  const data = q.data;
  const loading = !data;

  // Merge the three densified series (same dates, same order) by index.
  const rows = (data?.processedPerDay ?? []).map((p, i) => ({
    date: shortDate(p.date),
    Processed: p.count,
    'In progress': data?.inProgressPerDay[i]?.count ?? 0,
    Error: data?.errorPerDay[i]?.count ?? 0,
  }));

  const allZero =
    noData(data?.processedPerDay) && noData(data?.inProgressPerDay) && noData(data?.errorPerDay);

  return (
    <ChartCard
      title="Processing status per day"
      subtitle="Charts entering each pipeline state each day — auto-updates every 10s"
      icon={<Sparkles className="w-3.5 h-3.5" />}
      loading={loading}
      empty={!loading && allZero}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
          <CartesianGrid stroke={COLOR_GRID} strokeDasharray="4 4" strokeOpacity={0.6} vertical={false} />
          <XAxis dataKey="date" stroke={COLOR_AXIS} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis stroke={COLOR_AXIS} tick={{ fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
          <Tooltip
            content={<ChartTooltip formatItem={(e) => ({ label: e.name, value: e.value, color: e.color })} />}
          />
          <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={9} />
          <Line type="monotone" dataKey="Processed" stroke={COLOR_PROCESSED} strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} animationDuration={500} animationEasing="ease-out" />
          <Line type="monotone" dataKey="In progress" stroke={COLOR_INPROGRESS} strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} animationDuration={500} animationEasing="ease-out" />
          <Line type="monotone" dataKey="Error" stroke={COLOR_ERROR} strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} animationDuration={500} animationEasing="ease-out" />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/* ── Shared bits ─────────────────────────────────────────── */

const legendStyle: React.CSSProperties = { fontSize: 11, paddingTop: 4 };

type TooltipFormat = { label?: React.ReactNode; value: React.ReactNode; color?: string } | null;
function ChartTooltip({
  active,
  payload,
  label,
  formatItem,
}: {
  active?: boolean;
  payload?: any[];
  label?: any;
  formatItem?: (entry: any) => TooltipFormat;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface shadow-pop dark:shadow-pop-dark px-3 py-2 text-xs min-w-[130px]">
      {label != null && label !== '' && <p className="font-semibold text-ink mb-1.5">{label}</p>}
      <div className="space-y-1">
        {payload.map((entry, i) => {
          const f = formatItem ? formatItem(entry) : { label: entry.name, value: entry.value, color: entry.color };
          if (!f) return null;
          return (
            <div key={i} className="flex items-center gap-2 text-ink">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: f.color ?? entry.color }} />
              {f.label != null && <span className="text-ink-muted">{f.label}</span>}
              <span className="font-bold tabular-nums ml-auto pl-4">{f.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
