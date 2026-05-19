import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import {
  listCharts,
  getChartsSummary,
  bulkModifyCharts,
  selfAllocateCharts,
  getActiveTimer,
  type AllocationAction,
  type BulkModifyDto,
  type ChartListParams,
} from '@/api/charts';
import { listUsers } from '@/api/users';
import type { ApiErrorShape, Priority } from '@/api/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, SearchInput, Radio } from '@/components/ui/Field';
import {
  Modal,
  ModalFooter,
  Pagination,
  Tabs,
  ConfirmModal,
  PillBadge,
  Avatar,
} from '@/components/ui/Primitives';
import {
  AiStatusChip,
  ChartStatusChip,
  MilestoneChip,
  PriorityChip,
} from '@/components/ui/Chip';
import { deriveAiStatus, type AiStatus, type Chart } from '@/api/types';

// Row tints by AI pipeline status. Each row gets the same soft token the
// AI chip uses plus a 4px inset accent on the leading edge so the state
// is identifiable at a glance. Tokens resolve to saturated dark variants
// automatically (see :root / .dark in global.css).
const AI_ROW_TINT: Record<AiStatus, string> = {
  NONE: 'hover:bg-surface-sunken/40',
  QUEUED:
    'bg-info-soft/80 hover:bg-info-soft shadow-[inset_4px_0_0_0_theme(colors.info.DEFAULT)]',
  PROCESSING:
    'bg-warn-soft/80 hover:bg-warn-soft shadow-[inset_4px_0_0_0_theme(colors.warn.DEFAULT)]',
  DONE:
    'bg-success-soft/70 hover:bg-success-soft shadow-[inset_4px_0_0_0_theme(colors.success.DEFAULT)]',
  ERRORED:
    'bg-danger-soft/80 hover:bg-danger-soft shadow-[inset_4px_0_0_0_theme(colors.danger.DEFAULT)]',
};
import { useAuth } from '@/auth/store';
import { can } from '@/permissions';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import {
  Filter as FilterIcon,
  Columns3,
  Sparkles,
  ChevronsUpDown,
  UserPlus,
  Clock,
  ChevronRight,
} from 'lucide-react';

const PRIORITY_TABS: Array<{ key: 'ALL' | Priority; label: string }> = [
  { key: 'ALL', label: 'All Priorities' },
  { key: 'CRITICAL', label: 'Critical' },
  { key: 'HIGH', label: 'High' },
  { key: 'MEDIUM', label: 'Medium' },
  { key: 'LOW', label: 'Low' },
  // Stored as FINALIZED in the DB; rendered as "Done" everywhere in the UI.
  { key: 'FINALIZED', label: 'Done' },
];

/* ── Configurable column catalog ──────────────────────────
 * Each entry pairs a label with a renderer; visibility is toggled from the
 * Columns popover and persisted in localStorage so each user keeps their own
 * layout. Keep in sync with the backend `GET /charts` projection — keys here
 * must match the fields the list endpoint actually returns.
 * ────────────────────────────────────────────────────────── */
interface ColumnDef {
  key: string;
  label: string;
  defaultVisible: boolean;
  render: (c: Chart) => React.ReactNode;
}

function dash(node: React.ReactNode): React.ReactNode {
  return node === null || node === undefined || node === '' ? (
    <span className="text-ink-subtle text-xs">—</span>
  ) : (
    node
  );
}

const CHART_COLUMNS: ColumnDef[] = [
  {
    key: 'location',
    label: 'Location',
    defaultVisible: true,
    render: (c) => dash(c.locationName),
  },
  {
    key: 'client',
    label: 'Client',
    defaultVisible: true,
    render: (c) => dash(c.clientName),
  },
  {
    key: 'specialty',
    label: 'Specialty',
    defaultVisible: false,
    render: (c) => dash(c.specialityName),
  },
  {
    key: 'chartNo',
    label: 'Chart No.',
    defaultVisible: true,
    render: (c) => (
      <Link to={`/charts/${c.id}`} className="text-ink hover:text-primary font-bold transition">
        {c.chartNo ?? '—'}
      </Link>
    ),
  },
  {
    key: 'dateOfService',
    label: 'Date of Service',
    defaultVisible: true,
    render: (c) => <span className="text-ink-muted">{formatDate(c.dateOfService)}</span>,
  },
  {
    key: 'originalCoder',
    label: 'Original Coder',
    defaultVisible: false,
    render: (c) => dash(c.originalCoderName),
  },
  {
    key: 'followUpCoder',
    label: 'Follow up Coder',
    defaultVisible: false,
    // Not yet modelled — surface a placeholder so toggling the column works
    // and existing users see where the data will land once it's wired up.
    render: () => <span className="text-ink-subtle text-xs">—</span>,
  },
  {
    key: 'originalAuditor',
    label: 'Original Auditor',
    defaultVisible: false,
    render: (c) => dash(c.originalAuditorName),
  },
  {
    key: 'chartStatus',
    label: 'Chart Status',
    defaultVisible: true,
    render: (c) => <ChartStatusChip status={c.chartStatus} />,
  },
  {
    key: 'milestone',
    label: 'Milestone',
    defaultVisible: true,
    render: (c) => <MilestoneChip milestone={c.milestone} />,
  },
  {
    key: 'qcStatus',
    label: 'QC status',
    defaultVisible: false,
    render: (c) => dash(c.qcStatus),
  },
  {
    key: 'allocatedUser',
    label: 'Allocated User',
    defaultVisible: true,
    render: (c) => {
      const name = c.allocatedCoderName ?? c.allocatedAuditorName;
      if (!name) return <span className="text-ink-subtle text-xs">—</span>;
      return (
        <span className="inline-flex items-center gap-2">
          <Avatar name={name} size="sm" />
          <span className="text-xs truncate">{name}</span>
        </span>
      );
    },
  },
  {
    key: 'followUpAuditor',
    label: 'Follow Up Auditor',
    defaultVisible: false,
    render: () => <span className="text-ink-subtle text-xs">—</span>,
  },
  {
    key: 'process',
    label: 'Process',
    defaultVisible: false,
    render: (c) => dash(c.processName),
  },
  {
    key: 'receivedDate',
    label: 'Received Date',
    defaultVisible: true,
    render: (c) => <span className="text-ink-muted">{formatDate(c.receivedDate ?? c.createdAt)}</span>,
  },
  {
    key: 'subSpecialty',
    label: 'Sub Specialty',
    defaultVisible: false,
    render: (c) => dash(c.subSpecialityName),
  },
  {
    key: 'coderAllocatedAt',
    label: 'Date of Coder Allocation',
    defaultVisible: false,
    render: (c) => <span className="text-ink-muted">{formatDate(c.coderAllocatedAt)}</span>,
  },
  {
    key: 'auditorAllocatedAt',
    label: 'Date of Auditor Allocation',
    defaultVisible: false,
    render: (c) => <span className="text-ink-muted">{formatDate(c.auditorAllocatedAt)}</span>,
  },
  // Extras kept on the catalog (off by default) so the priority/AI pipeline
  // information from the prior layout is still reachable without losing the
  // row tinting that depends on AI status.
  {
    key: 'priority',
    label: 'Priority',
    defaultVisible: false,
    render: (c) => <PriorityChip priority={c.priority} />,
  },
  {
    key: 'aiStatus',
    label: 'AI Status',
    defaultVisible: false,
    render: (c) => <AiStatusChip status={deriveAiStatus(c.customFields)} />,
  },
  {
    key: 'worklistNo',
    label: 'Worklist #',
    defaultVisible: false,
    render: (c) => (
      <Link
        to={`/worklists/${c.worklistId}`}
        className="text-ink-muted hover:text-primary font-mono text-xs"
      >
        {c.worklistNumber}
      </Link>
    ),
  },
  {
    key: 'serialNo',
    label: 'Serial #',
    defaultVisible: false,
    render: (c) => <span className="font-mono text-xs">{c.serialNo}</span>,
  },
];

const COLUMN_PREFS_KEY = 'charts.columns.visible.v1';

function loadVisibleColumns(): Set<string> {
  try {
    const raw = localStorage.getItem(COLUMN_PREFS_KEY);
    if (!raw) return new Set(CHART_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key));
    const parsed: string[] = JSON.parse(raw);
    return new Set(parsed.filter((k) => CHART_COLUMNS.some((col) => col.key === k)));
  } catch {
    return new Set(CHART_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key));
  }
}

function saveVisibleColumns(visible: Set<string>) {
  try {
    localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify([...visible]));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export function ChartsPage() {
  const user = useAuth((s) => s.user)!;
  const isManager = can(user, 'chart.bulkModify');
  const isCoderOrAuditor = user.role === 'CODER' || user.role === 'AUDITOR';

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [tab, setTab] = useState<'ALL' | Priority>('ALL');
  const [filters, setFilters] = useState<ChartListParams>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [selfAllocateOpen, setSelfAllocateOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => loadVisibleColumns());
  const columnsBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    saveVisibleColumns(visibleColumns);
  }, [visibleColumns]);

  const activeColumns = useMemo(
    () => CHART_COLUMNS.filter((c) => visibleColumns.has(c.key)),
    [visibleColumns],
  );

  const summary = useQuery({
    queryKey: ['charts', 'summary'],
    queryFn: getChartsSummary,
    // Keep the AI Queued / Processing tiles moving while any chart on the
    // current page is in flight — same trigger as the list refetch below.
    refetchInterval: (query) => {
      const counts = (query.state.data as { aiStatusCounts?: { queued: number; processing: number } } | undefined)
        ?.aiStatusCounts;
      return counts && (counts.queued > 0 || counts.processing > 0) ? 5000 : false;
    },
  });

  const params: ChartListParams = useMemo(
    () => ({
      ...filters,
      page,
      pageSize,
      sortBy: 'createdAt',
      sortDir: 'desc',
      ...(tab !== 'ALL' ? { priority: tab } : {}),
    }),
    [filters, page, pageSize, tab],
  );

  const list = useQuery({
    queryKey: ['charts', params],
    queryFn: () => listCharts(params),
    placeholderData: (prev) => prev,
    // If any chart on the current page is mid-AI-pipeline (QUEUED or
    // PROCESSING), poll the list every 5s so the row tints and AI chip flip to
    // DONE / ERRORED without a manual refresh. Mirrors the per-chart poll on
    // ChartDetailPage; stops as soon as the page is settled.
    refetchInterval: (query) => {
      const items = (query.state.data as { items?: Chart[] } | undefined)?.items;
      if (!items?.length) return false;
      const hasInFlight = items.some((c) => {
        const s = deriveAiStatus(c.customFields);
        return s === 'QUEUED' || s === 'PROCESSING';
      });
      return hasInFlight ? 5000 : false;
    },
  });

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / pageSize)) : 1;
  const allOnPageIds = list.data?.items.map((c) => c.id) ?? [];
  const allSelected = allOnPageIds.length > 0 && allOnPageIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  function toggleAll() {
    if (allSelected) {
      const next = new Set(selected);
      allOnPageIds.forEach((id) => next.delete(id));
      setSelected(next);
    } else {
      const next = new Set(selected);
      allOnPageIds.forEach((id) => next.add(id));
      setSelected(next);
    }
  }
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  const pc = summary.data?.priorityCounts;
  const tabsWithCounts = PRIORITY_TABS.map((t) => ({
    ...t,
    count:
      t.key === 'ALL'
        ? (pc ? pc.critical + pc.high + pc.medium + pc.low + pc.finalized : undefined)
        : pc?.[t.key.toLowerCase() as keyof typeof pc],
  }));

  return (
    <div className="p-8 max-w-[1600px] space-y-5">
      <PageHeader title="Charts" subtitle="Charts" />

      {isCoderOrAuditor && <ActiveTimerCard />}

      {/* Summary tiles */}
      {summary.data && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <SummaryTile label="Ready to Code" value={summary.data.milestones.readyToCode} tone="sky" />
          <SummaryTile label="Coding Done Today" value={summary.data.milestones.codingDoneToday} tone="mint" />
          <SummaryTile label="Ready to Audit" value={summary.data.milestones.readyToAudit} tone="indigo" />
          <SummaryTile label="Audit Done Today" value={summary.data.milestones.auditDoneToday} tone="teal" />
          <SummaryTile label="Complete Today" value={summary.data.statusToday.complete} tone="mint" />
          <SummaryTile label="Incomplete Today" value={summary.data.statusToday.incomplete} tone="coral" />
        </div>
      )}

      {/* AI pipeline status tiles — counts are mutually exclusive per chart. */}
      {summary.data?.aiStatusCounts && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryTile label="AI Queued" value={summary.data.aiStatusCounts.queued} tone="sky" />
          <SummaryTile label="AI Processing" value={summary.data.aiStatusCounts.processing} tone="butter" />
          <SummaryTile label="AI Done" value={summary.data.aiStatusCounts.done} tone="mint" />
          <SummaryTile label="AI Errored" value={summary.data.aiStatusCounts.errored} tone="coral" />
        </div>
      )}

      <Card padding="none">
        {/* Tabs + actions */}
        <div className="px-6 pt-5">
          <Tabs
            tabs={tabsWithCounts}
            value={tab}
            onChange={(k) => {
              setTab(k as 'ALL' | Priority);
              setPage(1);
              setSelected(new Set());
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 px-6 py-4 border-b border-line">
          <div className="flex-1 max-w-sm">
            <SearchInput
              placeholder="Search chart #..."
              onChange={(e) => {
                setFilters((f) => ({ ...f, chartNo: e.target.value || undefined }));
                setPage(1);
              }}
            />
          </div>
          {someSelected && (
            <PillBadge tone="mint">{selected.size} Selected</PillBadge>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="soft" leftIcon={<FilterIcon className="w-3.5 h-3.5" />} onClick={() => setFilterOpen(true)}>
              Filter
            </Button>
            <Button
              ref={columnsBtnRef}
              variant="soft"
              leftIcon={<Columns3 className="w-3.5 h-3.5" />}
              onClick={() => setColumnsOpen((v) => !v)}
            >
              Columns
            </Button>
            {isManager && (
              <Button
                disabled={!someSelected}
                leftIcon={<Sparkles className="w-3.5 h-3.5" />}
                onClick={() => setModifyOpen(true)}
              >
                Modify Charts
              </Button>
            )}
            {isCoderOrAuditor && (
              <Button
                disabled={!someSelected}
                leftIcon={<UserPlus className="w-3.5 h-3.5" />}
                onClick={() => setSelfAllocateOpen(true)}
              >
                Self Allocate
              </Button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px]">
            <thead>
              <tr>
                <th className="table-head w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="checkbox"
                  />
                </th>
                {activeColumns.map((col) => (
                  <HeaderCell key={col.key}>{col.label}</HeaderCell>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.isPending || list.isPlaceholderData ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`skel-${i}`} className="border-b border-line/60">
                    <td className="table-cell">
                      <div className="w-4 h-4 rounded bg-surface-sunken animate-pulse" />
                    </td>
                    {activeColumns.map((col) => (
                      <td key={col.key} className="table-cell">
                        <div className="h-3 w-20 rounded bg-surface-sunken animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : list.data?.items.length === 0 ? (
                <tr>
                  <td colSpan={activeColumns.length + 1} className="py-20 text-center text-sm text-ink-muted">
                    No charts match the current filters.
                  </td>
                </tr>
              ) : (
                list.data?.items.map((c) => {
                  const aiStatus = deriveAiStatus(c.customFields);
                  return (
                    <tr
                      key={c.id}
                      className={cn(
                        'group border-b border-line/60 transition-colors',
                        AI_ROW_TINT[aiStatus],
                      )}
                    >
                      <td className="table-cell">
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggle(c.id)}
                          className="checkbox"
                        />
                      </td>
                      {activeColumns.map((col) => (
                        <td key={col.key} className="table-cell">
                          {col.render(c)}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          pageCount={totalPages}
          onPageChange={setPage}
          pageSize={pageSize}
          total={list.data?.total}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      </Card>

      <FilterModal open={filterOpen} onClose={() => setFilterOpen(false)} value={filters} onApply={(f) => { setFilters(f); setPage(1); }} />
      <ColumnsPopover
        open={columnsOpen}
        anchorRef={columnsBtnRef}
        onClose={() => setColumnsOpen(false)}
        visible={visibleColumns}
        onChange={setVisibleColumns}
      />
      <ModifyChartsModal
        open={modifyOpen}
        onClose={() => setModifyOpen(false)}
        selectedIds={Array.from(selected)}
        onComplete={() => { setSelected(new Set()); setModifyOpen(false); }}
      />
      <SelfAllocateConfirm
        open={selfAllocateOpen}
        onClose={() => setSelfAllocateOpen(false)}
        selectedIds={Array.from(selected)}
        onComplete={() => { setSelected(new Set()); setSelfAllocateOpen(false); }}
      />
    </div>
  );
}

/* ── Summary tile ────────────────────────────────────────── */
function SummaryTile({ label, value, tone }: { label: string; value: number; tone: 'mint' | 'sky' | 'indigo' | 'teal' | 'coral' | 'butter' }) {
  const toneMap = {
    mint: 'bg-tile-mint text-success',
    sky: 'bg-tile-sky text-info',
    indigo: 'bg-tile-indigo text-indigo-500 dark:text-indigo-300',
    teal: 'bg-tile-teal text-teal-600 dark:text-teal-300',
    coral: 'bg-tile-coral text-danger',
    butter: 'bg-tile-butter text-primary-ink',
  };
  return (
    <div className={cn('rounded-card p-4', toneMap[tone])}>
      <p className="text-2xl font-bold leading-none tracking-tightish">{formatNumber(value)}</p>
      <p className="text-[11px] font-semibold mt-1.5">{label}</p>
    </div>
  );
}

function HeaderCell({ children, sortable }: { children: React.ReactNode; sortable?: boolean }) {
  return (
    <th className="table-head whitespace-nowrap">
      <span className="inline-flex items-center gap-1">
        {children}
        {sortable && <ChevronsUpDown className="w-3 h-3 opacity-50" />}
      </span>
    </th>
  );
}

/* ── Filter modal ────────────────────────────────────────── */
function FilterModal({
  open,
  onClose,
  value,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  value: ChartListParams;
  onApply: (v: ChartListParams) => void;
}) {
  const { register, handleSubmit, reset } = useForm<ChartListParams>({ defaultValues: value });

  return (
    <Modal open={open} onClose={onClose} title="Filter Charts" size="xl">
      <form
        onSubmit={handleSubmit((d) => { onApply(d); onClose(); })}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <Label>Chart #</Label>
            <Input {...register('chartNo')} />
          </div>
          <div>
            <Label>Serial from</Label>
            <Input type="number" {...register('serialFrom', { valueAsNumber: true })} />
          </div>
          <div>
            <Label>Serial to</Label>
            <Input type="number" {...register('serialTo', { valueAsNumber: true })} />
          </div>
          <div>
            <Label>Worklist ID</Label>
            <Input type="number" {...register('worklistId', { valueAsNumber: true })} />
          </div>
          <div>
            <Label>Allocated user ID</Label>
            <Input type="number" {...register('allocatedUserId', { valueAsNumber: true })} />
          </div>
          <div>
            <Label>Primary Speciality ID</Label>
            <Input type="number" {...register('primarySpecialityId', { valueAsNumber: true })} />
          </div>
          <div>
            <Label>Status</Label>
            <Select {...register('chartStatus')}>
              <option value="">Any</option>
              <option value="OPEN">Open</option>
              <option value="COMPLETE">Complete</option>
              <option value="INCOMPLETE">Incomplete</option>
              <option value="HOLD">Hold</option>
            </Select>
          </div>
          <div>
            <Label>Milestone</Label>
            <Select {...register('milestone')}>
              <option value="">Any</option>
              <option value="READY_TO_CODE">Ready to Code</option>
              <option value="CODING_IN_PROGRESS">Coding</option>
              <option value="CODING_DONE">Coding Done</option>
              <option value="READY_TO_AUDIT">Ready to Audit</option>
              <option value="AUDIT_IN_PROGRESS">Auditing</option>
              <option value="AUDIT_DONE">Audit Done</option>
              <option value="CLOSED">Closed</option>
            </Select>
          </div>
          <div>
            <Label>Received from</Label>
            <Input type="date" {...register('receivedDateFrom')} />
          </div>
          <div>
            <Label>Received to</Label>
            <Input type="date" {...register('receivedDateTo')} />
          </div>
          <div>
            <Label>DOS from</Label>
            <Input type="date" {...register('dateOfServiceFrom')} />
          </div>
          <div>
            <Label>DOS to</Label>
            <Input type="date" {...register('dateOfServiceTo')} />
          </div>
        </div>

        <ModalFooter>
          <Button variant="ghost" type="button" onClick={() => { reset({}); onApply({}); onClose(); }}>
            Clear all
          </Button>
          <Button type="submit">Apply filters</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/* ── Columns visibility popover ─────────────────────────── */
function ColumnsPopover({
  open,
  anchorRef,
  onClose,
  visible,
  onChange,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  visible: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape. The anchor button toggles open itself, so
  // clicks on it must not count as "outside" — otherwise the button would
  // close and immediately reopen the panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  function toggle(key: string) {
    const next = new Set(visible);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  }

  function resetDefaults() {
    onChange(new Set(CHART_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key)));
  }

  function showAll() {
    onChange(new Set(CHART_COLUMNS.map((c) => c.key)));
  }

  return (
    <div
      ref={panelRef}
      className="absolute right-8 mt-2 z-40 w-72 rounded-card border border-line bg-surface shadow-pop dark:shadow-pop-dark"
      style={{
        // Anchor visually under the Columns button. The toolbar uses `ml-auto`
        // so right-aligning to its container approximates the button position
        // without needing portal-based positioning.
        top: anchorRef.current
          ? anchorRef.current.getBoundingClientRect().bottom + 6
          : undefined,
        right: anchorRef.current
          ? Math.max(8, window.innerWidth - anchorRef.current.getBoundingClientRect().right)
          : 32,
        position: 'fixed',
      }}
      role="dialog"
      aria-label="Configure visible columns"
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">Columns</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={showAll}
            className="text-[11px] font-semibold text-primary hover:underline"
          >
            Show all
          </button>
          <button
            type="button"
            onClick={resetDefaults}
            className="text-[11px] font-semibold text-ink-muted hover:underline"
          >
            Reset
          </button>
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto px-2 pb-2">
        {CHART_COLUMNS.map((col) => {
          const checked = visible.has(col.key);
          return (
            <label
              key={col.key}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-surface-sunken/60"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(col.key)}
                className="checkbox"
              />
              <span className="text-sm text-ink">{col.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/* ── Modify Charts modal ────────────────────────────────── */
function ModifyChartsModal({
  open,
  onClose,
  selectedIds,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  selectedIds: string[];
  onComplete: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const users = useQuery({
    queryKey: ['users', 'all'],
    queryFn: () => listUsers({ pageSize: 100 }),
    enabled: open,
  });

  const { register, handleSubmit, watch } = useForm<{
    priority?: Priority | '';
    action: AllocationAction;
    assigneeId?: number;
  }>({ defaultValues: { priority: '', action: 'NONE' } });

  const action = watch('action');

  const mutation = useMutation({
    mutationFn: (dto: BulkModifyDto) => bulkModifyCharts(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['charts'] });
      onComplete();
    },
    onError: (err) => setError((err as unknown as ApiErrorShape).message),
  });

  return (
    <Modal open={open} onClose={onClose} title="Modify Charts" subtitle={`${selectedIds.length} selected`} size="md">
      <form
        onSubmit={handleSubmit((d) => {
          setError(null);
          const dto: BulkModifyDto = {
            chartIds: selectedIds.map(Number),
            ...(d.priority ? { priority: d.priority as Priority } : {}),
            ...(d.action !== 'NONE'
              ? {
                  allocation: {
                    action: d.action,
                    ...(d.assigneeId ? { assigneeId: Number(d.assigneeId) } : {}),
                  },
                }
              : {}),
          };
          mutation.mutate(dto);
        })}
        className="space-y-4"
      >
        {error && (
          <div className="text-xs px-3 py-2 rounded-lg bg-danger-soft text-danger border border-danger/30">
            {error}
          </div>
        )}

        <div>
          <Label>Change priority</Label>
          <Select {...register('priority')}>
            <option value="">Keep current</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
            <option value="DONE">Done</option>
          </Select>
        </div>

        <div>
          <Label>Allocation action</Label>
          <div className="space-y-2">
            {(['NONE', 'ALLOCATE_CODING', 'ALLOCATE_AUDITING', 'REALLOCATE_TO_ORIGINAL_CODER'] as AllocationAction[]).map((a) => (
              <Radio
                key={a}
                value={a}
                {...register('action')}
                label={a.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}
                className="flex"
              />
            ))}
          </div>
        </div>

        {(action === 'ALLOCATE_CODING' || action === 'ALLOCATE_AUDITING') && (
          <div>
            <Label required>Assignee</Label>
            <Select {...register('assigneeId', { valueAsNumber: true })}>
              <option value="">Select user...</option>
              {users.data?.items.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </Select>
          </div>
        )}

        <ModalFooter>
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending}>Apply</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/* ── Self Allocate confirmation ─────────────────────────── */
function SelfAllocateConfirm({
  open,
  onClose,
  selectedIds,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  selectedIds: string[];
  onComplete: () => void;
}) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => selfAllocateCharts(selectedIds.map(Number)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['charts'] });
      onComplete();
    },
  });
  return (
    <ConfirmModal
      open={open}
      onClose={onClose}
      onConfirm={() => mutation.mutate()}
      message={`Allocate ${selectedIds.length} chart${selectedIds.length === 1 ? '' : 's'} to yourself?`}
      variant="primary"
      confirmLabel="Allocate"
      cancelLabel="Cancel"
      loading={mutation.isPending}
    />
  );
}

/* ── Currently running chart card — coder/auditor only ────── */

function formatHMS(s: number) {
  const hh = Math.floor(s / 3600).toString().padStart(2, '0');
  const mm = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
  const ss = Math.floor(s % 60).toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function ActiveTimerCard() {
  const { data: active, isPending } = useQuery({
    queryKey: ['active-timer'],
    queryFn: getActiveTimer,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [active]);

  if (isPending) {
    return (
      <div className="rounded-card border border-line bg-surface px-5 py-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-surface-sunken animate-pulse shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-32 bg-surface-sunken rounded animate-pulse" />
          <div className="h-4 w-48 bg-surface-sunken rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!active) {
    return (
      <div className="rounded-card border border-dashed border-line bg-surface-sunken/40 px-5 py-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-surface-sunken flex items-center justify-center shrink-0">
          <Clock className="w-4 h-4 text-ink-subtle" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-[0.1em] text-ink-subtle font-bold">
            No chart in progress
          </p>
          <p className="text-sm text-ink-muted">
            Start the timer on a chart to begin working. Only one chart can be active at a time.
          </p>
        </div>
      </div>
    );
  }

  const elapsed = Math.max(0, Math.floor((now - Date.parse(active.startedAt)) / 1000));

  return (
    <Link
      to={`/charts/${active.chartId}`}
      className="block group"
    >
      <div className="rounded-card border border-primary/40 bg-gradient-to-r from-primary-soft/60 to-warn-soft/40 px-5 py-4 flex items-center gap-4 hover:shadow-card transition">
        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
          <Clock className="w-4 h-4 text-primary-ink dark:text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-[0.1em] text-primary-ink dark:text-primary font-bold">
            Currently working on
          </p>
          <p className="text-base font-bold text-ink truncate">
            Chart {active.chartNo ? `#${active.chartNo}` : `${active.chartId}`}
            <span className="ml-2 text-xs font-normal text-ink-muted">
              · {active.milestone.replace(/_/g, ' ').toLowerCase()}
            </span>
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-bold font-mono tabular-nums text-ink">
            {formatHMS(elapsed)}
          </p>
          <p className="text-[11px] text-ink-muted">elapsed</p>
        </div>
        <ChevronRight className="w-4 h-4 text-ink-muted group-hover:text-ink transition shrink-0" />
      </div>
    </Link>
  );
}
