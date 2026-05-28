import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Building2,
  CalendarRange,
  CircleDollarSign,
  FileBarChart2,
  FileStack,
  Files,
  Loader2,
  MapPin,
  Settings as SettingsIcon,
  Sparkles,
  X,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FancySelect, Input, Label } from '@/components/ui/Field';
import { Modal, ModalFooter, Pagination } from '@/components/ui/Primitives';
import { listClients, listLocations } from '@/api/configurations';
import {
  getBillingCharts,
  getBillingSettings,
  getBillingSummary,
  updateBillingSettings,
  type BillingFilters,
} from '@/api/billing';
import { useAuth } from '@/auth/store';
import { can } from '@/permissions';
import { cn, formatDate } from '@/lib/utils';

/* Window presets follow the productivity-page pattern so the two pages feel
   identical to operate. "All time" is added on top because billing is also
   meaningful as a lifetime read-out, not just a windowed one. */
const WINDOW_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '60', label: 'Last 60 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 365 days' },
];

const COLOR_REVENUE = '#6366F1';
const COLOR_AXIS = '#94A3B8';
const COLOR_GRID = '#E2E8F0';

export function BillingPage() {
  const user = useAuth((s) => s.user);
  const canConfigure = can(user, 'billing.configure');

  const [filters, setFilters] = useState<BillingFilters>({ days: 30 });
  const [settingsOpen, setSettingsOpen] = useState(false);

  const patch = (p: Partial<BillingFilters>) => setFilters((f) => ({ ...f, ...p }));
  const reset = () => setFilters({ days: 30 });

  const settingsQ = useQuery({
    queryKey: ['billing', 'settings'],
    queryFn: getBillingSettings,
  });
  const summaryQ = useQuery({
    queryKey: ['billing', 'summary', filters],
    queryFn: () => getBillingSummary(filters),
    placeholderData: (prev) => prev,
  });
  const data = summaryQ.data;
  const rate = settingsQ.data?.ratePerDocument ?? 0;
  const currency = settingsQ.data?.currency ?? 'USD';
  const rateNotSet = (settingsQ.data?.ratePerDocument ?? 0) === 0;

  const hasAny = !!filters.clientId || !!filters.locationId || filters.days !== 30;

  return (
    <div className="p-8 max-w-[1600px] space-y-5">
      <PageHeader
        title="Billing"
        subtitle="Revenue generated from documents processed by the AI pipeline"
        actions={
          canConfigure ? (
            <Button variant="primary" onClick={() => setSettingsOpen(true)} leftIcon={<SettingsIcon className="w-3.5 h-3.5" />}>
              Billing settings
            </Button>
          ) : null
        }
      />

      {/* Empty-state banner that nudges the admin to set a rate before the
          numbers become useful. Hidden once a non-zero rate is configured. */}
      {!settingsQ.isPending && rateNotSet && (
        <div className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-warn/20 text-warn flex items-center justify-center shrink-0">
            <CircleDollarSign className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink">No per-document rate is set</p>
            <p className="text-xs text-ink-muted mt-0.5">
              Set a price per document in <span className="font-semibold">Billing settings</span> to start
              calculating revenue. Document counts will still appear below.
            </p>
          </div>
          {canConfigure && (
            <Button variant="ghost" onClick={() => setSettingsOpen(true)} leftIcon={<SettingsIcon className="w-3.5 h-3.5" />}>
              Configure
            </Button>
          )}
        </div>
      )}

      {/* Current rate chip — small permanent reminder of the multiplier when
          a rate IS set, so users don't have to open the modal to recall it. */}
      {!settingsQ.isPending && !rateNotSet && (
        <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <CircleDollarSign className="w-3.5 h-3.5" />
            </span>
            <span className="text-ink-muted">Current rate:</span>
            <span className="font-bold text-ink tabular-nums">{formatMoney(rate, currency)}</span>
            <span className="text-ink-muted">/ document</span>
          </div>
          {canConfigure && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Change
            </button>
          )}
        </div>
      )}

      <FilterBar filters={filters} onChange={patch} onReset={reset} hasAny={hasAny} />

      {summaryQ.isError && !data ? (
        <div className="rounded-xl border border-danger/30 bg-danger-soft/30 px-4 py-3 text-sm text-danger">
          {(summaryQ.error as any)?.response?.data?.error?.message ??
            (summaryQ.error as any)?.message ??
            'Failed to load billing.'}
        </div>
      ) : (
        <>
          <KpiTiles data={data} loading={!data} currency={currency} />

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2">
              <RevenueTrendCard
                rows={data?.perDay ?? []}
                loading={!data}
                rateNotSet={rateNotSet}
                currency={currency}
              />
            </div>
            <TopClientsCard byClient={data?.byClient ?? []} loading={!data} currency={currency} />
          </div>

          <BreakdownCard
            byClient={data?.byClient ?? []}
            byLocation={data?.byLocation ?? []}
            loading={!data}
            rateNotSet={rateNotSet}
            currency={currency}
          />

          <ChartsDrillDown filters={filters} currency={currency} />
        </>
      )}

      {settingsOpen && (
        <BillingSettingsModal
          currentRate={rate}
          currentCurrency={currency}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

/* ── KPI tiles ────────────────────────────────────────────── */

function KpiTiles({
  data,
  loading,
  currency,
}: {
  data?: { totals: { charts: number; documents: number; revenue: number } };
  loading: boolean;
  currency: string;
}) {
  const t = data?.totals;
  const avgDocs = t && t.charts > 0 ? Math.round((t.documents / t.charts) * 10) / 10 : 0;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiTile
        label="Total revenue"
        value={loading ? '…' : formatMoney(t?.revenue ?? 0, currency)}
        sublabel={loading ? undefined : 'Documents × rate'}
        icon={<CircleDollarSign className="w-4 h-4" />}
        tone="success"
      />
      <KpiTile
        label="Documents processed"
        value={loading ? '…' : (t?.documents ?? 0).toLocaleString()}
        icon={<Files className="w-4 h-4" />}
        tone="indigo"
      />
      <KpiTile
        label="Charts billed"
        value={loading ? '…' : (t?.charts ?? 0).toLocaleString()}
        sublabel={loading ? undefined : 'Charts with at least one document'}
        icon={<FileStack className="w-4 h-4" />}
        tone="info"
      />
      <KpiTile
        label="Avg docs / chart"
        value={loading ? '…' : avgDocs.toLocaleString()}
        icon={<FileBarChart2 className="w-4 h-4" />}
        tone="warn"
      />
    </div>
  );
}

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
          <p className="mt-1 text-2xl font-bold text-ink tabular-nums truncate">{value}</p>
          {sublabel && <p className="text-[11px] text-ink-muted mt-1 truncate">{sublabel}</p>}
        </div>
        <div className={cn('shrink-0 w-8 h-8 rounded-lg flex items-center justify-center', TONE_RING[tone])}>
          {icon}
        </div>
      </div>
    </Card>
  );
}

/* ── Filter bar ───────────────────────────────────────────── */

function FilterBar({
  filters,
  onChange,
  onReset,
  hasAny,
}: {
  filters: BillingFilters;
  onChange: (p: Partial<BillingFilters>) => void;
  onReset: () => void;
  hasAny: boolean;
}) {
  const clientsQ = useQuery({ queryKey: ['configurations', 'clients'], queryFn: () => listClients() });
  const locationsQ = useQuery({
    queryKey: ['configurations', 'locations', filters.clientId],
    queryFn: () => listLocations(filters.clientId!),
    enabled: !!filters.clientId,
  });

  return (
    <div className="rounded-xl border border-line bg-surface-sunken/30 p-4">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-4">
          <FancySelect
            value={String(filters.days ?? 30)}
            onChange={(v) => onChange({ days: Number(v) || 30 })}
            options={WINDOW_OPTIONS}
            placeholder="Window"
          />
        </div>
        <div className="md:col-span-4">
          <FancySelect
            value={filters.clientId ? String(filters.clientId) : ''}
            onChange={(v) => onChange({ clientId: v ? Number(v) : undefined, locationId: undefined })}
            options={[
              { value: '', label: 'All clients' },
              ...(clientsQ.data?.items ?? []).map((c) => ({ value: String(c.id), label: c.name })),
            ]}
            placeholder="All clients"
          />
        </div>
        <div className="md:col-span-4">
          <FancySelect
            value={filters.locationId ? String(filters.locationId) : ''}
            onChange={(v) => onChange({ locationId: v ? Number(v) : undefined })}
            options={[
              { value: '', label: 'All locations' },
              ...(locationsQ.data?.items ?? []).map((l) => ({ value: String(l.id), label: l.name })),
            ]}
            placeholder="All locations"
            disabled={!filters.clientId}
          />
        </div>
      </div>
      <div className="flex justify-end mt-3">
        <Button type="button" variant="ghost" onClick={onReset} disabled={!hasAny} leftIcon={<X className="w-3 h-3" />} title="Reset filters">
          Reset
        </Button>
      </div>
    </div>
  );
}

/* ── Revenue trend ────────────────────────────────────────── */

function RevenueTrendCard({
  rows,
  loading,
  rateNotSet,
  currency,
}: {
  rows: Array<{ date: string; documents: number; revenue: number }>;
  loading: boolean;
  rateNotSet: boolean;
  currency: string;
}) {
  const data = rows.map((r) => ({
    date: shortDate(r.date),
    Revenue: r.revenue,
    Documents: r.documents,
  }));
  const allZero = !rows.length || rows.every((r) => r.documents === 0);

  return (
    <Card padding="default">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="text-sm font-bold text-ink inline-flex items-center gap-1.5">
            <CalendarRange className="w-3.5 h-3.5 text-ink-muted" />
            {rateNotSet ? 'Documents per day' : 'Revenue per day'}
          </h4>
          <p className="text-[11px] text-ink-muted mt-0.5">
            {rateNotSet
              ? 'Daily document volume — revenue will appear once a rate is set.'
              : 'Daily billed amount across all charts in the selected window'}
          </p>
        </div>
      </div>
      <div className="h-[280px] w-full">
        {loading ? (
          <div className="h-full flex items-center justify-center text-ink-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : allZero ? (
          <EmptyChartState />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
              <defs>
                <linearGradient id="billRevGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLOR_REVENUE} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={COLOR_REVENUE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={COLOR_GRID} strokeDasharray="4 4" strokeOpacity={0.6} vertical={false} />
              <XAxis dataKey="date" stroke={COLOR_AXIS} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
              <YAxis
                stroke={COLOR_AXIS}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => (rateNotSet ? String(v) : compactMoney(v, currency))}
                allowDecimals={false}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const item = payload[0]?.payload as { Revenue: number; Documents: number } | undefined;
                  return (
                    <div className="rounded-lg border border-line bg-surface shadow-pop dark:shadow-pop-dark px-3 py-2 text-xs min-w-[150px]">
                      <p className="font-semibold text-ink mb-1.5">{label}</p>
                      {!rateNotSet && (
                        <div className="flex items-center gap-2 text-ink">
                          <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                          <span className="text-ink-muted">Revenue</span>
                          <span className="font-bold tabular-nums ml-auto">
                            {formatMoney(item?.Revenue ?? 0, currency)}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-ink mt-1">
                        <span className="w-2 h-2 rounded-full bg-ink-muted shrink-0" />
                        <span className="text-ink-muted">Documents</span>
                        <span className="font-bold tabular-nums ml-auto">{(item?.Documents ?? 0).toLocaleString()}</span>
                      </div>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey={rateNotSet ? 'Documents' : 'Revenue'}
                stroke={COLOR_REVENUE}
                strokeWidth={2.5}
                fill="url(#billRevGrad)"
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
                animationDuration={600}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

/* ── Top 5 clients (horizontal bars) ──────────────────────── */

function TopClientsCard({
  byClient,
  loading,
  currency,
}: {
  byClient: Array<{ clientName: string; documents: number; revenue: number }>;
  loading: boolean;
  currency: string;
}) {
  const top = useMemo(() => {
    const sorted = [...byClient].sort((a, b) => b.revenue - a.revenue || b.documents - a.documents);
    return sorted.slice(0, 5);
  }, [byClient]);
  const max = top.reduce((m, r) => Math.max(m, r.revenue, r.documents), 0);

  return (
    <Card padding="default">
      <div className="mb-3">
        <h4 className="text-sm font-bold text-ink inline-flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-ink-muted" />
          Top clients
        </h4>
        <p className="text-[11px] text-ink-muted mt-0.5">By revenue in this window</p>
      </div>
      <div className="h-[280px] flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-ink-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : top.length === 0 ? (
          <EmptyChartState />
        ) : (
          <div className="flex-1 flex flex-col justify-around gap-3">
            {top.map((r, i) => {
              const metric = r.revenue || r.documents;
              const pct = max > 0 ? (metric / max) * 100 : 0;
              return (
                <div key={r.clientName + i} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold text-ink truncate min-w-0 flex-1">{r.clientName}</span>
                    <span className="font-bold text-ink tabular-nums shrink-0">
                      {formatMoney(r.revenue, currency)}
                    </span>
                  </div>
                  <div className="relative h-2 rounded-full bg-surface-sunken overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary/80 to-primary"
                      style={{ width: `${Math.max(2, pct)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-ink-muted tabular-nums">
                    {r.documents.toLocaleString()} documents
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

/* ── Breakdown by client / location (tabbed table) ────────── */

function BreakdownCard({
  byClient,
  byLocation,
  loading,
  rateNotSet,
  currency,
}: {
  byClient: Array<{ clientId: number; clientName: string; charts: number; documents: number; revenue: number }>;
  byLocation: Array<{ locationId: number; locationName: string; clientName: string; charts: number; documents: number; revenue: number }>;
  loading: boolean;
  rateNotSet: boolean;
  currency: string;
}) {
  const [tab, setTab] = useState<'client' | 'location'>('client');
  const rows = tab === 'client' ? byClient : byLocation;
  const maxRevenue = rows.reduce((m, r) => Math.max(m, r.revenue || r.documents), 0);

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-line">
        <div>
          <h4 className="text-sm font-bold text-ink">Billing breakdown</h4>
          <p className="text-[11px] text-ink-muted">
            {tab === 'client'
              ? 'How much each client generated, ordered by revenue'
              : 'Drill one level deeper — every client/location pair'}
          </p>
        </div>
        <div className="inline-flex rounded-pill border border-line bg-surface p-0.5">
          {(
            [
              { k: 'client' as const, label: 'By client', icon: <Building2 className="w-3.5 h-3.5" /> },
              { k: 'location' as const, label: 'By location', icon: <MapPin className="w-3.5 h-3.5" /> },
            ]
          ).map(({ k, label, icon }) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 h-7 rounded-pill text-xs font-semibold transition',
                tab === k ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink',
              )}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead>
            <tr>
              <th className="table-head">{tab === 'client' ? 'Client' : 'Location'}</th>
              {tab === 'location' && <th className="table-head">Client</th>}
              <th className="table-head text-right">Charts</th>
              <th className="table-head text-right">Documents</th>
              <th className="table-head">Share</th>
              <th className="table-head text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={tab === 'client' ? 5 : 6} className="py-16 text-center">
                  <Loader2 className="w-5 h-5 animate-spin inline text-ink-muted" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={tab === 'client' ? 5 : 6} className="py-16 text-center text-sm text-ink-muted">
                  No documents uploaded in this window for any {tab === 'client' ? 'client' : 'location'}.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => {
                const metric = r.revenue || r.documents;
                const pct = maxRevenue > 0 ? (metric / maxRevenue) * 100 : 0;
                return (
                  <tr key={i} className="hover:bg-surface-sunken/40 transition">
                    <td className="table-cell font-semibold text-ink">
                      {tab === 'client'
                        ? (r as { clientName: string }).clientName
                        : (r as { locationName: string }).locationName}
                    </td>
                    {tab === 'location' && (
                      <td className="table-cell text-ink-muted">
                        {(r as { clientName: string }).clientName}
                      </td>
                    )}
                    <td className="table-cell text-right tabular-nums">{r.charts.toLocaleString()}</td>
                    <td className="table-cell text-right tabular-nums font-semibold text-ink">
                      {r.documents.toLocaleString()}
                    </td>
                    <td className="table-cell">
                      <div className="relative h-1.5 rounded-full bg-surface-sunken w-full max-w-[200px] overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary/80 to-primary"
                          style={{ width: `${Math.max(2, pct)}%` }}
                        />
                      </div>
                    </td>
                    <td className="table-cell text-right tabular-nums">
                      {rateNotSet ? (
                        <span className="text-ink-subtle">—</span>
                      ) : (
                        <span className="font-bold text-ink">{formatMoney(r.revenue, currency)}</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ── Drill-down: charts table ─────────────────────────────── */

function ChartsDrillDown({ filters, currency }: { filters: BillingFilters; currency: string }) {
  const [page, setPage] = useState(1);
  const pageSize = 20;
  useEffect(() => {
    setPage(1);
  }, [filters]);

  const q = useQuery({
    queryKey: ['billing', 'charts', { filters, page }],
    queryFn: () => getBillingCharts({ ...filters, page, pageSize }),
    placeholderData: (prev) => prev,
  });
  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rate = q.data?.ratePerDocument ?? 0;

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-line">
        <div>
          <h4 className="text-sm font-bold text-ink">Billed charts ({total.toLocaleString()})</h4>
          <p className="text-[11px] text-ink-muted">Every chart with uploaded documents in this window</p>
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
              <th className="table-head">Uploaded</th>
              <th className="table-head text-right">Documents</th>
              <th className="table-head text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {q.isPending && !q.data ? (
              <tr>
                <td colSpan={7} className="py-16 text-center">
                  <Loader2 className="w-5 h-5 animate-spin inline text-ink-muted" />
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-16 text-center text-sm text-ink-muted">
                  No documents uploaded in this window.
                </td>
              </tr>
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
                  <td className="table-cell text-ink-muted whitespace-nowrap">
                    {r.uploadedAt ? formatDate(r.uploadedAt) : '—'}
                  </td>
                  <td className="table-cell text-right tabular-nums font-semibold text-ink">
                    {r.documents.toLocaleString()}
                  </td>
                  <td className="table-cell text-right tabular-nums">
                    {rate > 0 ? (
                      <span className="font-bold text-ink">{formatMoney(r.amount, currency)}</span>
                    ) : (
                      <span className="text-ink-subtle">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {items.length > 0 && <Pagination page={page} pageCount={totalPages} onPageChange={setPage} />}
    </Card>
  );
}

/* ── Settings modal ───────────────────────────────────────── */

function BillingSettingsModal({
  currentRate,
  currentCurrency,
  onClose,
}: {
  currentRate: number;
  currentCurrency: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [rateInput, setRateInput] = useState(currentRate > 0 ? String(currentRate) : '');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (v: number) => updateBillingSettings({ ratePerDocument: v, currency: currentCurrency }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing'] });
      onClose();
    },
    onError: (e: any) => {
      setError(e?.response?.data?.error?.message ?? e?.message ?? 'Could not save the rate.');
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const n = Number(rateInput);
    if (!Number.isFinite(n) || n < 0) {
      setError('Enter a non-negative number.');
      return;
    }
    if (n > 1_000_000) {
      setError('Rate is unrealistically large.');
      return;
    }
    mutation.mutate(n);
  };

  const preview = useMemo(() => {
    const n = Number(rateInput);
    if (!Number.isFinite(n) || n < 0) return null;
    return {
      ten: n * 10,
      hundred: n * 100,
      thousand: n * 1000,
    };
  }, [rateInput]);

  return (
    <Modal
      open
      onClose={onClose}
      title="Billing settings"
      subtitle="The price per uploaded document, applied across all clients and locations."
      size="md"
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <Label htmlFor="rate-input" required>
            Price per document
          </Label>
          <div className="mt-1 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted font-semibold">
              {currencySymbol(currentCurrency)}
            </span>
            <Input
              id="rate-input"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              value={rateInput}
              onChange={(e) => setRateInput(e.target.value)}
              className="pl-7 tabular-nums"
              autoFocus
            />
          </div>
          <p className="text-[11px] text-ink-muted mt-1.5">
            Used for both lifetime totals and per-day revenue. Changing this updates billing across the whole app.
          </p>
        </div>

        {preview && (
          <div className="rounded-lg border border-line bg-surface-sunken/40 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-2">Quick preview</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <PreviewCell label="10 docs" value={formatMoney(preview.ten, currentCurrency)} />
              <PreviewCell label="100 docs" value={formatMoney(preview.hundred, currentCurrency)} />
              <PreviewCell label="1,000 docs" value={formatMoney(preview.thousand, currentCurrency)} />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft/30 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Save rate
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function PreviewCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-ink-muted uppercase tracking-wide font-semibold">{label}</p>
      <p className="text-sm font-bold text-ink tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

/* ── Shared bits ──────────────────────────────────────────── */

function EmptyChartState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center text-ink-muted">
      <p className="text-sm font-semibold text-ink">No activity in this window</p>
      <p className="text-[11px] mt-1">Widen the window or clear filters.</p>
    </div>
  );
}

function dash(v: React.ReactNode) {
  return v === null || v === undefined || v === '' ? <span className="text-ink-subtle text-xs">—</span> : v;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currencySymbol(currency)}${n.toFixed(2)}`;
  }
}

function compactMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(n);
  } catch {
    return `${currencySymbol(currency)}${Math.round(n)}`;
  }
}

function currencySymbol(currency: string): string {
  switch (currency) {
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    case 'INR':
      return '₹';
    default:
      return currency + ' ';
  }
}
