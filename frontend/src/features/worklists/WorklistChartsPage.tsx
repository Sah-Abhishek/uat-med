import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getWorklist } from '@/api/worklists';
import { listCharts } from '@/api/charts';
import type { Chart } from '@/api/types';
import { useCan } from '@/hooks/useCan';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Pagination, Avatar } from '@/components/ui/Primitives';
import { ChartStatusChip, MilestoneChip, PriorityChip } from '@/components/ui/Chip';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { useTableSort, sortRows } from '@/hooks/useTableSort';
import { formatDate, formatNumber } from '@/lib/utils';
import { ArrowLeft, Loader2 } from 'lucide-react';

/** Renders an assignee cell: avatar + name, or a muted dash when unallocated. */
function Assignee({ name }: { name: string | null | undefined }) {
  if (!name) return <span className="text-ink-subtle text-xs">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <Avatar name={name} size="sm" />
      <span className="text-xs truncate max-w-[12rem]">{name}</span>
    </span>
  );
}

/**
 * Full charts table for a single worklist, with each chart's allocated coder
 * and auditor. Reached from the "View charts" button next to the Chart
 * allocations heading on the worklist detail page. Server-paginated; the
 * column-header sort reorders the page currently in view (same approach as the
 * Worklists list).
 */
export function WorklistChartsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canViewWorklist = useCan('worklist.view');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { sort, toggle: onSort } = useTableSort({ sortBy: undefined, sortDir: 'asc' });

  // Coders can't reach the worklist hierarchy; mirror the detail page's guard
  // so the route can't be opened by typing the URL.
  if (!canViewWorklist) return <Navigate to="/charts" replace />;

  const worklist = useQuery({
    queryKey: ['worklist', id],
    queryFn: () => getWorklist(id!),
    enabled: !!id,
  });

  const charts = useQuery({
    queryKey: ['charts', { worklistId: id, page, pageSize }],
    queryFn: () =>
      listCharts({
        worklistId: id,
        page,
        pageSize,
        sortBy: 'serialNo',
        sortDir: 'asc',
      }),
    enabled: !!id,
    placeholderData: (prev) => prev,
  });

  // Keep page in range if the worklist's chart count shrinks under us.
  useEffect(() => {
    setPage(1);
  }, [id, pageSize]);

  const totalPages = charts.data
    ? Math.max(1, Math.ceil(charts.data.total / pageSize))
    : 1;

  const sortedItems = sortRows(charts.data?.items ?? [], sort, {
    serialNo: (c: Chart) => c.serialNo,
    chartNo: (c: Chart) => c.chartNo ?? '',
    mrNumber: (c: Chart) => c.mrNumber ?? '',
    dateOfService: (c: Chart) => c.dateOfService ?? '',
    milestone: (c: Chart) => c.milestone,
    chartStatus: (c: Chart) => c.chartStatus,
    priority: (c: Chart) => c.priority,
    allocatedCoderName: (c: Chart) => c.allocatedCoderName ?? '',
    allocatedAuditorName: (c: Chart) => c.allocatedAuditorName ?? '',
  });

  const wlNumber = worklist.data?.worklistNumber;

  return (
    <div className="p-8 max-w-[1600px] space-y-6">
      <PageHeader
        title="Worklist Charts"
        subtitle={wlNumber ? `Worklist ${wlNumber}` : 'Charts and their assignees'}
        actions={
          <Button
            variant="soft"
            leftIcon={<ArrowLeft className="w-3.5 h-3.5" />}
            onClick={() => navigate(`/worklists/${id}`)}
          >
            Back to worklist
          </Button>
        }
      />

      <Card padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-line">
          <h2 className="text-[15px] font-bold text-ink">
            Charts ({formatNumber(charts.data?.total ?? 0)})
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr>
                <SortableHeader column="serialNo" sort={sort} onSort={onSort}>#</SortableHeader>
                <SortableHeader column="chartNo" sort={sort} onSort={onSort}>Chart #</SortableHeader>
                <SortableHeader column="mrNumber" sort={sort} onSort={onSort}>MRN</SortableHeader>
                <SortableHeader column="dateOfService" sort={sort} onSort={onSort}>Date of service</SortableHeader>
                <SortableHeader column="milestone" sort={sort} onSort={onSort}>Milestone</SortableHeader>
                <SortableHeader column="chartStatus" sort={sort} onSort={onSort}>Status</SortableHeader>
                <SortableHeader column="priority" sort={sort} onSort={onSort}>Priority</SortableHeader>
                <SortableHeader column="allocatedCoderName" sort={sort} onSort={onSort}>Coder</SortableHeader>
                <SortableHeader column="allocatedAuditorName" sort={sort} onSort={onSort}>Auditor</SortableHeader>
              </tr>
            </thead>
            <tbody>
              {charts.isPending ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-ink-muted">
                    <Loader2 className="w-5 h-5 animate-spin inline" />
                  </td>
                </tr>
              ) : charts.error ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-sm text-danger">
                    Couldn't load charts: {(charts.error as Error).message}
                  </td>
                </tr>
              ) : sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-20 text-center">
                    <p className="text-sm text-ink-muted">No charts in this worklist yet.</p>
                  </td>
                </tr>
              ) : (
                sortedItems.map((c) => (
                  <tr
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/charts/${c.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/charts/${c.id}`);
                      }
                    }}
                    className="group cursor-pointer hover:bg-surface-sunken/40 transition focus:outline-none focus-visible:bg-surface-sunken/40 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
                  >
                    <td className="table-cell text-ink-muted">{c.serialNo}</td>
                    <td className="table-cell font-bold">
                      <Link
                        to={`/charts/${c.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-ink group-hover:text-primary transition"
                      >
                        {c.chartNo ?? '—'}
                      </Link>
                    </td>
                    <td className="table-cell text-ink-muted">{c.mrNumber ?? '—'}</td>
                    <td className="table-cell text-ink-muted">{formatDate(c.dateOfService)}</td>
                    <td className="table-cell"><MilestoneChip milestone={c.milestone} /></td>
                    <td className="table-cell"><ChartStatusChip status={c.chartStatus} /></td>
                    <td className="table-cell"><PriorityChip priority={c.priority} /></td>
                    <td className="table-cell"><Assignee name={c.allocatedCoderName} /></td>
                    <td className="table-cell"><Assignee name={c.allocatedAuditorName} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          pageCount={totalPages}
          onPageChange={setPage}
          pageSize={pageSize}
          total={charts.data?.total}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      </Card>
    </div>
  );
}
