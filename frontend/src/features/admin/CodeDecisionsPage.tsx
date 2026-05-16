import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Field';
import { PillBadge, Pagination } from '@/components/ui/Primitives';
import {
  listChartsWithDecisions,
  type AdminChartWithDecisions,
  type DecisionVerdict,
  type ListChartsWithDecisionsParams,
} from '@/api/admin';
import { listUsers } from '@/api/users';
import { formatDateTime } from '@/lib/utils';

const DECISIONS: Array<{ value: DecisionVerdict; label: string }> = [
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'EDITED', label: 'Edited' },
  { value: 'ADDED', label: 'Added' },
];

export function CodeDecisionsPage() {
  const [params, setParams] = useSearchParams();

  const filters: ListChartsWithDecisionsParams = useMemo(
    () => ({
      chartNo: params.get('chartNo') || undefined,
      coderId: params.get('coderId') ? Number(params.get('coderId')) : undefined,
      decision: (params.get('decision') as DecisionVerdict) || undefined,
      from: params.get('from') || undefined,
      to: params.get('to') || undefined,
      page: params.get('page') ? Number(params.get('page')) : 1,
      pageSize: 25,
    }),
    [params],
  );

  const updateFilters = (patch: Partial<ListChartsWithDecisionsParams>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '' || v === null) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const resetFilters = () => setParams(new URLSearchParams(), { replace: true });

  const q = useQuery({
    queryKey: ['admin', 'charts-with-decisions', filters],
    queryFn: () => listChartsWithDecisions(filters),
    placeholderData: (prev) => prev,
  });

  const reviewersQ = useQuery({
    queryKey: ['admin', 'charts-with-decisions', 'reviewers'],
    queryFn: () =>
      listUsers({ pageSize: 200, role: 'CODER' }).then(async (coders) => {
        const auditors = await listUsers({ pageSize: 200, role: 'AUDITOR' });
        return [...coders.items, ...auditors.items];
      }),
    staleTime: 60_000,
  });

  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / 25)) : 1;

  return (
    <div className="p-8 max-w-[1600px] space-y-5">
      <PageHeader
        title="Code decisions"
        subtitle="Charts whose codes have been reviewed. Click a chart to see what the AI predicted and what the coder did."
      />

      <Card padding="default">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
          <div>
            <Label>Chart #</Label>
            <Input
              placeholder="e.g. DIAG-001"
              value={filters.chartNo ?? ''}
              onChange={(e) => updateFilters({ chartNo: e.target.value || undefined })}
            />
          </div>
          <div>
            <Label>Coder / Auditor</Label>
            <Select
              value={filters.coderId ?? ''}
              onChange={(e) =>
                updateFilters({ coderId: e.target.value ? Number(e.target.value) : undefined })
              }
            >
              <option value="">All reviewers</option>
              {reviewersQ.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName ?? u.email} ({u.role})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Has decision type</Label>
            <Select
              value={filters.decision ?? ''}
              onChange={(e) =>
                updateFilters({ decision: (e.target.value || undefined) as DecisionVerdict | undefined })
              }
            >
              <option value="">Any</option>
              {DECISIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Last decided ≥</Label>
            <Input
              type="date"
              value={filters.from ?? ''}
              onChange={(e) => updateFilters({ from: e.target.value || undefined })}
            />
          </div>
          <div>
            <Label>Last decided ≤</Label>
            <Input
              type="date"
              value={filters.to ?? ''}
              onChange={(e) => updateFilters({ to: e.target.value || undefined })}
            />
          </div>
          <div className="flex items-end">
            <Button variant="ghost" onClick={resetFilters} className="w-full">
              Reset
            </Button>
          </div>
        </div>
      </Card>

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px]">
            <thead>
              <tr>
                <th className="table-head">Chart</th>
                <th className="table-head">Milestone / Status</th>
                <th className="table-head">Reviewer(s)</th>
                <th className="table-head text-right">Decisions</th>
                <th className="table-head">Breakdown</th>
                <th className="table-head">AI sync</th>
                <th className="table-head">Last decided</th>
              </tr>
            </thead>
            <tbody>
              {q.isPending && !q.data ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`skel-${i}`} className="border-b border-line/60">
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j} className="table-cell">
                        <div className="h-3 w-24 rounded bg-surface-sunken animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : q.data?.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-20 text-center text-sm text-ink-muted">
                    No charts match the current filters.
                  </td>
                </tr>
              ) : (
                q.data?.items.map((row) => <ChartRow key={row.chartId} row={row} />)
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={filters.page ?? 1}
          pageCount={totalPages}
          onPageChange={(p) => updateFilters({ page: p })}
          pageSize={25}
          total={q.data?.total}
        />
      </Card>
    </div>
  );
}

function ChartRow({ row }: { row: AdminChartWithDecisions }) {
  return (
    <tr className="border-b border-line/60 hover:bg-surface-sunken/40 transition">
      <td className="table-cell">
        <Link
          to={`/admin/code-decisions/charts/${row.chartId}`}
          className="font-mono text-sm font-semibold text-primary hover:underline"
        >
          {row.chartNo ?? `#${row.chartId}`}
        </Link>
      </td>
      <td className="table-cell">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-ink">{humanize(row.milestone)}</span>
          <span className="text-[11px] text-ink-subtle">{row.chartStatus}</span>
        </div>
      </td>
      <td className="table-cell">
        <span className="text-sm text-ink">{row.coderNames || '—'}</span>
        {row.coderCount > 1 && (
          <span className="ml-2 text-[11px] text-ink-subtle">×{row.coderCount}</span>
        )}
      </td>
      <td className="table-cell text-right font-mono">{row.totalDecisions}</td>
      <td className="table-cell">
        <div className="flex flex-wrap gap-1">
          {row.accepted > 0 && <PillBadge tone="mint">{row.accepted} Accepted</PillBadge>}
          {row.rejected > 0 && <PillBadge tone="coral">{row.rejected} Rejected</PillBadge>}
          {row.edited > 0 && <PillBadge tone="butter">{row.edited} Edited</PillBadge>}
          {row.added > 0 && <PillBadge tone="sky">{row.added} Added</PillBadge>}
        </div>
      </td>
      <td className="table-cell"><SyncSummary row={row} /></td>
      <td className="table-cell text-xs text-ink-muted whitespace-nowrap">
        {formatDateTime(row.lastDecidedAt)}
      </td>
    </tr>
  );
}

function SyncSummary({ row }: { row: AdminChartWithDecisions }) {
  const expectedSyncable = row.rejected + row.edited + row.added;
  // No corrections to track at all (only ACCEPTs on this chart) — surface as informational.
  if (expectedSyncable === 0) {
    return <PillBadge tone="sky">All ACCEPT</PillBadge>;
  }
  if (row.notSyncedCount === 0) {
    return <PillBadge tone="mint">{row.syncedCount}/{expectedSyncable} synced</PillBadge>;
  }
  return (
    <PillBadge tone="coral">
      {row.syncedCount}/{expectedSyncable} synced · {row.notSyncedCount} missing
    </PillBadge>
  );
}

function humanize(s: string | null): string {
  if (!s) return '—';
  return s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
