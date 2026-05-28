import { useQuery } from '@tanstack/react-query';
import {
  getMilestones,
  getStatus,
  getUnallocated,
  getSelfDashboard,
  getAllocationStats,
  getUnallocatedVolume,
  getProductivity,
} from '@/api/dashboard';
import { useAuth } from '@/auth/store';
import { useScope } from '@/scope/store';
import { can } from '@/permissions';
import { PageHeader, SectionLabel } from '@/components/layout/PageHeader';
import { TintedStatCard, IllustrationStatCard, CoralPillStat } from '@/components/ui/StatCards';
import { Card, CollapsibleCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Label, Select, Input } from '@/components/ui/Field';
import { Link } from 'react-router-dom';
import {
  Clock3,
  FileCheck2,
  FileClock,
  FileSearch,
  FileInput,
  Filter as FilterIcon,
  ArrowUpRight,
} from 'lucide-react';
import { formatDateTime, formatNumber } from '@/lib/utils';
import {
  ChartCard,
  CHART_COLORS,
  DailyAreaChart,
  DailyLineChart,
  DonutChart,
  HorizontalBar,
  VerticalBar,
} from './Charts';

export function DashboardPage() {
  const user = useAuth((s) => s.user)!;
  const isTeam = can(user, 'dashboard.team');
  // Global Client / Location scope from the header.
  const clientId = useScope((s) => s.clientId);
  const locationId = useScope((s) => s.locationId);
  const scope = {
    ...(clientId != null ? { clientId } : {}),
    ...(locationId != null ? { locationId } : {}),
  };

  const self = useQuery({
    queryKey: ['dashboard', 'self'],
    queryFn: getSelfDashboard,
  });

  const milestones = useQuery({
    queryKey: ['dashboard', 'milestones', clientId, locationId],
    queryFn: () => getMilestones(scope),
    enabled: isTeam,
  });

  const status = useQuery({
    queryKey: ['dashboard', 'status', clientId, locationId],
    queryFn: () => getStatus(scope),
    enabled: isTeam,
  });

  const unallocated = useQuery({
    queryKey: ['dashboard', 'unallocated', clientId, locationId],
    queryFn: () => getUnallocated(scope),
    enabled: isTeam,
  });

  return (
    <div className="p-8 max-w-[1600px] space-y-6">
      <PageHeader title="Dashboard" subtitle="Dashboard" />

      {/* Resume-coding banner */}
      {self.data?.inProgressChart && (
        <Link
          to={`/charts/${self.data.inProgressChart.id}`}
          className="flex items-center gap-4 card p-4 border-primary/30 bg-primary-soft hover:shadow-pop dark:hover:shadow-pop-dark transition group"
        >
          <div className="w-10 h-10 rounded-full bg-primary text-primary-ink flex items-center justify-center">
            <Clock3 className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink">
              Resume coding{' '}
              <span className="font-mono">{self.data.inProgressChart.chartNo}</span>
            </p>
            <p className="text-xs text-ink-muted mt-0.5">
              Started {formatDateTime(self.data.inProgressStartedAt)}
            </p>
          </div>
          <ArrowUpRight className="w-4 h-4 text-primary-ink opacity-0 group-hover:opacity-100 transition" />
        </Link>
      )}

      {/* ── Top stat row: Milestones / Status / Unallocated ─ */}
      {isTeam ? (
        <div className="grid grid-cols-12 gap-4">
          {/* Milestones — 3 tinted tiles, spans 5 */}
          <div className="col-span-12 lg:col-span-5">
            <SectionLabel tone="primary">Milestones</SectionLabel>
            <div className="grid grid-cols-3 gap-3">
              <TintedStatCard
                tint="taupe"
                value={milestones.data?.inProgress ?? 0}
                label="In Progress"
                icon={<FileInput className="w-4 h-4" />}
                loading={milestones.isPending}
              />
              <TintedStatCard
                tint="indigo"
                value={milestones.data?.readyToCode ?? 0}
                label="Ready to Code"
                icon={<FileClock className="w-4 h-4" />}
                loading={milestones.isPending}
              />
              <TintedStatCard
                tint="teal"
                value={milestones.data?.readyToAllocate ?? 0}
                label="Ready to Allocate"
                icon={<FileCheck2 className="w-4 h-4" />}
                loading={milestones.isPending}
              />
            </div>
          </div>

          {/* Status — 2 illustration tiles, spans 5 */}
          <div className="col-span-12 lg:col-span-5">
            <SectionLabel tone="danger">Status</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <IllustrationStatCard
                variant="complete"
                value={status.data?.complete ?? 0}
                label="Complete"
                sublabel="Today's Count"
                loading={status.isPending}
              />
              <IllustrationStatCard
                variant="incomplete"
                value={status.data?.incomplete ?? 0}
                label="Incomplete"
                sublabel="Today's Count"
                loading={status.isPending}
              />
            </div>
          </div>

          {/* Unallocated — 2 coral pills stacked, spans 2 */}
          <div className="col-span-12 lg:col-span-2">
            <SectionLabel tone="danger">Unallocated</SectionLabel>
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
              <CoralPillStat
                value={`${formatNumber(unallocated.data?.worklists.unallocated ?? 0)} of ${formatNumber(unallocated.data?.worklists.total ?? 0)}`}
                label="Worklists"
                loading={unallocated.isPending}
              />
              <CoralPillStat
                value={`${formatNumber(unallocated.data?.charts.unallocated ?? 0)} of ${formatNumber(unallocated.data?.charts.total ?? 0)}`}
                label="Charts"
                loading={unallocated.isPending}
              />
            </div>
          </div>
        </div>
      ) : (
        <SelfOnlyTopRow
          data={self.data}
          loading={self.isPending}
        />
      )}

      {/* ── Global filter bar ───────────────────────────── */}
      {isTeam && (
        <Card padding="default">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <div>
              <Label>Location</Label>
              <Select placeholder="Select...">
                <option value="">All</option>
              </Select>
            </div>
            <div>
              <Label>Primary Speciality</Label>
              <Select placeholder="Select...">
                <option value="">All</option>
              </Select>
            </div>
            <div>
              <Label>Worklist</Label>
              <Select placeholder="Select...">
                <option value="">All</option>
              </Select>
            </div>
            <div>
              <Label>Date received</Label>
              <Input type="date" />
            </div>
            <div>
              <Label>Date of service</Label>
              <Input type="date" />
            </div>
          </div>
          <div className="flex justify-end mt-5">
            <Button leftIcon={<FilterIcon className="w-3.5 h-3.5" />}>Filter</Button>
          </div>
        </Card>
      )}

      {/* ── Analytics sections ──────────────────────────── */}
      {isTeam && <AnalyticsPanels />}
    </div>
  );
}

/* ── Analytics: 3 collapsible cards × N chart tiles each ─ */

function AnalyticsPanels() {
  // Scope the analytics panels by the global header Client / Location filter.
  const clientId = useScope((s) => s.clientId);
  const locationId = useScope((s) => s.locationId);
  const filters = {
    ...(clientId != null ? { clientId } : {}),
    ...(locationId != null ? { locationId } : {}),
  };

  const allocation = useQuery({
    queryKey: ['dashboard', 'allocation-stats', filters],
    queryFn: () => getAllocationStats(filters),
  });
  const unallocVol = useQuery({
    queryKey: ['dashboard', 'unallocated-volume', filters],
    queryFn: () => getUnallocatedVolume(filters),
  });
  const productivity = useQuery({
    queryKey: ['dashboard', 'productivity', filters],
    queryFn: () => getProductivity(filters),
  });

  const a = allocation.data;
  const u = unallocVol.data;
  const p = productivity.data;

  // Pre-shape data each render — recharts wants plain `[{name,value}]` arrays
  // and human-readable labels for milestones (READY_TO_CODE → "Ready to Code").
  const milestoneRows = (a?.chartsByMilestone ?? []).map((r) => ({
    milestone: humanizeMilestone(r.milestone),
    count: r.count,
  }));
  const completionDonut = a
    ? toDonut({ Complete: a.chartCompletion.complete, Incomplete: a.chartCompletion.incomplete, Open: a.chartCompletion.open, Hold: a.chartCompletion.hold })
    : [];
  const qcDonut = a
    ? toDonut({
        'Feedback Provided': a.qualityControl.feedbackProvided,
        Agree: a.qualityControl.agree,
        Rejected: a.qualityControl.feedbackRejected,
        Implemented: a.qualityControl.feedbackImplemented,
        Unaudited: a.qualityControl.unaudited,
      })
    : [];
  const wlDonut = a
    ? toDonut({ Open: a.worklistByStatus.open, 'In Progress': a.worklistByStatus.inProgress, Closed: a.worklistByStatus.closed })
    : [];
  const specialityDonut = (u?.bySpeciality ?? []).map((r) => ({ name: r.speciality, value: r.count }));

  return (
    <div className="space-y-4">
      <CollapsibleCard
        title="Allocation Statistics"
        subtitle="Last 14 days · click a section to drill in"
        defaultOpen
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 pt-2">
          <ChartCard
            title="Charts by Milestone"
            subtitle="Across the entire org"
            loading={allocation.isPending}
            empty={!allocation.isPending && milestoneRows.every((r) => r.count === 0)}
          >
            <HorizontalBar data={milestoneRows} xKey="count" yKey="milestone" color={CHART_COLORS.primary} />
          </ChartCard>

          <ChartCard
            title="Chart Completion"
            subtitle="By chart status"
            loading={allocation.isPending}
            empty={completionDonut.length === 0}
          >
            <DonutChart data={completionDonut} />
          </ChartCard>

          <ChartCard
            title="Quality Control"
            subtitle="Auditor feedback distribution"
            loading={allocation.isPending}
            empty={qcDonut.length === 0}
          >
            <DonutChart data={qcDonut} />
          </ChartCard>

          <ChartCard
            title="Worklist by Status"
            loading={allocation.isPending}
            empty={wlDonut.length === 0}
          >
            <DonutChart data={wlDonut} />
          </ChartCard>

          <ChartCard
            title="Progress to Date"
            subtitle="Charts closed per day"
            loading={allocation.isPending}
            empty={(a?.progressToDate ?? []).every((r) => r.count === 0)}
          >
            <DailyAreaChart data={a?.progressToDate ?? []} color={CHART_COLORS.success} />
          </ChartCard>
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        title="Unallocated Volume"
        subtitle="Open charts with no coder assigned"
        defaultOpen
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
          <ChartCard
            title="By Worklist"
            subtitle="Top 10"
            loading={unallocVol.isPending}
            empty={(u?.byWorklist ?? []).length === 0}
            height={300}
          >
            <HorizontalBar data={u?.byWorklist ?? []} xKey="count" yKey="worklist" color={CHART_COLORS.danger} />
          </ChartCard>

          <ChartCard
            title="By Speciality"
            loading={unallocVol.isPending}
            empty={specialityDonut.length === 0}
            height={300}
          >
            <DonutChart data={specialityDonut} />
          </ChartCard>

          <ChartCard
            title="By Date Received"
            subtitle="Worklist receive dates, last 14 days"
            loading={unallocVol.isPending}
            empty={(u?.byReceivedDate ?? []).every((r) => r.count === 0)}
          >
            <VerticalBar data={u?.byReceivedDate ?? []} xKey="date" yKey="count" color={CHART_COLORS.warn} />
          </ChartCard>

          <ChartCard
            title="By Date of Service"
            subtitle="Last 14 days"
            loading={unallocVol.isPending}
            empty={(u?.byDateOfService ?? []).every((r) => r.count === 0)}
          >
            <VerticalBar data={u?.byDateOfService ?? []} xKey="date" yKey="count" color={CHART_COLORS.indigo} />
          </ChartCard>
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="Productivity" subtitle="Last 14 days" defaultOpen>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-2">
          <ChartCard
            title="Volume per Day"
            subtitle="Charts closed per day"
            loading={productivity.isPending}
            empty={(p?.volumePerDay ?? []).every((r) => r.count === 0)}
          >
            <VerticalBar data={p?.volumePerDay ?? []} xKey="date" yKey="count" color={CHART_COLORS.success} />
          </ChartCard>

          <ChartCard
            title="Avg Time to Code"
            subtitle="Minutes per chart, daily average"
            loading={productivity.isPending}
            empty={(p?.avgCodingMinutes ?? []).every((r) => r.value === 0)}
          >
            <DailyLineChart data={p?.avgCodingMinutes ?? []} xKey="date" yKey="value" color={CHART_COLORS.warn} />
          </ChartCard>

          <ChartCard
            title="Rework"
            subtitle="Charts re-opened from coding-done"
            loading={productivity.isPending}
            empty={false}
            height={260}
          >
            <ReworkStat count={p?.reworkCount ?? 0} />
          </ChartCard>
        </div>
      </CollapsibleCard>
    </div>
  );
}

/** Big-number tile for the single-value rework metric. */
function ReworkStat({ count }: { count: number }) {
  const tone = count === 0 ? 'text-success' : count < 5 ? 'text-warn' : 'text-danger';
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <p className={`text-6xl font-bold ${tone}`}>{formatNumber(count)}</p>
      <p className="text-xs text-ink-muted mt-2">
        {count === 0
          ? 'No charts in rework. Nice work.'
          : count === 1
          ? '1 chart needs another pass.'
          : `${formatNumber(count)} charts need another pass.`}
      </p>
    </div>
  );
}

function toDonut(map: Record<string, number>): Array<{ name: string; value: number }> {
  return Object.entries(map)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));
}

function humanizeMilestone(m: string): string {
  return m
    .toLowerCase()
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

/* Coder / Auditor — just their personal queue */
function SelfOnlyTopRow({ data, loading }: { data: ReturnType<typeof useQuery>['data'] extends never ? never : import('@/api/types').DashboardSelf | undefined; loading?: boolean }) {
  const d = data;
  return (
    <div>
      <SectionLabel tone="primary">Your queue</SectionLabel>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <TintedStatCard tint="indigo" value={d?.readyToCode ?? 0} label="Ready to code" icon={<FileClock className="w-4 h-4" />} loading={loading} />
        <TintedStatCard tint="mint" value={d?.codingDoneToday ?? 0} label="Coding done today" icon={<FileCheck2 className="w-4 h-4" />} loading={loading} />
        <TintedStatCard tint="sky" value={d?.readyToAudit ?? 0} label="Ready to audit" icon={<FileSearch className="w-4 h-4" />} loading={loading} />
        <TintedStatCard tint="mint" value={d?.auditDoneToday ?? 0} label="Audit done today" icon={<FileCheck2 className="w-4 h-4" />} loading={loading} />
        <TintedStatCard tint="mint" value={d?.completeToday ?? 0} label="Complete today" icon={<FileCheck2 className="w-4 h-4" />} loading={loading} />
        <TintedStatCard tint="butter" value={d?.incompleteToday ?? 0} label="Incomplete today" icon={<FileClock className="w-4 h-4" />} loading={loading} />
      </div>
    </div>
  );
}
