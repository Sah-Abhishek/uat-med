import { useQuery } from '@tanstack/react-query';
import {
  getMilestones,
  getStatus,
  getUnallocated,
  getSelfDashboard,
} from '@/api/dashboard';
import { useAuth } from '@/auth/store';
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

export function DashboardPage() {
  const user = useAuth((s) => s.user)!;
  const isTeam = can(user, 'dashboard.team');

  const self = useQuery({
    queryKey: ['dashboard', 'self'],
    queryFn: getSelfDashboard,
  });

  const milestones = useQuery({
    queryKey: ['dashboard', 'milestones'],
    queryFn: () => getMilestones(),
    enabled: isTeam,
  });

  const status = useQuery({
    queryKey: ['dashboard', 'status'],
    queryFn: () => getStatus(),
    enabled: isTeam,
  });

  const unallocated = useQuery({
    queryKey: ['dashboard', 'unallocated'],
    queryFn: () => getUnallocated(),
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
              />
              <TintedStatCard
                tint="indigo"
                value={milestones.data?.readyToCode ?? 0}
                label="Ready to Code"
                icon={<FileClock className="w-4 h-4" />}
              />
              <TintedStatCard
                tint="teal"
                value={milestones.data?.readyToAllocate ?? 0}
                label="Ready to Allocate"
                icon={<FileCheck2 className="w-4 h-4" />}
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
              />
              <IllustrationStatCard
                variant="incomplete"
                value={status.data?.incomplete ?? 0}
                label="Incomplete"
                sublabel="Today's Count"
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
              />
              <CoralPillStat
                value={`${formatNumber(unallocated.data?.charts.unallocated ?? 0)} of ${formatNumber(unallocated.data?.charts.total ?? 0)}`}
                label="Charts"
              />
            </div>
          </div>
        </div>
      ) : (
        <SelfOnlyTopRow
          data={self.data}
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
      {isTeam && (
        <div className="space-y-4">
          <CollapsibleCard
            title="Allocation Statistics"
            subtitle="(By default: Showing last 2 weeks data)"
          >
            <p className="text-sm text-ink-muted py-8 text-center">
              Chart panels render here — Charts by milestone, Chart completion donut, Quality
              control donut, Progress to date, Worklist by status. Hook up to{' '}
              <code className="font-mono text-xs">/dashboard/allocation-stats</code>.
            </p>
          </CollapsibleCard>

          <CollapsibleCard
            title="Unallocated Volume"
            subtitle="(By default: Showing last 2 weeks data)"
          >
            <p className="text-sm text-ink-muted py-8 text-center">
              By worklist / By speciality / By date received / By date of service — renders once
              chart endpoints are wired.
            </p>
          </CollapsibleCard>

          <CollapsibleCard
            title="Productivity"
            subtitle="(By default: Showing last 2 weeks data)"
          >
            <p className="text-sm text-ink-muted py-8 text-center">
              Average time to code a chart / Volume per day / Rework — renders once chart
              endpoints are wired.
            </p>
          </CollapsibleCard>
        </div>
      )}
    </div>
  );
}

/* Coder / Auditor — just their personal queue */
function SelfOnlyTopRow({ data }: { data: ReturnType<typeof useQuery>['data'] extends never ? never : import('@/api/types').DashboardSelf | undefined }) {
  const d = data;
  return (
    <div>
      <SectionLabel tone="primary">Your queue</SectionLabel>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <TintedStatCard tint="indigo" value={d?.readyToCode ?? 0} label="Ready to code" icon={<FileClock className="w-4 h-4" />} />
        <TintedStatCard tint="mint" value={d?.codingDoneToday ?? 0} label="Coding done today" icon={<FileCheck2 className="w-4 h-4" />} />
        <TintedStatCard tint="sky" value={d?.readyToAudit ?? 0} label="Ready to audit" icon={<FileSearch className="w-4 h-4" />} />
        <TintedStatCard tint="mint" value={d?.auditDoneToday ?? 0} label="Audit done today" icon={<FileCheck2 className="w-4 h-4" />} />
        <TintedStatCard tint="mint" value={d?.completeToday ?? 0} label="Complete today" icon={<FileCheck2 className="w-4 h-4" />} />
        <TintedStatCard tint="butter" value={d?.incompleteToday ?? 0} label="Incomplete today" icon={<FileClock className="w-4 h-4" />} />
      </div>
    </div>
  );
}
