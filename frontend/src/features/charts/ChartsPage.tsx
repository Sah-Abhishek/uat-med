import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import {
  listCharts,
  getChartsSummary,
  bulkModifyCharts,
  selfAllocateCharts,
  retryAiErroredCharts,
  getActiveTimer,
  type AllocationAction,
  type BulkModifyDto,
  type ChartListParams,
  type SelfAllocateResult,
} from '@/api/charts';
import { listUsers } from '@/api/users';
import { listWorklists } from '@/api/worklists';
import { listPrimarySpecialities, listAllSubSpecialities, listClients, listLocations } from '@/api/configurations';
import type { ApiErrorShape, Priority, PriorityTab } from '@/api/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, SearchInput, Radio, FancySelect, FancyMultiSelect, RangeDatePicker } from '@/components/ui/Field';
import {
  Modal,
  ModalFooter,
  Pagination,
  Tabs,
  ConfirmModal,
  PillBadge,
  Avatar,
  Toast,
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
import { useChartsView } from './chartsViewStore';
import { can } from '@/permissions';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { useTableSort } from '@/hooks/useTableSort';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import {
  Filter as FilterIcon,
  Columns3,
  Sparkles,
  UserPlus,
  UserCheck,
  Clock,
  Pause,
  ChevronRight,
  RotateCcw,
  X,
} from 'lucide-react';

// The four computed buckets, common to every role. The trailing tab is
// role-specific: "Done" (§4.6) for Coders/Auditors/Team-Leads, "Finalized"
// (§4.7) for Managers — appended per role in the component.
const BASE_PRIORITY_TABS: Array<{ key: 'ALL' | PriorityTab; label: string }> = [
  { key: 'ALL', label: 'All Priorities' },
  { key: 'CRITICAL', label: 'Critical' },
  { key: 'HIGH', label: 'High' },
  { key: 'MEDIUM', label: 'Medium' },
  { key: 'LOW', label: 'Low' },
];

// Option lists for the stylized FancySelect filters. Each leads with an "Any"
// entry (empty value) so the field can be cleared back to "no filter"; the
// submit handler strips empty values before they reach the API.
const CHART_STATUS_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'OPEN', label: 'Open' },
  { value: 'COMPLETE', label: 'Complete' },
  { value: 'INCOMPLETE', label: 'Incomplete' },
  { value: 'HOLD', label: 'Hold' },
];
const MILESTONE_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'READY_TO_CODE', label: 'Ready to Code' },
  { value: 'CODING_IN_PROGRESS', label: 'Coding in Progress' },
  { value: 'CODING_DONE', label: 'Coding Done' },
  { value: 'READY_TO_AUDIT', label: 'Ready to Audit' },
  { value: 'AUDIT_IN_PROGRESS', label: 'Auditing' },
  { value: 'AUDIT_DONE', label: 'Audit Done' },
  { value: 'CLOSED', label: 'Closed' },
];
const AI_STATUS_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'QUEUED', label: 'Queued' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'DONE', label: 'Done' },
  { value: 'ERRORED', label: 'Errored' },
];
// "Reviewed" = the chart has been worked upon — it has at least one submitted
// code decision. Derived server-side from chart_code_decisions (see the list
// endpoint), so it's a single value rather than a multi-select.
const REVIEWED_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'YES', label: 'Reviewed' },
  { value: 'NO', label: 'Not reviewed' },
];
// Coder / Auditor QC Status multi-select options. "Blank" uses a sentinel (not
// '') so it survives query-param serialisation; the backend maps it to "QC not
// set yet" (matches the manual's "find charts without a QC status").
const QC_STATUS_FILTER_OPTIONS = [
  { value: 'Agree', label: 'Agree' },
  { value: 'Feedback Provided', label: 'Feedback Provided' },
  { value: 'Feedback Implemented', label: 'Feedback Implemented' },
  { value: 'Feedback Rejected', label: 'Feedback Rejected' },
  { value: '__BLANK__', label: 'Blank (not set)' },
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
  /** Backend sort whitelist key (see CHART_SORT_COLUMNS in charts.service).
   * Omit for computed/derived columns that can't be sorted server-side. */
  sortKey?: string;
  defaultVisible: boolean;
  /** Always-on columns (Worklist #, S. No., Chart #) — the popover renders
   * their checkboxes as disabled so users can't accidentally hide identifying
   * info. They're also force-included on every load regardless of stored prefs. */
  locked?: boolean;
  render: (c: Chart) => React.ReactNode;
}

function dash(node: React.ReactNode): React.ReactNode {
  return node === null || node === undefined || node === '' ? (
    <span className="text-ink-subtle text-xs">—</span>
  ) : (
    node
  );
}

/** Pull the AI document-processing duration (ms) the pipeline persisted on
 * customFields.aiPrediction.processingMs. Null when missing (legacy runs,
 * unprocessed charts). */
function aiProcessingMsOf(customFields: Record<string, unknown> | undefined | null): number | null {
  const ms = (customFields as any)?.aiPrediction?.processingMs;
  return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
}

/** Compact AI-processing duration for the table cell. */
function fmtAiProcessing(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  return rs ? `${m}m ${rs}s` : `${m}m`;
}

/** Column catalog. Order here is the on-screen column order; the popover
 * also renders rows in this order. Render functions depend on `canOpenWorklist`
 * so coders see Worklist # as plain text (no link to the worklist detail page). */
function buildChartColumns({
  canOpenWorklist,
  currentUserId,
}: {
  canOpenWorklist: boolean;
  /** Viewer's user id — drives the "Assignment" column's "Assigned to me"
   *  badge. Optional so the static key-set builders below can omit it. */
  currentUserId?: string;
}): ColumnDef[] {
  return [
    {
      key: 'worklistNo',
      sortKey: 'worklistNumber',
      label: 'Worklist #',
      defaultVisible: true,
      locked: true,
      render: (c) =>
        canOpenWorklist ? (
          <Link
            to={`/worklists/${c.worklistId}`}
            className="text-ink-muted hover:text-primary font-mono text-xs"
          >
            {c.worklistNumber}
          </Link>
        ) : (
          <span className="text-ink-muted font-mono text-xs">{c.worklistNumber}</span>
        ),
    },
    {
      key: 'serialNo',
      sortKey: 'serialNo',
      label: 'S. No.',
      defaultVisible: true,
      locked: true,
      render: (c) => <span className="font-mono text-xs">{c.serialNo}</span>,
    },
    {
      key: 'client',
      sortKey: 'client',
      label: 'Client',
      defaultVisible: true,
      render: (c) => dash(c.clientName),
    },
    {
      key: 'location',
      sortKey: 'location',
      label: 'Location',
      defaultVisible: true,
      render: (c) => dash(c.locationName),
    },
    {
      key: 'specialty',
      sortKey: 'specialty',
      label: 'Primary Speciality',
      defaultVisible: false,
      render: (c) => dash(c.specialityName),
    },
    {
      key: 'chartNo',
      sortKey: 'chartNo',
      label: 'Chart #',
      defaultVisible: true,
      locked: true,
      render: (c) => (
        <Link
          to={`/charts/${c.id}`}
          className="text-ink hover:text-primary font-bold transition"
        >
          {c.chartNo ?? '—'}
        </Link>
      ),
    },
    {
      key: 'dateOfService',
      sortKey: 'dateOfService',
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
      label: 'Follow Up Coder',
      defaultVisible: false,
      // Not yet modelled — surface a placeholder so toggling the column works
      // and users see where the data will land once it's wired up.
      render: () => <span className="text-ink-subtle text-xs">—</span>,
    },
    {
      key: 'originalAuditor',
      label: 'Original Auditor',
      defaultVisible: false,
      render: (c) => dash(c.originalAuditorName),
    },
    {
      key: 'allocatedUser',
      label: 'Allocated User',
      defaultVisible: true,
      render: (c) => {
        const name = c.allocatedCoderName ?? c.allocatedAuditorName;
        if (!name) return <span className="text-ink-subtle text-xs">—</span>;
        const avatarUrl = c.allocatedCoderName
          ? c.allocatedCoderAvatarUrl
          : c.allocatedAuditorAvatarUrl;
        return (
          <span className="inline-flex items-center gap-2">
            <Avatar name={name} src={avatarUrl ?? undefined} size="sm" />
            <span className="text-xs truncate">{name}</span>
          </span>
        );
      },
    },
    {
      key: 'assignment',
      label: 'Assignment',
      // Off by default in the catalog; the page force-defaults it ON for
      // auditors (see loadVisibleColumns), who now see every chart and need to
      // tell their own apart. Other roles can still enable it from the popover.
      defaultVisible: false,
      render: (c) => {
        const mine =
          currentUserId != null &&
          (c.allocatedAuditorId === currentUserId || c.allocatedCoderId === currentUserId);
        return mine ? (
          <PillBadge tone="mint" className="gap-1">
            <UserCheck className="w-3 h-3" />
            Assigned to me
          </PillBadge>
        ) : (
          <span className="text-ink-subtle text-xs">Not mine</span>
        );
      },
    },
    {
      key: 'chartStatus',
      sortKey: 'chartStatus',
      label: 'Chart Status',
      defaultVisible: true,
      render: (c) => <ChartStatusChip status={c.chartStatus} />,
    },
    {
      key: 'milestone',
      sortKey: 'milestone',
      label: 'Milestone',
      defaultVisible: true,
      render: (c) => <MilestoneChip milestone={c.milestone} />,
    },
    {
      key: 'followUpAuditor',
      label: 'Follow Up Auditor',
      defaultVisible: false,
      render: () => <span className="text-ink-subtle text-xs">—</span>,
    },
    {
      key: 'process',
      sortKey: 'process',
      label: 'Process',
      defaultVisible: false,
      render: (c) => dash(c.processName),
    },
    {
      key: 'receivedDate',
      sortKey: 'receivedDate',
      label: 'Received Date',
      defaultVisible: true,
      render: (c) => (
        <span className="text-ink-muted">{formatDate(c.receivedDate ?? c.createdAt)}</span>
      ),
    },
    {
      key: 'subSpecialty',
      label: 'Sub Specialty',
      defaultVisible: false,
      render: (c) => dash(c.subSpecialityName),
    },
    {
      key: 'auditorAllocatedAt',
      label: 'Date of Auditor Allocation',
      defaultVisible: false,
      render: (c) => (
        <span className="text-ink-muted">{formatDate(c.auditorAllocatedAt)}</span>
      ),
    },
    // ── Extras (off by default) ─────────────────────────────
    // Not in the canonical column list but kept here so the data is still
    // reachable: QC status / coder-allocation timestamp aren't part of the
    // primary 18, and Priority / AI Status double up on info that already
    // drives the priority tabs and row tinting respectively.
    {
      key: 'qcStatus',
      label: 'QC Status',
      defaultVisible: false,
      // Show the effective QC (coder- or auditor-set, whichever most recent) —
      // reading coder-only left an auditor-set QC (e.g. "Feedback Provided")
      // blank. Fall back to the raw coder value for older API responses.
      render: (c) => dash(c.effectiveQcStatus ?? c.qcStatus),
    },
    {
      key: 'coderAllocatedAt',
      label: 'Date of Coder Allocation',
      defaultVisible: false,
      render: (c) => (
        <span className="text-ink-muted">{formatDate(c.coderAllocatedAt)}</span>
      ),
    },
    {
      key: 'priority',
      sortKey: 'priority',
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
      key: 'aiTime',
      label: 'AI Time',
      defaultVisible: true,
      render: (c) => {
        const ms = aiProcessingMsOf(c.customFields);
        return ms == null ? (
          <span className="text-ink-subtle text-xs">—</span>
        ) : (
          <span className="font-mono text-xs text-ink-muted" title="Time the AI took to process this chart's documents">
            {fmtAiProcessing(ms)}
          </span>
        );
      },
    },
  ];
}

/** Static key list — used by load/save to validate stored prefs without
 * paying for a per-call rebuild of the renderer-bearing catalog. */
const COLUMN_KEYS: ReadonlySet<string> = new Set(
  buildChartColumns({ canOpenWorklist: true }).map((c) => c.key),
);
const LOCKED_KEYS: ReadonlySet<string> = new Set(
  buildChartColumns({ canOpenWorklist: true }).filter((c) => c.locked).map((c) => c.key),
);
const DEFAULT_VISIBLE_KEYS: ReadonlySet<string> = new Set(
  buildChartColumns({ canOpenWorklist: true })
    .filter((c) => c.defaultVisible)
    .map((c) => c.key),
);

// Bumped to v3 when the "AI Time" column was added: stored v2 prefs don't
// include the new key, and loadVisibleColumns() only re-adds locked keys (not
// new defaults), so existing users would never see it without a version bump.
// Resetting to defaults keeps the new column visible for everyone.
const COLUMN_PREFS_KEY = 'charts.columns.visible.v3';

// Set once we've surfaced the Assignment column to an auditor, so the one-time
// seed below doesn't fight a later manual hide.
const ASSIGNMENT_SEED_KEY = 'charts.columns.assignmentSeeded.v1';

function loadVisibleColumns(isAuditor: boolean): Set<string> {
  const fallback = new Set<string>([...DEFAULT_VISIBLE_KEYS, ...LOCKED_KEYS]);
  // Auditors now see every chart, so default the Assignment column ON for them
  // so they can tell their own charts from the rest.
  if (isAuditor) fallback.add('assignment');

  let visible: Set<string>;
  try {
    const raw = localStorage.getItem(COLUMN_PREFS_KEY);
    if (!raw) {
      visible = fallback;
    } else {
      const parsed: string[] = JSON.parse(raw);
      const next = new Set(parsed.filter((k) => COLUMN_KEYS.has(k)));
      // Locked columns can never be removed via stored prefs either — re-add
      // them in case a user hand-edited localStorage.
      LOCKED_KEYS.forEach((k) => next.add(k));
      visible = next;
    }
  } catch {
    visible = fallback;
  }

  // One-time seed: surface the Assignment column for auditors who already had
  // saved column prefs from before this column existed. Done once per browser
  // (guarded by ASSIGNMENT_SEED_KEY) so that hiding it afterwards still sticks.
  if (isAuditor) {
    try {
      if (!localStorage.getItem(ASSIGNMENT_SEED_KEY)) {
        visible.add('assignment');
        localStorage.setItem(ASSIGNMENT_SEED_KEY, '1');
      }
    } catch {
      /* ignore disabled / full storage */
    }
  }
  return visible;
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
  // The §4.7 Finalized bucket exists only for the Manager role (a Team-Lead may
  // hold bulkModify but still gets the §4.6 Done bucket instead).
  const isManagerRole = user.role === 'MANAGER';
  // Auditor / admin can pull charts to themselves; coders are assigned charts
  // by a TL/Manager and no longer self-allocate.
  const canSelfAllocate = can(user, 'chart.selfAllocate');
  // Anyone who can run a timer sees the active-timer card (coders included) —
  // this is independent of self-allocate, which coders no longer have.
  const canTime =
    user.role === 'CODER' || user.role === 'AUDITOR' || user.role === 'TEAMLEAD' || user.role === 'MANAGER';
  const qc = useQueryClient();
  // Client / Location are part of the Charts filters now (see the Filter modal),
  // not the global header scope — so they live in `filters` alongside the rest.

  // View-state (filters, search, tab, pagination, sort) is persisted in
  // sessionStorage via useChartsView so it survives navigating into a chart's
  // detail page and back — see chartsViewStore.ts.
  const page = useChartsView((s) => s.page);
  const setPage = useChartsView((s) => s.setPage);
  const pageSize = useChartsView((s) => s.pageSize);
  const setPageSize = useChartsView((s) => s.setPageSize);
  const tab = useChartsView((s) => s.tab);
  const setTab = useChartsView((s) => s.setTab);
  // The role-specific last tab (§4.6 Done vs §4.7 Finalized) differs per role, so
  // a tab persisted from another role's session may not exist here — snap to All.
  useEffect(() => {
    if ((tab === 'FINALIZED' && !isManagerRole) || (tab === 'DONE' && isManagerRole)) setTab('ALL');
  }, [tab, isManagerRole, setTab]);
  const filters = useChartsView((s) => s.filters);
  const setFilters = useChartsView((s) => s.setFilters);
  const persistedSort = useChartsView((s) => s.sort);
  const setSortPersist = useChartsView((s) => s.setSort);
  // Server-side sort: the clicked column drives the list query (params below).
  // Seeded from the persisted value; changes are mirrored back to the store.
  const { sort, toggle: onSort } = useTableSort(persistedSort);
  useEffect(() => {
    setSortPersist(sort);
  }, [sort, setSortPersist]);
  // Re-sorting reorders the whole result set, so snap back to page 1 — otherwise
  // a deep page could land out of range for the newly-ordered list.
  const handleSort = useCallback(
    (column: string) => {
      onSort(column);
      setPage(1);
    },
    [onSort, setPage],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [selfAllocateOpen, setSelfAllocateOpen] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() =>
    loadVisibleColumns(user.role === 'AUDITOR'),
  );
  const columnsBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    saveVisibleColumns(visibleColumns);
  }, [visibleColumns]);

  // Client/Location now live in `filters`; applying the Filter modal already
  // resets to page 1 (see onApply), so no separate scope-change effect is needed.

  // Coders aren't allowed into the worklist detail page, so the Worklist #
  // cell renders as plain text for them and as a link for everyone else.
  const chartColumns = useMemo(
    () => buildChartColumns({ canOpenWorklist: user.role !== 'CODER', currentUserId: user.id }),
    [user.role, user.id],
  );
  const activeColumns = useMemo(
    () => chartColumns.filter((c) => visibleColumns.has(c.key)),
    [chartColumns, visibleColumns],
  );

  // Locked columns can never be removed from the visible set, even if the
  // popover tried — the toggle handler enforces this and we belt-and-braces
  // it here so any other path (URL state, dev tools) stays consistent.
  useEffect(() => {
    let dirty = false;
    const next = new Set(visibleColumns);
    LOCKED_KEYS.forEach((k) => {
      if (!next.has(k)) {
        next.add(k);
        dirty = true;
      }
    });
    if (dirty) setVisibleColumns(next);
  }, [visibleColumns]);

  const summary = useQuery({
    // Pass the full filter set so the priority-tab counts reflect the applied
    // filters, not the client/location-only totals. `filters` never holds the
    // priority tab itself, so every bucket count stays visible.
    queryKey: ['charts', 'summary', filters],
    queryFn: () => getChartsSummary(filters),
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
      // Server-side sort: the clicked column drives the whole result set (not
      // just the visible page). An undefined sortBy lets the backend fall back
      // to its newest-first default.
      sortBy: sort.sortBy,
      sortDir: sort.sortDir,
      ...(tab !== 'ALL' ? { priority: tab } : {}),
    }),
    [filters, page, pageSize, tab, sort.sortBy, sort.sortDir],
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

  // Bulk "retry all errored" — flips every AI-errored chart back to Queued and
  // hands them to the server-side dispatch queue. Invalidate so the tiles +
  // list update at once; the existing 5s pipeline poll then tracks progress.
  const retryMutation = useMutation({
    mutationFn: retryAiErroredCharts,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['charts'] });
      setRetryOpen(false);
    },
  });

  const erroredCount = summary.data?.aiStatusCounts?.errored ?? 0;

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / pageSize)) : 1;

  // Rows arrive already sorted by the server (see params.sortBy/sortDir and the
  // backend's applySort), so the page renders them as-is — no client reordering.
  const sortedItems = list.data?.items ?? [];

  // How many filters are currently applied — drives the toolbar badge and the
  // "Clear filters" button. Counts the same non-empty values the Filter modal
  // sends to the API (blank selects / empty-or-NaN numbers don't count). The
  // search box binds to filters.chartNo, so an active search is reflected here
  // too. The priority tab is shown separately by its own active-tab styling.
  const activeFilterCount = useMemo(
    () =>
      Object.values(filters).filter(
        (v) =>
          v !== '' &&
          v !== undefined &&
          v !== null &&
          !(Array.isArray(v) && v.length === 0) &&
          !(typeof v === 'number' && Number.isNaN(v)),
      ).length,
    [filters],
  );

  const clearFilters = () => {
    setFilters({});
    setPage(1);
  };

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
  // Managers get the "Finalized" bucket (§4.7); everyone else gets "Done" (§4.6).
  const priorityTabs: Array<{ key: 'ALL' | PriorityTab; label: string }> = [
    ...BASE_PRIORITY_TABS,
    isManagerRole ? { key: 'FINALIZED', label: 'Finalized' } : { key: 'DONE', label: 'Done' },
  ];
  const tabsWithCounts = priorityTabs.map((t) => ({
    ...t,
    count:
      t.key === 'ALL'
        // ALL = distinct charts in ≥1 active bucket. Buckets can overlap
        // (§4.4/§4.5), so this is a backend distinct count, not the sum.
        ? pc?.allBucketed
        : t.key === 'DONE'
          ? pc?.doneToday
          : t.key === 'FINALIZED'
            ? pc?.finalized
            : pc?.[t.key.toLowerCase() as keyof typeof pc],
  }));

  return (
    <div className="p-8 max-w-[1600px] space-y-5">
      <PageHeader title="Charts" subtitle="Charts" />

      {canTime && <ActiveTimerCard />}

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

      {/* AI pipeline status + bulk retry. Counts are mutually exclusive per
          chart and auto-refresh every 5s while anything is in flight. */}
      {summary.data?.aiStatusCounts && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-subtle">
              AI Pipeline
            </h2>
            {isManager && (
              <Button
                variant="soft"
                leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                disabled={erroredCount === 0}
                loading={retryMutation.isPending}
                onClick={() => setRetryOpen(true)}
              >
                Retry all errored ({erroredCount})
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryTile label="AI Queued" value={summary.data.aiStatusCounts.queued} tone="sky" />
            <SummaryTile label="AI Processing" value={summary.data.aiStatusCounts.processing} tone="butter" />
            <SummaryTile label="AI Done" value={summary.data.aiStatusCounts.done} tone="mint" />
            <SummaryTile label="AI Errored" value={summary.data.aiStatusCounts.errored} tone="coral" />
          </div>
        </div>
      )}

      <Card padding="none">
        {/* Tabs + actions */}
        <div className="px-6 pt-5">
          <Tabs
            tabs={tabsWithCounts}
            value={tab}
            onChange={(k) => {
              setTab(k as 'ALL' | PriorityTab);
              setPage(1);
              setSelected(new Set());
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 px-6 py-4 border-b border-line">
          <div className="flex-1 min-w-[180px] max-w-xs">
            <SearchInput
              placeholder="Search chart #..."
              value={filters.chartNo ?? ''}
              onChange={(e) => {
                setFilters({ ...filters, chartNo: e.target.value || undefined });
                setPage(1);
              }}
            />
          </div>
          <div className="flex-1 min-w-[180px] max-w-xs">
            <SearchInput
              placeholder="Search encounter ID..."
              value={filters.encounterId ?? ''}
              onChange={(e) => {
                setFilters({ ...filters, encounterId: e.target.value || undefined });
                setPage(1);
              }}
            />
          </div>
          {someSelected && (
            <PillBadge tone="mint">{selected.size} Selected</PillBadge>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="soft"
              leftIcon={<FilterIcon className="w-3.5 h-3.5" />}
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
                onClick={clearFilters}
                title="Clear all applied filters"
              >
                Clear filters
              </Button>
            )}
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
            {canSelfAllocate && (
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
                  <SortableHeader
                    key={col.key}
                    column={col.sortKey}
                    sort={sort}
                    onSort={col.sortKey ? handleSort : undefined}
                  >
                    {col.label}
                  </SortableHeader>
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
              ) : sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={activeColumns.length + 1} className="py-20 text-center text-sm text-ink-muted">
                    No charts match the current filters.
                  </td>
                </tr>
              ) : (
                sortedItems.map((c) => {
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
        columns={chartColumns}
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
      <ConfirmModal
        open={retryOpen}
        onClose={() => setRetryOpen(false)}
        onConfirm={() => retryMutation.mutate()}
        message={`Re-queue ${erroredCount} errored chart${erroredCount === 1 ? '' : 's'} through the AI pipeline? They'll move to Queued and process one at a time. Charts whose worklist was deleted are skipped.`}
        variant="primary"
        confirmLabel="Retry all"
        cancelLabel="Cancel"
        loading={retryMutation.isPending}
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

/* ── Filter modal ────────────────────────────────────────── */
// Every filter field the modal manages, blanked to undefined. Spread this
// UNDER the applied filters when re-seeding the form (`reset({...BLANK, ...value})`).
// react-hook-form's reset() only touches keys present in its payload — a sparse
// payload (e.g. `reset({})` after "Clear all") leaves the controlled dropdowns
// showing their previous selection. Listing every key here forces each field to
// actually clear. Keep in sync with the Controllers/inputs below when adding a
// new filter.
const BLANK_FILTERS: ChartListParams = {
  clientId: undefined,
  locationId: undefined,
  chartNo: undefined,
  encounterId: undefined,
  serialFrom: undefined,
  serialTo: undefined,
  worklistId: undefined,
  allocatedUserId: undefined,
  primarySpecialityId: undefined,
  subSpecialityName: undefined,
  chartStatus: undefined,
  milestone: undefined,
  aiStatus: undefined,
  reviewed: undefined,
  qcStatus: undefined,
  receivedDateFrom: undefined,
  receivedDateTo: undefined,
  dateOfServiceFrom: undefined,
  dateOfServiceTo: undefined,
  codingCompletedFrom: undefined,
  codingCompletedTo: undefined,
};

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
  const { register, control, handleSubmit, reset, watch, setValue } = useForm<ChartListParams>({ defaultValues: value });

  // Hide the "Allocated user" filter from the coder profile: a CODER is already
  // backend-restricted to their own allocated charts, so filtering by another
  // user is meaningless (and would only ever return nothing) for them.
  const user = useAuth((s) => s.user)!;
  const isCoder = user.role === 'CODER';

  // Client / Location multi-select filters — moved here from the global header
  // scope so the Charts page filters by them locally. Location depends on
  // Client: the picker is disabled until at least one client is chosen and
  // only lists the chosen clients' locations (suffixed by client name when
  // more than one client is selected, since location names can repeat).
  const clients = useQuery({
    queryKey: ['configurations', 'clients'],
    queryFn: () => listClients(),
    enabled: open,
  });
  const clientList = clients.data?.items ?? [];
  const rawClientSel = watch('clientId');
  const selectedClientIds =
    rawClientSel === undefined || rawClientSel === null
      ? []
      : Array.isArray(rawClientSel)
      ? rawClientSel.map(String)
      : [String(rawClientSel)];
  const selectedClients = clientList.filter((c) => selectedClientIds.includes(String(c.id)));
  const locationQueries = useQueries({
    queries: selectedClients.map((c) => ({
      queryKey: ['configurations', 'locations', c.id],
      queryFn: () => listLocations(c.id),
      enabled: open,
    })),
  });
  const locationsLoading = locationQueries.some((q) => q.isFetching);
  const locationOptions = (() => {
    const seen = new Map<string, { value: string; label: string }>();
    locationQueries.forEach((q, i) => {
      const client = selectedClients[i];
      (q.data?.items ?? []).forEach((l) => {
        seen.set(String(l.id), {
          value: String(l.id),
          label: selectedClients.length > 1 && client ? `${l.name} · ${client.name}` : l.name,
        });
      });
    });
    return Array.from(seen.values());
  })();

  // Keep the location selection consistent with the client selection: no
  // client → no location filter; deselecting a client drops its locations
  // from the form value (only once the remaining lists have loaded, so a
  // slow fetch can't wipe a still-valid pick).
  const rawLocSel = watch('locationId');
  const selectedLocationIds =
    rawLocSel === undefined || rawLocSel === null
      ? []
      : Array.isArray(rawLocSel)
      ? rawLocSel.map(String)
      : [String(rawLocSel)];
  useEffect(() => {
    if (!open || selectedLocationIds.length === 0) return;
    if (selectedClientIds.length === 0) {
      setValue('locationId', []);
      return;
    }
    if (locationsLoading) return;
    const valid = new Set(locationOptions.map((o) => o.value));
    const kept = selectedLocationIds.filter((v) => valid.has(v));
    if (kept.length !== selectedLocationIds.length) {
      setValue('locationId', kept.map(Number));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedClientIds.join(','), selectedLocationIds.join(','), locationsLoading, locationOptions.length]);

  // Re-seed the form from the currently-applied filters every time the modal
  // opens. The Modal unmounts its inputs on close (`if (!open) return null`) but
  // FilterModal itself stays mounted, so the form is otherwise seeded from
  // `value` only once and then drifts: reopening would show stale selections,
  // an external "Clear filters" wouldn't clear the dropdowns, and deselecting a
  // remounted control could fail. Resetting on open keeps the form in lock-step
  // with the applied filters.
  useEffect(() => {
    // Spread BLANK_FILTERS under the applied filters: reset() ignores keys
    // absent from its payload, so a bare reset(value) would leave dropdowns not
    // present in `value` (i.e. cleared filters) showing their old selection.
    if (open) reset({ ...BLANK_FILTERS, ...value });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Speciality list for its dropdown — all primary specialities (no client
  // scope here). Fetched only while the modal is open.
  const specialities = useQuery({
    queryKey: ['configurations', 'primary-specialities', 'all'],
    queryFn: () => listPrimarySpecialities(),
    enabled: open,
  });

  // All unique sub-speciality names across every location (deduped) — the
  // filter matches by name, not by a location-scoped id, so any location's
  // charts are reachable regardless of the header scope.
  const subSpecs = useQuery({
    queryKey: ['configurations', 'sub-specialities', 'all'],
    queryFn: () => listAllSubSpecialities(),
    enabled: open,
  });

  // Allocated-user dropdown. Users can be many, so search is server-driven:
  // the FancySelect pushes the typed query here (debounced) and we refetch.
  const [userSearch, setUserSearch] = useState('');
  const users = useQuery({
    queryKey: ['users', 'filter', userSearch],
    queryFn: () => listUsers({ pageSize: 50, search: userSearch || undefined }),
    enabled: open && !isCoder,
  });

  // Worklists for the filter dropdown — show the worklist NUMBER (the
  // human-recognisable name), not the surrogate ID. The list endpoint caps
  // pageSize at 200 (shared PageParamsDto @Max), so we page through ALL
  // worklists (newest received first) rather than a single 200 slice —
  // otherwise older worklists silently drop out of the dropdown and its
  // local search can't find them. FancySelect then filters by label locally.
  const worklists = useQuery({
    queryKey: ['worklists', 'filter-options'],
    queryFn: async () => {
      const PAGE_SIZE = 200;
      type Item = Awaited<ReturnType<typeof listWorklists>>['items'][number];
      const all: Item[] = [];
      let page = 1;
      // Hard page bound is a safety net; the short-page check terminates normally.
      while (page <= 100) {
        const res = await listWorklists({ page, pageSize: PAGE_SIZE, sortBy: 'receivedDate', sortDir: 'desc' });
        all.push(...res.items);
        if (res.items.length < PAGE_SIZE || all.length >= res.total) break;
        page += 1;
      }
      return { items: all };
    },
    enabled: open,
  });

  // Normalise a single-or-array filter value to string[] for the multi-selects.
  const arr = (v: unknown): string[] =>
    v === undefined || v === null || v === ''
      ? []
      : Array.isArray(v)
      ? v.map(String)
      : [String(v)];

  return (
    <Modal open={open} onClose={onClose} title="Filter Charts" size="xl">
      <form
        onSubmit={handleSubmit((d) => {
          // Drop blank selects / empty-or-NaN numbers before applying. An
          // untouched select submits value="" and an empty number input
          // submits NaN; the backend's @IsEnum / @IsInt reject both, so we
          // treat them as "no filter on this field" rather than send them.
          const cleaned = Object.fromEntries(
            Object.entries(d).filter(
              ([, v]) =>
                v !== '' &&
                v !== undefined &&
                v !== null &&
                !(Array.isArray(v) && v.length === 0) &&
                !(typeof v === 'number' && Number.isNaN(v)),
            ),
          ) as ChartListParams;
          onApply(cleaned);
          onClose();
        })}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <Label>Client</Label>
            <Controller
              control={control}
              name="clientId"
              render={({ field }) => (
                <FancyMultiSelect
                  searchable
                  searchPlaceholder="Search clients…"
                  placeholder={clients.isPending ? 'Loading…' : 'Any client'}
                  value={arr(field.value)}
                  onChange={(v) => field.onChange(v.map(Number))}
                  options={clientList.map((c) => ({ value: String(c.id), label: c.name }))}
                />
              )}
            />
          </div>
          <div>
            <Label>Location</Label>
            <Controller
              control={control}
              name="locationId"
              render={({ field }) => (
                <FancyMultiSelect
                  searchable
                  searchPlaceholder="Search locations…"
                  placeholder={
                    selectedClientIds.length === 0
                      ? 'Select a client first'
                      : locationsLoading
                      ? 'Loading…'
                      : 'Any location'
                  }
                  loading={locationsLoading}
                  disabled={selectedClientIds.length === 0}
                  value={arr(field.value)}
                  onChange={(v) => field.onChange(v.map(Number))}
                  options={locationOptions}
                />
              )}
            />
          </div>
          <div>
            <Label>Chart #</Label>
            <Input {...register('chartNo')} />
          </div>
          <div>
            <Label>Encounter ID</Label>
            <Input {...register('encounterId')} />
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
            <Label>Worklist</Label>
            <Controller
              control={control}
              name="worklistId"
              render={({ field }) => (
                <FancyMultiSelect
                  searchable
                  searchPlaceholder="Search worklist…"
                  placeholder={worklists.isPending ? 'Loading…' : 'Any worklist'}
                  loading={worklists.isFetching}
                  value={arr(field.value)}
                  onChange={(v) => field.onChange(v.map(Number))}
                  options={(worklists.data?.items ?? []).map((w) => ({
                    value: String(w.id),
                    label: w.worklistNumber,
                  }))}
                />
              )}
            />
          </div>
          {!isCoder && (
            <div>
              <Label>Allocated user</Label>
              <Controller
                control={control}
                name="allocatedUserId"
                render={({ field }) => (
                  <FancyMultiSelect
                    searchable
                    onSearch={setUserSearch}
                    loading={users.isFetching}
                    searchPlaceholder="Search users…"
                    placeholder="Any user"
                    value={arr(field.value)}
                    onChange={(v) => field.onChange(v.map(Number))}
                    options={(users.data?.items ?? []).map((u) => ({
                      value: String(u.id),
                      label: u.fullName,
                    }))}
                  />
                )}
              />
            </div>
          )}
          <div>
            <Label>Primary Speciality</Label>
            <Controller
              control={control}
              name="primarySpecialityId"
              render={({ field }) => (
                <FancyMultiSelect
                  searchable
                  searchPlaceholder="Search specialities…"
                  placeholder={specialities.isPending ? 'Loading…' : 'Any speciality'}
                  value={arr(field.value)}
                  onChange={(v) => field.onChange(v.map(Number))}
                  options={(specialities.data?.items ?? []).map((s) => ({
                    value: String(s.id),
                    label: s.name,
                  }))}
                />
              )}
            />
          </div>
          <div>
            <Label>Sub Speciality</Label>
            <Controller
              control={control}
              name="subSpecialityName"
              render={({ field }) => (
                <FancyMultiSelect
                  searchable
                  searchPlaceholder="Search sub-specialities…"
                  placeholder={subSpecs.isPending ? 'Loading…' : 'Any sub-speciality'}
                  loading={subSpecs.isFetching}
                  value={arr(field.value)}
                  onChange={(v) => field.onChange(v)}
                  options={(subSpecs.data?.items ?? []).map((s) => ({
                    value: s.name,
                    label: s.name,
                  }))}
                />
              )}
            />
          </div>
          <div>
            <Label>Status</Label>
            <Controller
              control={control}
              name="chartStatus"
              render={({ field }) => (
                <FancyMultiSelect
                  placeholder="Any"
                  options={CHART_STATUS_OPTIONS}
                  value={arr(field.value)}
                  onChange={(v) => field.onChange(v as ChartListParams['chartStatus'])}
                />
              )}
            />
          </div>
          <div>
            <Label>Milestone</Label>
            <Controller
              control={control}
              name="milestone"
              render={({ field }) => (
                <FancyMultiSelect
                  placeholder="Any"
                  options={MILESTONE_OPTIONS}
                  value={arr(field.value)}
                  onChange={(v) => field.onChange(v as ChartListParams['milestone'])}
                />
              )}
            />
          </div>
          <div>
            <Label>AI Status</Label>
            <Controller
              control={control}
              name="aiStatus"
              render={({ field }) => (
                <FancyMultiSelect
                  placeholder="Any"
                  options={AI_STATUS_OPTIONS}
                  value={arr(field.value)}
                  onChange={(v) => field.onChange(v as ChartListParams['aiStatus'])}
                />
              )}
            />
          </div>
          <div>
            <Label>Reviewed</Label>
            <Controller
              control={control}
              name="reviewed"
              render={({ field }) => (
                <FancySelect
                  placeholder="Any"
                  options={REVIEWED_OPTIONS}
                  value={field.value ?? ''}
                  onChange={(v) => field.onChange(v as ChartListParams['reviewed'])}
                />
              )}
            />
          </div>
          <div>
            <Label>QC Status</Label>
            <Controller
              control={control}
              name="qcStatus"
              render={({ field }) => (
                <FancyMultiSelect
                  placeholder="Any"
                  options={QC_STATUS_FILTER_OPTIONS}
                  value={arr(field.value)}
                  onChange={(v) => field.onChange(v)}
                />
              )}
            />
          </div>
          {/* Date filters: each From/To pair is a single two-month range picker
              (matches the worklist "Date of service" field). The hidden inputs
              keep the ...From/...To keys the backend expects registered with RHF;
              the picker bridges them via watch/setValue. */}
          <div>
            <Label>Received date</Label>
            <input type="hidden" {...register('receivedDateFrom')} />
            <input type="hidden" {...register('receivedDateTo')} />
            <RangeDatePicker
              value={{ from: watch('receivedDateFrom') ?? null, to: watch('receivedDateTo') ?? null }}
              onChange={({ from, to }) => {
                setValue('receivedDateFrom', from ?? undefined);
                setValue('receivedDateTo', to ?? undefined);
              }}
              placeholder="Any received date"
            />
          </div>
          <div>
            <Label>Date of service</Label>
            <input type="hidden" {...register('dateOfServiceFrom')} />
            <input type="hidden" {...register('dateOfServiceTo')} />
            <RangeDatePicker
              value={{ from: watch('dateOfServiceFrom') ?? null, to: watch('dateOfServiceTo') ?? null }}
              onChange={({ from, to }) => {
                setValue('dateOfServiceFrom', from ?? undefined);
                setValue('dateOfServiceTo', to ?? undefined);
              }}
              placeholder="Any service date"
            />
          </div>
          <div>
            <Label>Date of coding</Label>
            <input type="hidden" {...register('codingCompletedFrom')} />
            <input type="hidden" {...register('codingCompletedTo')} />
            <RangeDatePicker
              value={{ from: watch('codingCompletedFrom') ?? null, to: watch('codingCompletedTo') ?? null }}
              onChange={({ from, to }) => {
                setValue('codingCompletedFrom', from ?? undefined);
                setValue('codingCompletedTo', to ?? undefined);
              }}
              placeholder="Any coding date"
            />
          </div>
        </div>

        <ModalFooter>
          <Button variant="ghost" type="button" onClick={() => { reset({ ...BLANK_FILTERS }); onApply({}); onClose(); }}>
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
  columns,
  visible,
  onChange,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  columns: ColumnDef[];
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
    // Locked columns ignore the toggle — checkbox is disabled too, but this
    // is the source-of-truth guard for any other entry point.
    if (LOCKED_KEYS.has(key)) return;
    const next = new Set(visible);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  }

  function resetDefaults() {
    const next = new Set(columns.filter((c) => c.defaultVisible).map((c) => c.key));
    LOCKED_KEYS.forEach((k) => next.add(k));
    onChange(next);
  }

  function showAll() {
    onChange(new Set(columns.map((c) => c.key)));
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
        {columns.map((col) => {
          const checked = visible.has(col.key);
          const locked = !!col.locked;
          return (
            <label
              key={col.key}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 rounded-md',
                locked
                  ? 'cursor-not-allowed opacity-70'
                  : 'cursor-pointer hover:bg-surface-sunken/60',
              )}
              title={locked ? 'Always shown' : undefined}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={locked}
                onChange={() => toggle(col.key)}
                className="checkbox"
              />
              <span className="text-sm text-ink">{col.label}</span>
              {locked && (
                <span className="ml-auto text-[10px] uppercase tracking-wide text-ink-subtle">
                  Locked
                </span>
              )}
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

  const { register, control, handleSubmit, watch } = useForm<{
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
          <Controller
            control={control}
            name="priority"
            render={({ field }) => (
              <FancySelect
                value={field.value ?? ''}
                onChange={(v) => field.onChange(v)}
                // A manual override (§7.3) reverts once the allocated user
                // touches the chart. "Done" is a touched-today view, not an
                // assignable priority, so it isn't offered here.
                options={[
                  { value: '', label: 'Keep current' },
                  { value: 'CRITICAL', label: 'Critical' },
                  { value: 'HIGH', label: 'High' },
                  { value: 'MEDIUM', label: 'Medium' },
                  { value: 'LOW', label: 'Low' },
                ]}
              />
            )}
          />
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
            <Controller
              control={control}
              name="assigneeId"
              render={({ field }) => (
                <FancySelect
                  searchable
                  searchPlaceholder="Search by name or email…"
                  placeholder={users.isPending ? 'Loading…' : 'Select user…'}
                  value={field.value != null ? String(field.value) : ''}
                  onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                  options={(users.data?.items ?? []).map((u) => ({
                    value: String(u.id),
                    label: u.fullName,
                    searchText: u.email,
                  }))}
                />
              )}
            />
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
  const user = useAuth((s) => s.user);
  // Team-Lead / Manager self-allocate seizes BOTH slots; an auditor only the
  // auditor slot. Either way, charts already allocated to others are reassigned
  // (not skipped) — only charts someone is actively timing are skipped.
  const takesBothSlots = user?.role === 'TEAMLEAD' || user?.role === 'MANAGER';
  const [result, setResult] = useState<SelfAllocateResult | null>(null);
  const mutation = useMutation({
    mutationFn: () => selfAllocateCharts(selectedIds.map(Number)),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['charts'] });
      qc.invalidateQueries({ queryKey: ['active-timer'] });
      // If some charts were skipped (someone's working on them), surface a
      // toast before finishing. Otherwise close straight away.
      if (res.skipped.length > 0) setResult(res);
      else onComplete();
    },
  });

  const skipped = result?.skipped.length ?? 0;
  const allocated = result?.allocated ?? 0;
  const toastMsg =
    allocated > 0
      ? `Allocated ${allocated} chart${allocated === 1 ? '' : 's'}. ${skipped} skipped — someone is already working on ${skipped === 1 ? 'it' : 'them'}.`
      : `Couldn't allocate — someone is already working on the selected chart${skipped === 1 ? '' : 's'}.`;

  return (
    <>
      <ConfirmModal
        open={open && !result}
        onClose={onClose}
        onConfirm={() => mutation.mutate()}
        message={`Allocate ${selectedIds.length} chart${selectedIds.length === 1 ? '' : 's'} to yourself? Any chart already allocated to another user will be reassigned to you${takesBothSlots ? ' (taking over both the coder and auditor slots)' : ''}. Only charts someone is actively timing are skipped.`}
        variant="primary"
        confirmLabel="Allocate"
        cancelLabel="Cancel"
        loading={mutation.isPending}
      />
      <Toast
        open={!!result}
        message={toastMsg}
        variant={allocated > 0 ? 'success' : 'warn'}
        onClose={() => {
          setResult(null);
          onComplete();
        }}
      />
    </>
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
    // Only tick for a running timer — a paused chart shows a frozen total.
    if (!active || active.paused) return;
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

  const paused = !!active.paused;
  const elapsed = paused
    ? Math.floor(active.elapsedMs / 1000)
    : Math.max(0, Math.floor((now - Date.parse(active.startedAt)) / 1000));

  return (
    <Link to={`/charts/${active.chartId}`} className="block group">
      <div
        className={cn(
          'rounded-card border px-5 py-4 flex items-center gap-4 hover:shadow-card transition',
          paused
            ? 'border-warn/40 bg-warn-soft/40'
            : 'border-primary/40 bg-gradient-to-r from-primary-soft/60 to-warn-soft/40',
        )}
      >
        <div
          className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center shrink-0',
            paused ? 'bg-warn/20' : 'bg-primary/20',
          )}
        >
          {paused ? (
            <Pause className="w-4 h-4 text-warn" />
          ) : (
            <Clock className="w-4 h-4 text-primary-ink dark:text-primary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              'text-[11px] uppercase tracking-[0.1em] font-bold',
              paused ? 'text-warn' : 'text-primary-ink dark:text-primary',
            )}
          >
            {paused ? 'Paused — click to resume' : 'Currently working on'}
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
          <p className="text-[11px] text-ink-muted">{paused ? 'paused' : 'elapsed'}</p>
        </div>
        <ChevronRight className="w-4 h-4 text-ink-muted group-hover:text-ink transition shrink-0" />
      </div>
    </Link>
  );
}
