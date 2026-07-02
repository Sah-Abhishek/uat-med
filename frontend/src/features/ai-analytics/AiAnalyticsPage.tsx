import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Building2,
  CheckCircle2,
  ChevronsUpDown,
  Clock,
  Download,
  FileStack,
  Filter,
  Loader2,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import { format, startOfMonth, subDays } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FancyMultiSelect, Label, RangeDatePicker } from '@/components/ui/Field';
import { Modal, ModalFooter, Toast } from '@/components/ui/Primitives';
import {
  listPrimarySpecialities,
  listSubSpecialities,
} from '@/api/configurations';
import {
  downloadQaEncountersXlsx,
  getQaAccuracy,
  getQaActivityBreakdown,
  listQaFacilities,
  type CodeReviewType,
  type QaActivityBreakdownRow,
  type QaFilters,
} from '@/api/qa';
import { useScope } from '@/scope/store';
import { cn } from '@/lib/utils';

/* Verdict palette — kept in sync with the QA accuracy tab and decision chips. */
const COLOR_ACCEPT = '#10B981'; // success
const COLOR_EDIT = '#3B82F6'; // info
const COLOR_REJECT = '#EF4444'; // danger
const COLOR_ADDED = '#F59E0B'; // warn — coder added a code the AI missed
const COLOR_PRIMARY = '#1E40AF';
const COLOR_AXIS = '#94A3B8';
const COLOR_GRID = '#E2E8F0';

const CODE_TYPE_LABEL: Record<CodeReviewType, string> = {
  PRIMARY: 'Primary Dx',
  SECONDARY: 'Secondary Dx',
  PROCEDURE: 'CPT / Procedure',
  EM_LEVEL: 'ED/EM Level',
  MODIFIER: 'Modifier',
};

/** Page-local filters. Client / Location are NOT here — they come from the
 * global header scope (useScope), so the header filters AI Analytics in lockstep
 * with Charts / Worklists / Dashboard. */
type AnalyticsFilters = Pick<
  QaFilters,
  'specialityId' | 'subSpecialityId' | 'facility' | 'from' | 'to'
>;

/** True when a single-or-array filter value is actually set (non-empty). */
function hasValue(v: unknown): boolean {
  return Array.isArray(v) ? v.length > 0 : v != null && v !== '';
}

export function AiAnalyticsPage() {
  const [filters, setFilters] = useState<AnalyticsFilters>({});
  const reset = () => setFilters({});
  const [filterOpen, setFilterOpen] = useState(false);

  // Client / Location come from the global header scope (same as Charts /
  // Worklists), so the header dropdowns filter this page.
  const scopeClientId = useScope((s) => s.clientId);
  const scopeLocationId = useScope((s) => s.locationId);

  // A facility or sub-speciality chosen under one client/location is meaningless
  // under another (both are location-scoped) — clear them whenever scope changes.
  useEffect(() => {
    setFilters((f) =>
      hasValue(f.facility) || hasValue(f.subSpecialityId)
        ? { ...f, facility: undefined, subSpecialityId: undefined }
        : f,
    );
  }, [scopeClientId, scopeLocationId]);

  // Count of active page-local filters (the date range counts once) — drives
  // the badge on the Filter button.
  const activeFilterCount =
    (filters.from || filters.to ? 1 : 0) +
    (hasValue(filters.specialityId) ? 1 : 0) +
    (hasValue(filters.subSpecialityId) ? 1 : 0) +
    (hasValue(filters.facility) ? 1 : 0);

  const scopedFilters: QaFilters = useMemo(
    () => ({
      ...filters,
      ...(scopeClientId != null ? { clientId: scopeClientId } : {}),
      ...(scopeLocationId != null ? { locationId: scopeLocationId } : {}),
    }),
    [filters, scopeClientId, scopeLocationId],
  );

  const q = useQuery({
    queryKey: ['qa', 'accuracy', scopedFilters],
    queryFn: () => getQaAccuracy(scopedFilters),
    placeholderData: (prev) => prev,
  });
  const data = q.data;
  const loading = !data;

  const acceptancePct = data ? data.kpis.acceptanceRate * 100 : 0;

  // ── Activity breakdown (client × location × sub-speciality) ──
  // Has its OWN date window (Today / last 7d / this month), independent of the
  // page date filter, so the headline accuracy can stay as-is while you see
  // today's activity. Still respects the global header Client/Location scope.
  const [breakdownRange, setBreakdownRange] = useState<BreakdownRange>('today');
  const breakdownFilters: QaFilters = useMemo(() => {
    const { from, to } = rangeWindow(breakdownRange);
    return {
      ...(scopeClientId != null ? { clientId: scopeClientId } : {}),
      ...(scopeLocationId != null ? { locationId: scopeLocationId } : {}),
      from,
      to,
    };
  }, [breakdownRange, scopeClientId, scopeLocationId]);

  const breakdownQ = useQuery({
    queryKey: ['qa', 'activity-breakdown', breakdownFilters],
    queryFn: () => getQaActivityBreakdown(breakdownFilters),
    placeholderData: (prev) => prev,
  });

  // ── Encounter export (custom date range) ──
  // Pulls the full per-encounter list for a user-picked [from,to] window (same
  // Client / Location scope) and downloads it as an XLSX. `exporting` blocks a
  // second concurrent export and drives the button spinner.
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'danger' | 'warn' } | null>(null);

  const handleExport = async (range: { from: string; to: string }) => {
    if (exporting) return;
    setExporting(true);
    try {
      const params: QaFilters = {
        ...(scopeClientId != null ? { clientId: scopeClientId } : {}),
        ...(scopeLocationId != null ? { locationId: scopeLocationId } : {}),
        from: range.from,
        to: range.to,
      };
      const count = await downloadQaEncountersXlsx(params, `ai-encounters-${range.from}_to_${range.to}`);
      const label = `${range.from} → ${range.to}`;
      setToast({
        message:
          count == null
            ? `Encounter export downloaded (${label}).`
            : count === 0
            ? `No encounters in this window — exported an empty sheet (${label}).`
            : `Exported ${count.toLocaleString()} encounter${count === 1 ? '' : 's'} (${label}).`,
        variant: count === 0 ? 'warn' : 'success',
      });
    } catch (err) {
      console.error('Encounter export failed', err);
      setToast({ message: 'Export failed. Please try again.', variant: 'danger' });
    } finally {
      setExporting(false);
    }
  };

  // Acceptance trend granularity (weekly / daily).
  const [trendMode, setTrendMode] = useState<'weekly' | 'daily'>('weekly');
  const trendPoints =
    trendMode === 'weekly'
      ? (data?.weekly ?? []).map((r) => ({
          label: shortDate(r.week),
          accuracy: r.total ? (r.accepted / r.total) * 100 : 0,
        }))
      : (data?.daily ?? []).map((r) => ({
          label: shortDate(r.day),
          accuracy: r.decisions ? (r.accepted / r.decisions) * 100 : 0,
        }));
  const trendEmpty =
    trendMode === 'weekly' ? (data?.weekly.length ?? 0) === 0 : (data?.daily.length ?? 0) === 0;

  return (
    <div className="p-8 max-w-[1600px] space-y-5">
      <PageHeader
        title="AI Analytics"
        subtitle="How accurate the AI coding suggestions are — overall, by code type, and over time"
        actions={
          <>
            <Button
              variant="soft"
              leftIcon={<Filter className="w-3.5 h-3.5" />}
              onClick={() => setFilterOpen(true)}
              className={cn(activeFilterCount > 0 && 'ring-1 ring-primary/50 text-primary')}
            >
              Filter
              {activeFilterCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[11px] font-bold leading-none">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                leftIcon={<X className="w-3.5 h-3.5" />}
                onClick={reset}
                title="Clear all filters"
              >
                Clear filters
              </Button>
            )}
          </>
        }
      />

      <FilterModal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        value={filters}
        onApply={setFilters}
        clientId={scopeClientId}
        locationId={scopeLocationId}
      />

      {q.isError && !data ? (
        <div className="rounded-xl border border-danger/30 bg-danger-soft/30 px-4 py-3 text-sm text-danger">
          {(q.error as any)?.response?.data?.error?.message ??
            (q.error as any)?.message ??
            'Failed to load AI analytics.'}
        </div>
      ) : (
        <>
          {/* ── KPI tiles ─────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile
              label="AI acceptance rate"
              value={loading ? '…' : `${acceptancePct.toFixed(1)}%`}
              sublabel={loading ? undefined : `${data.kpis.acceptedCount.toLocaleString()} of ${data.kpis.totalDecisions.toLocaleString()} accepted`}
              icon={<CheckCircle2 className="w-4 h-4" />}
              tone="success"
            />
            <KpiTile
              label="Total decisions"
              value={loading ? '…' : data.kpis.totalDecisions.toLocaleString()}
              icon={<BarChart3 className="w-4 h-4" />}
              tone="primary"
            />
            <KpiTile
              label="Charts analyzed"
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

          {/* ── Activity breakdown: which client / location / sub-speciality ── */}
          <ActivityBreakdownCard
            rows={breakdownQ.data?.items ?? []}
            loading={!breakdownQ.data && breakdownQ.isPending}
            fetching={breakdownQ.isFetching}
            range={breakdownRange}
            onRangeChange={setBreakdownRange}
            onExport={handleExport}
            exporting={exporting}
          />

          <Toast
            open={toast != null}
            message={toast?.message ?? ''}
            variant={toast?.variant ?? 'warn'}
            onClose={() => setToast(null)}
          />

          {/* ── Row 1: accuracy by code type + verdict mix ── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <ChartCard
              className="xl:col-span-2"
              title="Accuracy by code type"
              subtitle="Accepted · Edited · Rejected share of AI suggestions per code category"
              icon={<BarChart3 className="w-3.5 h-3.5" />}
              loading={loading}
              empty={!loading && (data?.perCodeType.length ?? 0) === 0}
            >
              <PerCodeTypeChart rows={data?.perCodeType ?? []} />
            </ChartCard>

            <ChartCard
              title="Overall verdict mix"
              subtitle="Every AI suggestion reviewed in scope"
              icon={<Sparkles className="w-3.5 h-3.5" />}
              loading={loading}
              empty={!loading && (data?.kpis.totalDecisions ?? 0) === 0}
            >
              <VerdictDonut
                accepted={data?.kpis.acceptedCount ?? 0}
                edited={data?.kpis.editedCount ?? 0}
                rejected={data?.kpis.rejectedCount ?? 0}
                added={data?.kpis.addedCount ?? 0}
                acceptancePct={acceptancePct}
              />
            </ChartCard>
          </div>

          {/* ── Row 2: accuracy trend + reject reasons ────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard
              title="Acceptance trend"
              subtitle={`${trendMode === 'weekly' ? 'Weekly' : 'Daily'} AI acceptance rate`}
              icon={<TrendingUp className="w-3.5 h-3.5" />}
              loading={loading}
              empty={!loading && trendEmpty}
              action={<GranularityToggle value={trendMode} onChange={setTrendMode} />}
            >
              <AccuracyTrendChart points={trendPoints} />
            </ChartCard>

            <ChartCard
              title="Top rejection reasons"
              subtitle="Where the model is weakest — based on reviewer-selected reasons"
              icon={<Activity className="w-3.5 h-3.5" />}
              loading={loading}
              empty={!loading && (data?.topRejectReasons.length ?? 0) === 0}
            >
              <TopRejectChart rows={data?.topRejectReasons ?? []} />
            </ChartCard>
          </div>

          {/* ── Row 3: daily accuracy + daily volume ──────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard
              title="Daily AI accuracy"
              subtitle="AI acceptance rate per day, vs the period average"
              icon={<TrendingUp className="w-3.5 h-3.5" />}
              loading={loading}
              empty={!loading && (data?.daily.length ?? 0) === 0}
            >
              <DailyAccuracyChart rows={data?.daily ?? []} overall={data?.kpis.acceptanceRate ?? 0} />
            </ChartCard>

            <ChartCard
              title="Daily decision volume"
              subtitle="Unique charts that received an AI decision each day"
              icon={<BarChart3 className="w-3.5 h-3.5" />}
              loading={loading}
              empty={!loading && (data?.daily.length ?? 0) === 0}
            >
              <DailyVolumeChart rows={data?.daily ?? []} />
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Filter modal ────────────────────────────────────────── */

/** Normalise a single-or-array filter value to string[] for the multi-selects. */
const toStrArr = (v: unknown): string[] =>
  v === undefined || v === null || v === ''
    ? []
    : Array.isArray(v)
    ? v.map(String)
    : [String(v)];

function FilterModal({
  open,
  onClose,
  value,
  onApply,
  clientId,
  locationId,
}: {
  open: boolean;
  onClose: () => void;
  value: AnalyticsFilters;
  onApply: (v: AnalyticsFilters) => void;
  // Client / Location are the global header scope — they scope the option lists
  // but aren't edited here (the header picker owns them, like on Charts).
  clientId: number | null;
  locationId: number | null;
}) {
  // Draft filters — re-seeded from the applied value each time the modal opens,
  // so closing without "Apply" discards any in-progress edits.
  const [draft, setDraft] = useState<AnalyticsFilters>(value);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);
  const patch = (p: Partial<AnalyticsFilters>) => setDraft((d) => ({ ...d, ...p }));

  // Option sources — only fetched while the modal is open. Speciality is
  // client-scoped; facilities + sub-specialities follow the global Client /
  // Location scope from the header.
  const specialitiesQ = useQuery({
    queryKey: ['configurations', 'primary-specialities', clientId],
    queryFn: () => listPrimarySpecialities(clientId ?? undefined),
    enabled: open,
  });
  const facilitiesQ = useQuery({
    queryKey: ['qa', 'facilities', clientId, locationId],
    queryFn: () => listQaFacilities({ clientId: clientId ?? undefined, locationId: locationId ?? undefined }),
    enabled: open,
  });
  // Sub-specialities belong to a location, so the list only loads once a
  // location is in scope (mirrors how Charts / Worklists gate it).
  const subSpecialitiesQ = useQuery({
    queryKey: ['configurations', 'sub-specialities', locationId],
    queryFn: () => listSubSpecialities(locationId!),
    enabled: open && locationId != null,
  });

  const facilityOptions = facilitiesQ.data?.items ?? [];
  const subSpecialityOptions = subSpecialitiesQ.data?.items ?? [];

  return (
    <Modal open={open} onClose={onClose} title="Filter AI Analytics" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Label>Date range</Label>
            <RangeDatePicker
              value={{ from: draft.from ?? null, to: draft.to ?? null }}
              onChange={(v) => patch({ from: v.from ?? undefined, to: v.to ?? undefined })}
              placeholder="Any dates"
            />
          </div>

          <div>
            <Label>Specialties</Label>
            <FancyMultiSelect
              searchable
              searchPlaceholder="Search specialties…"
              placeholder={specialitiesQ.isPending ? 'Loading…' : 'All specialties'}
              value={toStrArr(draft.specialityId)}
              onChange={(v) => patch({ specialityId: v.length ? v.map(Number) : undefined })}
              options={(specialitiesQ.data?.items ?? []).map((s) => ({ value: String(s.id), label: s.name }))}
            />
          </div>

          <div>
            <Label>Sub-specialties</Label>
            <FancyMultiSelect
              searchable
              searchPlaceholder="Search sub-specialties…"
              placeholder={
                locationId == null
                  ? 'Pick a location first'
                  : subSpecialitiesQ.isPending
                  ? 'Loading…'
                  : 'All sub-specialties'
              }
              disabled={locationId == null || subSpecialityOptions.length === 0}
              value={toStrArr(draft.subSpecialityId)}
              onChange={(v) => patch({ subSpecialityId: v.length ? v.map(Number) : undefined })}
              options={subSpecialityOptions.map((s) => ({ value: String(s.id), label: s.name }))}
            />
          </div>

          <div className="sm:col-span-2">
            <Label>Facilities</Label>
            <FancyMultiSelect
              searchable
              searchPlaceholder="Search facilities…"
              placeholder={facilityOptions.length === 0 ? 'No facilities in scope' : 'All facilities'}
              disabled={facilityOptions.length === 0}
              value={toStrArr(draft.facility)}
              onChange={(v) => patch({ facility: v.length ? v : undefined })}
              options={facilityOptions.map((f) => ({ value: f, label: f }))}
            />
          </div>
        </div>

        <ModalFooter>
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setDraft({});
              onApply({});
              onClose();
            }}
          >
            Clear all
          </Button>
          <Button
            type="button"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            Apply filters
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}

/* ── KPI tile ─────────────────────────────────────────────── */

const TONE_RING: Record<'primary' | 'success' | 'info' | 'warn', string> = {
  primary: 'bg-primary/10 text-primary',
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
  tone: 'primary' | 'success' | 'info' | 'warn';
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
  className,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  empty?: boolean;
  className?: string;
  /** Optional control rendered on the right of the header (e.g. a toggle). */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card padding="default" className={className}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h4 className="text-sm font-bold text-ink inline-flex items-center gap-1.5">
            {icon && <span className="text-ink-muted">{icon}</span>}
            {title}
          </h4>
          {subtitle && <p className="text-[11px] text-ink-muted mt-0.5">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
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

/* ── Accuracy by code type (stacked %) ───────────────────── */

function PerCodeTypeChart({
  rows,
}: {
  rows: { codeType: CodeReviewType; accepted: number; edited: number; rejected: number; added: number; total: number }[];
}) {
  const data = rows.map((r) => {
    const total = r.total || 1;
    return {
      label: CODE_TYPE_LABEL[r.codeType] ?? r.codeType,
      accepted: r.accepted,
      edited: r.edited,
      rejected: r.rejected,
      added: r.added,
      acceptedPct: (r.accepted / total) * 100,
      editedPct: (r.edited / total) * 100,
      rejectedPct: (r.rejected / total) * 100,
      addedPct: (r.added / total) * 100,
    };
  });
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" barCategoryGap="28%" margin={{ top: 5, right: 24, bottom: 5, left: 8 }}>
        <defs>
          <linearGradient id="pctAccept" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#34D399" /><stop offset="100%" stopColor={COLOR_ACCEPT} />
          </linearGradient>
          <linearGradient id="pctEdit" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#60A5FA" /><stop offset="100%" stopColor={COLOR_EDIT} />
          </linearGradient>
          <linearGradient id="pctReject" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#FB7185" /><stop offset="100%" stopColor={COLOR_REJECT} />
          </linearGradient>
          <linearGradient id="pctAdded" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#FBBF24" /><stop offset="100%" stopColor={COLOR_ADDED} />
          </linearGradient>
        </defs>
        <CartesianGrid horizontal={false} stroke={COLOR_GRID} strokeDasharray="4 4" strokeOpacity={0.6} />
        <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} stroke={COLOR_AXIS} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" stroke={COLOR_AXIS} tick={{ fontSize: 11 }} width={110} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: 'rgba(148,163,184,0.08)' }}
          content={
            <ChartTooltip
              formatItem={(e) => {
                const k = e.dataKey as string;
                const raw =
                  k === 'acceptedPct' ? e.payload.accepted :
                  k === 'editedPct' ? e.payload.edited :
                  k === 'rejectedPct' ? e.payload.rejected :
                  e.payload.added;
                const lbl =
                  k === 'acceptedPct' ? 'Accepted' :
                  k === 'editedPct' ? 'Edited' :
                  k === 'rejectedPct' ? 'Rejected' :
                  'Added';
                const color =
                  k === 'acceptedPct' ? COLOR_ACCEPT :
                  k === 'editedPct' ? COLOR_EDIT :
                  k === 'rejectedPct' ? COLOR_REJECT :
                  COLOR_ADDED;
                return { label: lbl, value: `${raw} (${(e.value as number).toFixed(1)}%)`, color };
              }}
            />
          }
        />
        <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={9} />
        <Bar dataKey="acceptedPct" stackId="v" name="Accepted" fill="url(#pctAccept)" radius={[6, 0, 0, 6]} maxBarSize={26} animationDuration={700} animationEasing="ease-out" />
        <Bar dataKey="editedPct" stackId="v" name="Edited" fill="url(#pctEdit)" maxBarSize={26} animationDuration={700} animationEasing="ease-out" />
        <Bar dataKey="rejectedPct" stackId="v" name="Rejected" fill="url(#pctReject)" maxBarSize={26} animationDuration={700} animationEasing="ease-out" />
        <Bar dataKey="addedPct" stackId="v" name="Added" fill="url(#pctAdded)" radius={[0, 6, 6, 0]} maxBarSize={26} animationDuration={700} animationEasing="ease-out" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Overall verdict donut ───────────────────────────────── */

function VerdictDonut({
  accepted,
  edited,
  rejected,
  added,
  acceptancePct,
}: {
  accepted: number;
  edited: number;
  rejected: number;
  added: number;
  acceptancePct: number;
}) {
  const data = [
    { name: 'Accepted', value: accepted, color: COLOR_ACCEPT },
    { name: 'Edited', value: edited, color: COLOR_EDIT },
    { name: 'Rejected', value: rejected, color: COLOR_REJECT },
    { name: 'Added', value: added, color: COLOR_ADDED },
  ].filter((d) => d.value > 0);

  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="60%"
            outerRadius="86%"
            paddingAngle={3}
            cornerRadius={8}
            stroke="none"
            animationDuration={700}
            animationEasing="ease-out"
          >
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip
            content={
              <ChartTooltip formatItem={(e) => ({ label: e.name, value: (e.value as number).toLocaleString(), color: e.payload?.color })} />
            }
          />
          <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={9} />
        </PieChart>
      </ResponsiveContainer>
      {/* Center label — the headline accuracy number. pointer-events-none so it
          doesn't block slice tooltips. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none -mt-5">
        <span className="text-3xl font-bold text-ink tabular-nums leading-none">
          {acceptancePct.toFixed(0)}%
        </span>
        <span className="text-[11px] text-ink-muted mt-1">accepted</span>
      </div>
    </div>
  );
}

/* ── Acceptance trend (weekly / daily %) ─────────────────── */

/** Weekly ↔ Daily segmented toggle for the acceptance trend. */
function GranularityToggle({
  value,
  onChange,
}: {
  value: 'weekly' | 'daily';
  onChange: (v: 'weekly' | 'daily') => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface-sunken/40 p-0.5 text-[11px] font-semibold">
      {(['weekly', 'daily'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-pressed={value === m}
          className={cn(
            'px-2.5 py-1 rounded-md capitalize transition',
            value === m ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function AccuracyTrendChart({ points }: { points: { label: string; accuracy: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
        <defs>
          <linearGradient id="accFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLOR_ACCEPT} stopOpacity={0.35} />
            <stop offset="100%" stopColor={COLOR_ACCEPT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={COLOR_GRID} strokeDasharray="4 4" strokeOpacity={0.6} />
        <XAxis dataKey="label" stroke={COLOR_AXIS} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} stroke={COLOR_AXIS} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          content={
            <ChartTooltip formatItem={(e) => ({ label: 'Acceptance', value: `${(e.value as number).toFixed(1)}%`, color: COLOR_ACCEPT })} />
          }
        />
        <Area
          type="monotone"
          dataKey="accuracy"
          stroke={COLOR_ACCEPT}
          strokeWidth={2.5}
          fill="url(#accFill)"
          dot={{ r: 2.5, strokeWidth: 0, fill: COLOR_ACCEPT }}
          activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
          animationDuration={700}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ── Daily AI accuracy (% per day, vs period average) ────── */

function DailyAccuracyChart({
  rows,
  overall,
}: {
  rows: { day: string; accepted: number; decisions: number }[];
  overall: number;
}) {
  const data = rows.map((r) => ({
    day: shortDate(r.day),
    accuracy: r.decisions ? (r.accepted / r.decisions) * 100 : 0,
    accepted: r.accepted,
    decisions: r.decisions,
  }));
  const overallPct = overall * 100;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
        <defs>
          <linearGradient id="dailyAccFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLOR_ACCEPT} stopOpacity={0.35} />
            <stop offset="100%" stopColor={COLOR_ACCEPT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={COLOR_GRID} strokeDasharray="4 4" strokeOpacity={0.6} />
        <XAxis dataKey="day" stroke={COLOR_AXIS} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} stroke={COLOR_AXIS} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          content={
            <ChartTooltip
              formatItem={(e) => ({
                label: 'Accuracy',
                value: `${(e.value as number).toFixed(1)}%  (${e.payload.accepted}/${e.payload.decisions})`,
                color: COLOR_ACCEPT,
              })}
            />
          }
        />
        {overallPct > 0 && (
          <ReferenceLine
            y={overallPct}
            stroke={COLOR_AXIS}
            strokeDasharray="5 4"
            label={{ value: `avg ${overallPct.toFixed(1)}%`, position: 'right', fontSize: 10, fill: COLOR_AXIS }}
          />
        )}
        <Area
          type="monotone"
          dataKey="accuracy"
          stroke={COLOR_ACCEPT}
          strokeWidth={2.5}
          fill="url(#dailyAccFill)"
          dot={{ r: 2, strokeWidth: 0, fill: COLOR_ACCEPT }}
          activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
          animationDuration={700}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ── Top rejection reasons ───────────────────────────────── */

function TopRejectChart({ rows }: { rows: { reason: string; count: number }[] }) {
  const max = rows[0]?.count ?? 1;
  const data = rows.map((r) => ({
    label: r.reason.length > 34 ? `${r.reason.slice(0, 33)}…` : r.reason,
    fullLabel: r.reason,
    count: r.count,
    intensity: r.count / max,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" barCategoryGap="32%" margin={{ top: 5, right: 32, bottom: 5, left: 8 }}>
        <CartesianGrid horizontal={false} stroke={COLOR_GRID} strokeDasharray="4 4" strokeOpacity={0.6} />
        <XAxis type="number" stroke={COLOR_AXIS} tick={{ fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" stroke={COLOR_AXIS} tick={{ fontSize: 11 }} width={210} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: 'rgba(239,68,68,0.06)' }}
          content={
            <ChartTooltip
              formatLabel={(_, p) => (p?.[0]?.payload as any)?.fullLabel ?? ''}
              formatItem={(e) => ({ value: `${e.value} rejection${e.value === 1 ? '' : 's'}`, color: COLOR_REJECT })}
            />
          }
        />
        <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={22} animationDuration={700} animationEasing="ease-out">
          {data.map((d, i) => (
            <Cell key={i} fill={`rgba(239,68,68,${0.45 + d.intensity * 0.55})`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Daily volume ────────────────────────────────────────── */

function DailyVolumeChart({ rows }: { rows: { day: string; submissions: number }[] }) {
  const data = rows.map((r) => ({ day: shortDate(r.day), Submissions: r.submissions }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} barCategoryGap="30%" margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
        <defs>
          <linearGradient id="dailyBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3B82F6" /><stop offset="100%" stopColor={COLOR_PRIMARY} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={COLOR_GRID} strokeDasharray="4 4" strokeOpacity={0.6} vertical={false} />
        <XAxis dataKey="day" stroke={COLOR_AXIS} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis stroke={COLOR_AXIS} tick={{ fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: 'rgba(30,64,175,0.06)' }}
          content={<ChartTooltip formatItem={(e) => ({ label: 'Submissions', value: e.value, color: COLOR_PRIMARY })} />}
        />
        <Bar dataKey="Submissions" fill="url(#dailyBar)" radius={[6, 6, 0, 0]} maxBarSize={40} animationDuration={700} animationEasing="ease-out" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Shared bits ─────────────────────────────────────────── */

const legendStyle: React.CSSProperties = { fontSize: 11, paddingTop: 4 };

/**
 * Themed tooltip — uses the app's surface/ink tokens so it has correct contrast
 * in both light and dark mode (the old inline `--surface-rgb` var didn't exist,
 * so it always fell back to white → unreadable on the dark theme).
 *
 * `formatItem` maps each payload entry to a label/value/dot color; `formatLabel`
 * builds the heading. Recharts injects `active`/`payload`/`label`.
 */
type TooltipFormat = { label?: React.ReactNode; value: React.ReactNode; color?: string } | null;
function ChartTooltip({
  active,
  payload,
  label,
  formatLabel,
  formatItem,
}: {
  active?: boolean;
  payload?: any[];
  label?: any;
  formatLabel?: (label: any, payload: any[]) => React.ReactNode;
  formatItem?: (entry: any) => TooltipFormat;
}) {
  if (!active || !payload?.length) return null;
  const heading = formatLabel ? formatLabel(label, payload) : label;
  return (
    <div className="rounded-lg border border-line bg-surface shadow-pop dark:shadow-pop-dark px-3 py-2 text-xs min-w-[130px]">
      {heading != null && heading !== '' && (
        <p className="font-semibold text-ink mb-1.5">{heading}</p>
      )}
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

/* ── Activity breakdown (client × location × sub-speciality) ──────── */

type BreakdownRange = 'today' | '7d' | 'month';

const RANGE_LABEL: Record<BreakdownRange, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  month: 'This month',
};

/** Inclusive [from,to] YYYY-MM-DD window for a range, relative to today. */
function rangeWindow(range: BreakdownRange): { from: string; to: string } {
  const now = new Date();
  const to = format(now, 'yyyy-MM-dd');
  const from =
    range === 'today'
      ? to
      : range === '7d'
      ? format(subDays(now, 6), 'yyyy-MM-dd')
      : format(startOfMonth(now), 'yyyy-MM-dd');
  return { from, to };
}

type BreakdownSortKey = 'client' | 'location' | 'subSpeciality' | 'charts' | 'decisions' | 'acceptance';

/** AI acceptance rate (%) for one breakdown row. */
function acceptancePctOf(r: QaActivityBreakdownRow): number {
  return r.decisions ? (r.accepted / r.decisions) * 100 : 0;
}

function ActivityBreakdownCard({
  rows,
  loading,
  fetching,
  range,
  onRangeChange,
  onExport,
  exporting,
}: {
  rows: QaActivityBreakdownRow[];
  loading: boolean;
  fetching: boolean;
  range: BreakdownRange;
  onRangeChange: (r: BreakdownRange) => void;
  onExport: (range: { from: string; to: string }) => void;
  exporting: boolean;
}) {
  const [sortBy, setSortBy] = useState<BreakdownSortKey>('decisions');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (key: BreakdownSortKey) => {
    if (key === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      // Text columns read best A→Z; numeric columns most-first.
      setSortDir(key === 'client' || key === 'location' || key === 'subSpeciality' ? 'asc' : 'desc');
    }
  };

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const val = (r: QaActivityBreakdownRow): string | number => {
      switch (sortBy) {
        case 'client': return (r.clientName ?? '').toLowerCase();
        case 'location': return (r.locationName ?? '').toLowerCase();
        case 'subSpeciality': return (r.subSpecialityName ?? '').toLowerCase();
        case 'charts': return r.charts;
        case 'decisions': return r.decisions;
        case 'acceptance': return acceptancePctOf(r);
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    });
  }, [rows, sortBy, sortDir]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.charts += r.charts;
          acc.decisions += r.decisions;
          acc.accepted += r.accepted;
          return acc;
        },
        { charts: 0, decisions: 0, accepted: 0 },
      ),
    [rows],
  );

  return (
    <Card padding="default">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h4 className="text-sm font-bold text-ink inline-flex items-center gap-1.5">
            <span className="text-ink-muted"><Building2 className="w-3.5 h-3.5" /></span>
            Activity by client / location / sub-speciality
          </h4>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Where AI suggestions are being worked, and the AI's acceptance rate in each — {RANGE_LABEL[range].toLowerCase()}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <BreakdownRangeToggle value={range} onChange={onRangeChange} />
          <ExportControl onExport={onExport} exporting={exporting} />
        </div>
      </div>

      {loading ? (
        <div className="h-[200px] flex items-center justify-center text-ink-muted">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="h-[200px] flex flex-col items-center justify-center text-center text-ink-muted">
          <p className="text-sm font-semibold text-ink">No activity {RANGE_LABEL[range].toLowerCase()}</p>
          <p className="text-[11px] mt-1">Nothing was coded in this period for the current Client / Location scope.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="overflow-x-auto max-h-[440px]">
            <table className="w-full text-sm">
              <thead className="bg-surface-sunken/40 sticky top-0 z-10">
                <tr className="text-left text-[10px] uppercase tracking-wide text-ink-muted">
                  <BreakdownTh label="Client" col="client" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <BreakdownTh label="Location" col="location" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <BreakdownTh label="Sub-speciality" col="subSpeciality" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <BreakdownTh label="Charts" col="charts" align="right" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <BreakdownTh label="Decisions" col="decisions" align="right" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <BreakdownTh label="Acceptance" col="acceptance" align="right" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => {
                  const pct = acceptancePctOf(r);
                  return (
                    <tr
                      key={`${r.clientId}-${r.locationId}-${r.subSpecialityId}-${i}`}
                      className="border-t border-line hover:bg-surface-sunken/40 transition"
                    >
                      <td className="px-3 py-2.5 text-ink font-medium whitespace-nowrap">
                        {r.clientName ?? <span className="text-ink-muted">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-ink whitespace-nowrap">
                        {r.locationName ?? <span className="text-ink-muted">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-ink whitespace-nowrap">
                        {r.subSpecialityName ?? <span className="text-ink-muted italic">Unassigned</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">{r.charts.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">{r.decisions.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right">
                        <AcceptancePill pct={pct} accepted={r.accepted} decisions={r.decisions} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-surface-sunken/30 text-[11px] font-bold text-ink">
                  <td className="px-3 py-2" colSpan={3}>
                    {rows.length} group{rows.length === 1 ? '' : 's'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{totals.charts.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{totals.decisions.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.decisions ? ((totals.accepted / totals.decisions) * 100).toFixed(1) : '0.0'}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {fetching && !loading && (
        <p className="text-[11px] text-ink-muted mt-2 inline-flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Updating…
        </p>
      )}
    </Card>
  );
}

function BreakdownTh({
  label,
  col,
  align = 'left',
  sortBy,
  sortDir,
  onSort,
}: {
  label: string;
  col: BreakdownSortKey;
  align?: 'left' | 'right';
  sortBy: BreakdownSortKey;
  sortDir: 'asc' | 'desc';
  onSort: (c: BreakdownSortKey) => void;
}) {
  const active = sortBy === col;
  return (
    <th className={cn('px-3 py-2.5 font-semibold', align === 'right' && 'text-right')}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={cn(
          'inline-flex items-center gap-1 select-none transition hover:text-ink uppercase',
          align === 'right' && 'flex-row-reverse',
          active && 'text-ink',
        )}
      >
        {label}
        {active ? (
          sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : (
          <ChevronsUpDown className="w-3 h-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

/** Acceptance-rate pill, tinted by how well the AI did in this group. */
function AcceptancePill({ pct, accepted, decisions }: { pct: number; accepted: number; decisions: number }) {
  const tone = pct >= 70 ? COLOR_ACCEPT : pct >= 40 ? COLOR_EDIT : COLOR_REJECT;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums"
      style={{ backgroundColor: `${tone}1A`, color: tone }}
      title={`${accepted.toLocaleString()} of ${decisions.toLocaleString()} AI suggestions accepted`}
    >
      {pct.toFixed(1)}%
    </span>
  );
}

function BreakdownRangeToggle({ value, onChange }: { value: BreakdownRange; onChange: (v: BreakdownRange) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface-sunken/40 p-0.5 text-[11px] font-semibold shrink-0">
      {(['today', '7d', 'month'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-pressed={value === m}
          className={cn(
            'px-2.5 py-1 rounded-md transition whitespace-nowrap',
            value === m ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
          )}
        >
          {RANGE_LABEL[m]}
        </button>
      ))}
    </div>
  );
}

/**
 * Custom-range export for the activity breakdown. Pick any [from,to] window in
 * the date picker, then hit Export to download the full per-encounter XLSX for
 * that window — independent of which range the table is showing. Defaults to the
 * last 7 days so it's ready to use; the button is disabled until a full range is
 * chosen and while an export is in flight.
 */
function ExportControl({
  onExport,
  exporting,
}: {
  onExport: (range: { from: string; to: string }) => void;
  exporting: boolean;
}) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [range, setRange] = useState<{ from: string | null; to: string | null }>(() => ({
    from: format(subDays(new Date(), 6), 'yyyy-MM-dd'),
    to: today,
  }));
  const canExport = !!range.from && !!range.to && !exporting;

  return (
    <div className="flex items-center gap-2 shrink-0">
      <RangeDatePicker
        value={range}
        onChange={setRange}
        placeholder="Pick dates…"
        max={today}
        className="w-[210px]"
      />
      <button
        type="button"
        onClick={() => {
          if (range.from && range.to) onExport({ from: range.from, to: range.to });
        }}
        disabled={!canExport}
        className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink-muted transition hover:text-ink disabled:opacity-60"
      >
        {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
        Export
      </button>
    </div>
  );
}

