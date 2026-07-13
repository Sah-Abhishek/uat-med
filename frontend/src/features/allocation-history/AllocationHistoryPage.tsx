import { useMemo } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, History, RefreshCw } from 'lucide-react';

import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Field';
import { PillBadge, Pagination } from '@/components/ui/Primitives';
import { useCan } from '@/hooks/useCan';
import { listUsers } from '@/api/users';
import {
  listAllocationHistory,
  allocationSourceLabel,
  ALLOCATION_SOURCE_LABELS,
  type AllocationEventRow,
  type AllocationParty,
  type AllocationRole,
  type AllocationSource,
  type ListAllocationHistoryParams,
} from '@/api/allocation-history';
import { formatDateTime } from '@/lib/utils';

const PAGE_SIZE = 25;

const ROLES: Array<{ value: AllocationRole; label: string }> = [
  { value: 'CODER', label: 'Coder' },
  { value: 'AUDITOR', label: 'Auditor' },
];

const SOURCES = Object.entries(ALLOCATION_SOURCE_LABELS) as Array<[AllocationSource, string]>;

export function AllocationHistoryPage() {
  // Manager-exclusive: Team Leads are deliberately excluded (the backend also
  // enforces this with a dedicated ManagerOnlyGuard). Gate before mounting the
  // data-fetching content so no query fires for an unauthorized viewer.
  const canView = useCan('allocation.audit.view');
  if (!canView) return <Navigate to="/" replace />;
  return <AllocationHistoryContent />;
}

function AllocationHistoryContent() {
  const [params, setParams] = useSearchParams();

  const filters: ListAllocationHistoryParams = useMemo(
    () => ({
      chartNo: params.get('chartNo') || undefined,
      role: (params.get('role') as AllocationRole) || undefined,
      source: (params.get('source') as AllocationSource) || undefined,
      userId: params.get('userId') ? Number(params.get('userId')) : undefined,
      changedById: params.get('changedById') ? Number(params.get('changedById')) : undefined,
      from: params.get('from') || undefined,
      to: params.get('to') || undefined,
      page: params.get('page') ? Number(params.get('page')) : 1,
      pageSize: PAGE_SIZE,
    }),
    [params],
  );

  const updateFilters = (patch: Partial<ListAllocationHistoryParams>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '' || v === null) next.delete(k);
      else next.set(k, String(v));
    }
    // Any filter change resets to page 1 (unless the change *is* a page change).
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const resetFilters = () => setParams(new URLSearchParams(), { replace: true });

  const q = useQuery({
    queryKey: ['allocation-history', filters],
    queryFn: () => listAllocationHistory(filters),
    placeholderData: (prev) => prev,
  });

  // One list of everyone for both the "user involved" and "changed by" pickers
  // (actors can be any role; participants are coders/auditors/admins).
  const usersQ = useQuery({
    queryKey: ['allocation-history', 'users'],
    queryFn: () => listUsers({ pageSize: 500 }).then((r) => r.items),
    staleTime: 60_000,
  });

  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="p-8 max-w-[1600px] space-y-5">
      <PageHeader
        title="Allocation history"
        subtitle="Audit trail of every coder/auditor allocation change across all charts — which chart moved, from and to whom, who did it, and how."
        actions={
          <button
            type="button"
            onClick={() => q.refetch()}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-pill border border-line text-sm font-semibold text-ink hover:bg-surface-2 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${q.isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      <Card padding="default">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          <div>
            <Label>Chart #</Label>
            <Input
              placeholder="e.g. DIAG-001"
              value={filters.chartNo ?? ''}
              onChange={(e) => updateFilters({ chartNo: e.target.value || undefined })}
            />
          </div>
          <div>
            <Label>Role</Label>
            <Select
              value={filters.role ?? ''}
              onChange={(e) => updateFilters({ role: (e.target.value || undefined) as AllocationRole | undefined })}
            >
              <option value="">Any</option>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Source</Label>
            <Select
              value={filters.source ?? ''}
              onChange={(e) => updateFilters({ source: (e.target.value || undefined) as AllocationSource | undefined })}
            >
              <option value="">Any</option>
              {SOURCES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>User involved</Label>
            <Select
              value={filters.userId ?? ''}
              onChange={(e) => updateFilters({ userId: e.target.value ? Number(e.target.value) : undefined })}
            >
              <option value="">Anyone (from / to)</option>
              {usersQ.data?.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName ?? u.email} ({u.role})</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Changed by</Label>
            <Select
              value={filters.changedById ?? ''}
              onChange={(e) => updateFilters({ changedById: e.target.value ? Number(e.target.value) : undefined })}
            >
              <option value="">Any actor</option>
              {usersQ.data?.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName ?? u.email} ({u.role})</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>From</Label>
            <Input
              type="date"
              value={filters.from ?? ''}
              onChange={(e) => updateFilters({ from: e.target.value || undefined })}
            />
          </div>
          <div>
            <Label>To</Label>
            <Input
              type="date"
              value={filters.to ?? ''}
              onChange={(e) => updateFilters({ to: e.target.value || undefined })}
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" onClick={resetFilters}>Reset filters</Button>
        </div>
      </Card>

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px]">
            <thead>
              <tr>
                <th className="table-head">When</th>
                <th className="table-head">Chart</th>
                <th className="table-head">Client / Location</th>
                <th className="table-head">Role</th>
                <th className="table-head">From → To</th>
                <th className="table-head">Changed by</th>
                <th className="table-head">Source</th>
                <th className="table-head">Milestone / Status</th>
              </tr>
            </thead>
            <tbody>
              {q.isPending && !q.data ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`skel-${i}`} className="border-b border-line/60">
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="table-cell">
                        <div className="h-3 w-24 rounded bg-surface-sunken animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : q.isError ? (
                <tr>
                  <td colSpan={8} className="py-20 text-center text-sm text-danger">
                    Failed to load allocation history.
                  </td>
                </tr>
              ) : q.data?.items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-20 text-center">
                    <History className="w-6 h-6 text-ink-subtle mx-auto mb-2" />
                    <p className="text-sm font-semibold text-ink">No allocation changes match the current filters</p>
                    <p className="text-[11px] text-ink-muted mt-1">
                      History accrues from the feature's deploy onward — earlier moves aren't backfilled.
                    </p>
                  </td>
                </tr>
              ) : (
                q.data?.items.map((row) => <EventRow key={row.id} row={row} />)
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={filters.page ?? 1}
          pageCount={totalPages}
          onPageChange={(p) => updateFilters({ page: p })}
          pageSize={PAGE_SIZE}
          total={q.data?.total}
        />
      </Card>
    </div>
  );
}

function EventRow({ row }: { row: AllocationEventRow }) {
  return (
    <tr className="border-b border-line/60 hover:bg-surface-sunken/40 transition">
      <td className="table-cell text-xs text-ink-muted whitespace-nowrap">
        {formatDateTime(row.at)}
      </td>
      <td className="table-cell">
        <Link
          to={`/charts/${row.chartId}`}
          className="font-mono text-sm font-semibold text-primary hover:underline"
        >
          {row.chartNo ?? `#${row.chartId}`}
        </Link>
        {row.worklistNumber && (
          <span className="block text-[10px] text-ink-subtle">{row.worklistNumber}</span>
        )}
      </td>
      <td className="table-cell text-xs text-ink-muted whitespace-nowrap">
        {row.clientName ?? '—'}
        {row.locationName ? <span className="text-ink-subtle"> · {row.locationName}</span> : null}
      </td>
      <td className="table-cell">
        <PillBadge tone={row.role === 'AUDITOR' ? 'sky' : 'mint'}>
          {row.role === 'AUDITOR' ? 'Auditor' : 'Coder'}
        </PillBadge>
      </td>
      <td className="table-cell">
        <span className="inline-flex items-center gap-1.5 text-sm">
          <PartyName party={row.from} muted />
          <ArrowRight className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
          <PartyName party={row.to} />
        </span>
      </td>
      <td className="table-cell text-sm text-ink">
        <PartyName party={row.changedBy} />
      </td>
      <td className="table-cell">
        <PillBadge tone="butter">{allocationSourceLabel(row.source)}</PillBadge>
      </td>
      <td className="table-cell">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-ink">{humanize(row.milestone)}</span>
          <span className="text-[11px] text-ink-subtle">{humanize(row.chartStatus)}</span>
        </div>
      </td>
    </tr>
  );
}

/** A user name (or "Unassigned" for a null slot). `muted` styles the "from" side. */
function PartyName({ party, muted }: { party: AllocationParty | null; muted?: boolean }) {
  if (!party) {
    return <span className="text-xs italic text-ink-subtle">Unassigned</span>;
  }
  return (
    <span className={muted ? 'text-ink-muted' : 'text-ink font-medium'}>
      {party.name ?? `User #${party.id}`}
    </span>
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
