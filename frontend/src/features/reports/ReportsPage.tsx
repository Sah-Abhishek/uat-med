import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getReportFields,
  getReportFieldValues,
  runReportQuery,
  listReportTemplates,
  createReportTemplate,
  updateReportTemplate,
  deleteReportTemplate,
  downloadReportXlsx,
  type QueryReportDto,
} from '@/api/reports';
import type { ApiErrorShape, ReportField, ReportTemplate } from '@/api/types';
import { useAuth } from '@/auth/store';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CollapsibleCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, SearchInput, FancyMultiSelect, RangeDatePicker } from '@/components/ui/Field';
import { Modal, ModalFooter, Pagination } from '@/components/ui/Primitives';
import { formatDate, formatNumber } from '@/lib/utils';
import {
  Settings2,
  Save,
  Loader2,
  Play,
  FileSpreadsheet,
  Trash2,
  BookmarkPlus,
  CheckCircle2,
  X,
} from 'lucide-react';

/** A date-range filter — either bound may be unset. */
type DateRange = { from: string | null; to: string | null };
/**
 * A single filter value. `text` fields store a string, `select` fields a
 * string[] (→ IN clause), `date` fields a DateRange (→ from/to). The backend
 * discriminates on the runtime shape, so no per-key type map is needed here.
 */
type FilterValue = string | string[] | DateRange;

interface QueryState {
  columns: string[];
  filters: Record<string, FilterValue>;
  /** Which filter controls the Filters section shows. `null` = a fresh report
   *  (show all filters); a template load sets it to the template's saved set. */
  filterKeys: string[] | null;
  sort: QueryReportDto['sort'];
  page: number;
}

function isDateRange(v: FilterValue | undefined | null): v is DateRange {
  return typeof v === 'object' && v != null && !Array.isArray(v) && ('from' in v || 'to' in v);
}

const DEFAULT_COLUMNS = [
  'worklistNumber',
  'chartNo',
  'client',
  'allocatedCoder',
  'priority',
  'milestone',
  'chartStatus',
  'receivedDate',
];
const PAGE_SIZE = 50;

function arrayEqual<T>(a: T[], b: T[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Order-insensitive equality for a set of keys (used for filter-key sets). */
function setEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((k) => sb.has(k));
}

/** Drop filter values whose control is no longer shown, so a hidden filter
 *  can't keep silently constraining the query. */
function pruneFilters(filters: Record<string, FilterValue>, keys: string[]): Record<string, FilterValue> {
  const allow = new Set(keys);
  const out: Record<string, FilterValue> = {};
  for (const [k, v] of Object.entries(filters)) if (allow.has(k)) out[k] = v;
  return out;
}

export function ReportsPage() {
  const currentUser = useAuth(s => s.user);
  const [state, setState] = useState<QueryState>({
    columns: DEFAULT_COLUMNS,
    filters: {},
    filterKeys: null,
    sort: [],
    page: 1,
  });
  const [activeTemplate, setActiveTemplate] = useState<ReportTemplate | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const fields = useQuery({ queryKey: ['reports', 'fields'], queryFn: getReportFields });

  // Every filterable field, in catalog order — the default Filters set for a
  // fresh report (state.filterKeys === null). A loaded template narrows this.
  const allFilterKeys = useMemo(
    () => (fields.data ?? []).filter((f) => f.filterable).map((f) => f.key),
    [fields.data],
  );
  const effectiveFilterKeys = state.filterKeys ?? allFilterKeys;

  const query = useQuery({
    queryKey: ['reports', 'query', state],
    queryFn: () =>
      runReportQuery({
        columns: state.columns,
        filters: cleanFilters(state.filters),
        sort: state.sort,
        page: state.page,
        pageSize: PAGE_SIZE,
      }),
    enabled: state.columns.length > 0,
    placeholderData: (prev) => prev,
  });

  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / PAGE_SIZE)) : 1;

  const downloadMutation = useMutation({
    mutationFn: () =>
      downloadReportXlsx(
        {
          columns: state.columns,
          filters: cleanFilters(state.filters),
          sort: state.sort,
        },
        activeTemplate?.name,
      ),
    onError: (e) => setDownloadError((e as unknown as ApiErrorShape).message ?? 'Excel export failed.'),
  });

  /** True when the active template's saved spec (columns + filter set) differs
   *  from the current builder state. Filter VALUES aren't part of a template. */
  const isDirty = useMemo(() => {
    if (!activeTemplate) return false;
    return (
      !arrayEqual(activeTemplate.columns, state.columns) ||
      !setEqual(activeTemplate.filterKeys ?? [], state.filterKeys ?? [])
    );
  }, [activeTemplate, state.columns, state.filterKeys]);

  function loadTemplate(t: ReportTemplate) {
    setActiveTemplate(t);
    // Show only the template's fields + filters; filter values start blank.
    setState({
      columns: t.columns,
      filters: {},
      filterKeys: t.filterKeys ?? [],
      sort: [],
      page: 1,
    });
  }

  function discardChanges() {
    if (!activeTemplate) return;
    setState({
      columns: activeTemplate.columns,
      filters: {},
      filterKeys: activeTemplate.filterKeys ?? [],
      sort: [],
      page: 1,
    });
  }

  function newReport() {
    setActiveTemplate(null);
    setState({ columns: DEFAULT_COLUMNS, filters: {}, filterKeys: null, sort: [], page: 1 });
  }

  return (
    <div className="p-8 max-w-[1600px] space-y-5">
      <PageHeader
        title="Reports"
        subtitle="Build, save, and export tabular reports across charts."
      />

      {downloadError && (
        <div className="card p-3 flex items-center gap-3 border-danger/30">
          <X className="w-4 h-4 text-danger" />
          <div className="text-sm text-danger flex-1">{downloadError}</div>
          <Button variant="ghost" size="sm" onClick={() => setDownloadError(null)}>Dismiss</Button>
        </div>
      )}

      {/* ── Saved templates table ─────────────────────────── */}
      <SavedTemplatesSection
        currentUserId={currentUser?.id}
        currentUserRole={currentUser?.role}
        activeTemplateId={activeTemplate?.id ?? null}
        onLoad={loadTemplate}
        onNew={newReport}
      />

      {/* ── Active template banner ────────────────────────── */}
      {activeTemplate && (
        <ActiveTemplateBanner
          template={activeTemplate}
          isDirty={isDirty}
          onDiscard={discardChanges}
          onUpdate={() => setCustomizeOpen(true)}
          onClose={newReport}
        />
      )}

      {/* ── Filters ────────────────────────────────────────── */}
      <FiltersSection
        fields={fields.data ?? []}
        filterKeys={effectiveFilterKeys}
        scopedToTemplate={state.filterKeys !== null}
        values={state.filters}
        onChange={(filters) => setState(s => ({ ...s, filters, page: 1 }))}
        onClear={() => setState(s => ({ ...s, filters: {}, page: 1 }))}
        onRun={() => query.refetch()}
      />

      {/* ── Results ────────────────────────────────────────── */}
      <Card padding="none">
        <div className="flex items-center justify-between px-6 py-5 border-b border-line">
          <div>
            <h2 className="text-[15px] font-bold text-ink">
              Results ({formatNumber(query.data?.total ?? 0)})
            </h2>
            <p className="text-xs text-ink-muted mt-0.5">
              {state.columns.length} column{state.columns.length === 1 ? '' : 's'}
              {' · '}page {state.page} of {totalPages}
              {activeTemplate && (
                <>
                  {' · '}
                  template <span className="font-semibold text-ink">{activeTemplate.name}</span>
                  {isDirty && <span className="ml-1 text-warn">(unsaved changes)</span>}
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="soft"
              leftIcon={<Settings2 className="w-3.5 h-3.5" />}
              onClick={() => setCustomizeOpen(true)}
            >
              {activeTemplate && isDirty ? 'Customize / Save changes' : 'Customize / Save template'}
            </Button>
            <Button
              leftIcon={<FileSpreadsheet className="w-3.5 h-3.5" />}
              loading={downloadMutation.isPending}
              disabled={!query.data || query.data.total === 0}
              onClick={() => {
                setDownloadError(null);
                downloadMutation.mutate();
              }}
            >
              Export to Excel
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr>
                {state.columns.map((key) => (
                  <th key={key} className="table-head whitespace-nowrap">
                    {fields.data?.find((f) => f.key === key)?.label ?? key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.isPending ? (
                <tr>
                  <td colSpan={state.columns.length} className="py-16 text-center">
                    <Loader2 className="w-5 h-5 animate-spin inline text-ink-muted" />
                  </td>
                </tr>
              ) : query.data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={state.columns.length} className="py-20 text-center text-sm text-ink-muted">
                    No rows match the current filters.
                  </td>
                </tr>
              ) : (
                query.data?.rows.map((row, i) => (
                  <tr key={i} className="hover:bg-surface-sunken/40 transition">
                    {row.map((cell, j) => (
                      <td key={j} className="table-cell">
                        {cell == null || cell === '' ? (
                          <span className="text-ink-subtle">—</span>
                        ) : (
                          String(cell)
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={state.page}
          pageCount={totalPages}
          onPageChange={(p) => setState((s) => ({ ...s, page: p }))}
        />
      </Card>

      <CustomizeTemplateModal
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        fields={fields.data ?? []}
        currentColumns={state.columns}
        currentFilterKeys={effectiveFilterKeys}
        activeTemplate={activeTemplate}
        currentUserId={currentUser?.id}
        canManageAny={currentUser?.role === 'TEAMLEAD' || currentUser?.role === 'MANAGER'}
        onApply={(cols, fks) =>
          setState((s) => ({ ...s, columns: cols, filterKeys: fks, filters: pruneFilters(s.filters, fks), page: 1 }))
        }
        onSaved={(t) => {
          setActiveTemplate(t);
          const fks = t.filterKeys ?? [];
          setState((s) => ({ ...s, columns: t.columns, filterKeys: fks, filters: pruneFilters(s.filters, fks), page: 1 }));
        }}
      />
    </div>
  );
}

/**
 * Strips empty values so the backend never filters on nothing: blank text,
 * empty multi-selects, and date ranges with neither bound set are all dropped.
 * A range keeps only the bounds that are actually set.
 */
function cleanFilters(f: Record<string, FilterValue>): Record<string, string | string[] | { from?: string; to?: string }> {
  const out: Record<string, string | string[] | { from?: string; to?: string }> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v == null) continue;
    if (typeof v === 'string') {
      if (v.trim() !== '') out[k] = v;
    } else if (Array.isArray(v)) {
      if (v.length) out[k] = v;
    } else if (isDateRange(v)) {
      const range: { from?: string; to?: string } = {};
      if (v.from) range.from = v.from;
      if (v.to) range.to = v.to;
      if (range.from || range.to) out[k] = range;
    }
  }
  return out;
}

/* ── Saved Templates section (inline table) ─────────────── */
function SavedTemplatesSection({
  currentUserId,
  currentUserRole,
  activeTemplateId,
  onLoad,
  onNew,
}: {
  currentUserId: string | undefined;
  currentUserRole: string | undefined;
  activeTemplateId: number | string | null;
  onLoad: (t: ReportTemplate) => void;
  onNew: () => void;
}) {
  const qc = useQueryClient();
  const templates = useQuery({
    queryKey: ['reports', 'templates'],
    queryFn: () => listReportTemplates(1, 50),
  });

  const delMutation = useMutation({
    mutationFn: (id: string | number) => deleteReportTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', 'templates'] }),
  });

  const canManageAny = currentUserRole === 'TEAMLEAD' || currentUserRole === 'MANAGER';

  return (
    <CollapsibleCard
      title="Saved Templates"
      subtitle="Load a saved report definition or start from a blank one."
      defaultOpen
      actions={
        <Button size="sm" variant="ghost" onClick={onNew}>
          New report
        </Button>
      }
    >
      <div className="overflow-x-auto -mx-6">
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-head">Template</th>
              <th className="table-head">Columns</th>
              <th className="table-head">Filters</th>
              <th className="table-head">Updated</th>
              <th className="table-head w-32 text-right pr-6">Actions</th>
            </tr>
          </thead>
          <tbody>
            {templates.isPending ? (
              <tr>
                <td colSpan={5} className="py-10 text-center">
                  <Loader2 className="w-4 h-4 animate-spin inline text-ink-muted" />
                </td>
              </tr>
            ) : (templates.data?.items.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-sm text-ink-muted">
                  No saved templates yet. Configure filters + columns and click <span className="font-semibold">Save as template</span>.
                </td>
              </tr>
            ) : (
              templates.data?.items.map((t) => {
                const isActive = String(t.id) === String(activeTemplateId);
                const isOwn = String(t.ownerId) === String(currentUserId);
                const filterCount = t.filterKeys?.length ?? 0;
                return (
                  <tr
                    key={t.id}
                    className={
                      'transition ' +
                      (isActive ? 'bg-primary-soft/40' : 'hover:bg-surface-sunken/40')
                    }
                  >
                    <td className="table-cell font-semibold text-ink">
                      <div className="flex items-center gap-2">
                        {isActive && <CheckCircle2 className="w-3.5 h-3.5 text-success flex-shrink-0" />}
                        <span className="truncate">
                          <span className="font-normal text-ink-muted">
                            {t.ownerName ?? 'Unknown'}
                            {isOwn && ' (you)'} —{' '}
                          </span>
                          {t.name}
                        </span>
                      </div>
                    </td>
                    <td className="table-cell text-ink-muted text-xs">
                      {t.columns.length} column{t.columns.length === 1 ? '' : 's'}
                    </td>
                    <td className="table-cell text-ink-muted text-xs">
                      {filterCount === 0 ? '—' : `${filterCount} filter${filterCount === 1 ? '' : 's'}`}
                    </td>
                    <td className="table-cell text-ink-muted text-xs">
                      {formatDate(t.updatedAt)}
                    </td>
                    <td className="table-cell text-right pr-6">
                      <div className="inline-flex items-center gap-1">
                        <Button size="sm" variant={isActive ? 'soft' : 'primary'} onClick={() => onLoad(t)}>
                          {isActive ? 'Loaded' : 'Load'}
                        </Button>
                        {(isOwn || canManageAny) && (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Delete template "${t.name}"?`)) {
                                delMutation.mutate(t.id);
                              }
                            }}
                            className="w-7 h-7 rounded-full text-danger hover:bg-danger-soft flex items-center justify-center"
                            title="Delete template"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </CollapsibleCard>
  );
}

/* ── Active template banner ─────────────────────────────── */
function ActiveTemplateBanner({
  template,
  isDirty,
  onDiscard,
  onUpdate,
  onClose,
}: {
  template: ReportTemplate;
  isDirty: boolean;
  onDiscard: () => void;
  onUpdate: () => void;
  onClose: () => void;
}) {
  return (
    <div className="card flex items-center gap-3 px-4 py-3 border-primary/30">
      <BookmarkPlus className="w-4 h-4 text-primary-ink dark:text-primary" />
      <div className="text-sm text-ink flex-1 min-w-0">
        Editing template <span className="font-semibold">{template.name}</span>
        {isDirty && <span className="ml-2 text-warn font-medium">unsaved changes</span>}
      </div>
      {isDirty && (
        <>
          <Button size="sm" variant="ghost" onClick={onDiscard}>Discard</Button>
          <Button size="sm" leftIcon={<Save className="w-3 h-3" />} onClick={onUpdate}>
            Save changes
          </Button>
        </>
      )}
      <button
        type="button"
        onClick={onClose}
        className="w-7 h-7 rounded-full text-ink-muted hover:bg-surface-sunken flex items-center justify-center"
        title="Close template"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/* ── Filters card ───────────────────────────────────────── */
function FiltersSection({
  fields,
  filterKeys,
  scopedToTemplate,
  values,
  onChange,
  onClear,
  onRun,
}: {
  fields: ReportField[];
  /** The filter controls to show, in order (a template's set, or all filters). */
  filterKeys: string[];
  /** True when a template is scoping the set (affects the empty-state copy). */
  scopedToTemplate: boolean;
  values: Record<string, FilterValue>;
  onChange: (next: Record<string, FilterValue>) => void;
  onClear: () => void;
  onRun: () => void;
}) {
  // Resolve the requested keys to field defs (filterable only), preserving order.
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const filterable = useMemo(
    () => filterKeys.map((k) => byKey.get(k)).filter((f): f is ReportField => !!f && f.filterable),
    [filterKeys, byKey],
  );
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? filterable : filterable.slice(0, 8);

  // Set (or clear, when the control hands back an "empty" value) a single field.
  const setField = (key: string, next: FilterValue | undefined) => {
    const merged = { ...values };
    if (next === undefined) delete merged[key];
    else merged[key] = next;
    onChange(merged);
  };

  return (
    <CollapsibleCard
      title="Filters"
      subtitle="Numbers match by substring; pick values or a date range for the rest. Leave blank to include everything."
      defaultOpen
    >
      {filterable.length === 0 ? (
        <p className="text-sm text-ink-muted pt-3">
          {scopedToTemplate
            ? 'This template has no filters. Open “Customize / Save” to add some.'
            : 'No filters available.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 pt-3">
          {visible.map((f) => (
            <div key={f.key}>
              <Label>{f.label}</Label>
              <FilterControl
                field={f}
                value={values[f.key]}
                onChange={(v) => setField(f.key, v)}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mt-5">
        <div>
          {filterable.length > 8 && (
            <Button variant="ghost" size="sm" onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Show fewer filters' : `Show all ${filterable.length} filters`}
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClear}>Clear</Button>
          <Button leftIcon={<Play className="w-3.5 h-3.5" />} onClick={onRun}>Run</Button>
        </div>
      </div>
    </CollapsibleCard>
  );
}

/** Renders the correct control for a field: text input, date-range picker, or
 *  multi-select dropdown. Hands `undefined` back to the parent when cleared. */
function FilterControl({
  field,
  value,
  onChange,
}: {
  field: ReportField;
  value: FilterValue | undefined;
  onChange: (next: FilterValue | undefined) => void;
}) {
  const kind = field.filterKind ?? (field.type === 'date' ? 'date' : 'select');

  if (kind === 'text') {
    return (
      <Input
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        placeholder="Any"
      />
    );
  }

  if (kind === 'date') {
    const range = isDateRange(value) ? value : { from: null, to: null };
    return (
      <RangeDatePicker
        value={range}
        onChange={(v) => onChange(v.from || v.to ? v : undefined)}
        placeholder="Any date"
      />
    );
  }

  // select — normalise a stray string (e.g. from a legacy template) to string[].
  const selected = Array.isArray(value) ? value : value ? [String(value)] : [];
  return <SelectFilter field={field} value={selected} onChange={onChange} />;
}

/**
 * Multi-select dropdown for a `select` field. Enum fields carry static options;
 * every other field pulls its distinct values live (searchable server-side so
 * large fields — diagnoses, users — stay responsive).
 */
function SelectFilter({
  field,
  value,
  onChange,
}: {
  field: ReportField;
  value: string[];
  onChange: (next: FilterValue | undefined) => void;
}) {
  const [search, setSearch] = useState('');
  const hasStatic = (field.options?.length ?? 0) > 0;

  const q = useQuery({
    queryKey: ['reports', 'field-values', field.key, search],
    queryFn: () => getReportFieldValues(field.key, search || undefined),
    enabled: !hasStatic,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const options = hasStatic
    ? field.options!
    : (q.data ?? []).map((v) => ({ value: v, label: v }));

  return (
    <FancyMultiSelect
      searchable={!hasStatic}
      onSearch={hasStatic ? undefined : setSearch}
      loading={!hasStatic && q.isFetching}
      searchPlaceholder={`Search ${field.label.toLowerCase()}…`}
      placeholder={!hasStatic && q.isPending ? 'Loading…' : 'Any'}
      value={value}
      onChange={(v) => onChange(v.length ? v : undefined)}
      options={options}
    />
  );
}

/* ── Customize & Save template modal (two-pane: fields + filters) ── */
function CustomizeTemplateModal({
  open,
  onClose,
  fields,
  currentColumns,
  currentFilterKeys,
  activeTemplate,
  currentUserId,
  canManageAny,
  onApply,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  fields: ReportField[];
  currentColumns: string[];
  currentFilterKeys: string[];
  activeTemplate: ReportTemplate | null;
  currentUserId: string | undefined;
  canManageAny: boolean;
  /** Apply the chosen fields + filters to the current view without saving. */
  onApply: (columns: string[], filterKeys: string[]) => void;
  onSaved: (t: ReportTemplate) => void;
}) {
  const qc = useQueryClient();
  const filterableFields = useMemo(() => fields.filter((f) => f.filterable), [fields]);

  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set(currentColumns));
  const [selectedFilters, setSelectedFilters] = useState<Set<string>>(new Set(currentFilterKeys));
  const [colSearch, setColSearch] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'update' | 'new'>('new');
  const [err, setErr] = useState<string | null>(null);

  // Only the creator (or an admin) may overwrite an existing template.
  const canUpdateActive =
    !!activeTemplate && (String(activeTemplate.ownerId) === String(currentUserId) || canManageAny);

  useEffect(() => {
    if (!open) return;
    setSelectedCols(new Set(currentColumns));
    setSelectedFilters(new Set(currentFilterKeys));
    setColSearch('');
    setFilterSearch('');
    setErr(null);
    setName(activeTemplate ? activeTemplate.name : '');
    setMode(canUpdateActive ? 'update' : 'new');
  }, [open, currentColumns, currentFilterKeys, activeTemplate, canUpdateActive]);

  // Column order = keep the current order, then append newly-checked fields in
  // catalog order. Filter set follows catalog order among filterable fields.
  const orderedColumns = [
    ...currentColumns.filter((k) => selectedCols.has(k)),
    ...fields.filter((f) => selectedCols.has(f.key) && !currentColumns.includes(f.key)).map((f) => f.key),
  ];
  const orderedFilterKeys = filterableFields.filter((f) => selectedFilters.has(f.key)).map((f) => f.key);

  const colFiltered = fields.filter((f) => f.label.toLowerCase().includes(colSearch.toLowerCase()));
  const filterFiltered = filterableFields.filter((f) => f.label.toLowerCase().includes(filterSearch.toLowerCase()));

  const dto = () => ({ name: name.trim(), columns: orderedColumns, filters: {}, filterKeys: orderedFilterKeys });

  const create = useMutation({
    mutationFn: () => createReportTemplate(dto()),
    onSuccess: async () => {
      const list = await qc.fetchQuery({ queryKey: ['reports', 'templates'], queryFn: () => listReportTemplates(1, 50) });
      // Disambiguate same-named templates across users by matching the owner too.
      const created = list.items.find((t) => t.name === name.trim() && String(t.ownerId) === String(currentUserId));
      if (created) onSaved(created);
      qc.invalidateQueries({ queryKey: ['reports', 'templates'] });
      onClose();
    },
    onError: (e) => setErr((e as unknown as ApiErrorShape).message ?? 'Save failed.'),
  });

  const update = useMutation({
    mutationFn: () => updateReportTemplate(activeTemplate!.id, dto()),
    onSuccess: (t) => {
      onSaved(t);
      qc.invalidateQueries({ queryKey: ['reports', 'templates'] });
      onClose();
    },
    onError: (e) => setErr((e as unknown as ApiErrorShape).message ?? 'Save failed.'),
  });

  const submitting = create.isPending || update.isPending;
  const noColumns = selectedCols.size === 0;

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    setter(next);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Customize & save template"
      subtitle="Pick the table columns and the filters this report exposes, then apply or save."
      size="xl"
    >
      <div className="space-y-4">
        {err && <div className="text-xs px-3 py-2 rounded bg-danger-soft text-danger">{err}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Fields → table columns */}
          <CheckboxPane
            title="Fields (table columns)"
            hint="Shown as columns in the results table and the Excel export."
            search={colSearch}
            onSearch={setColSearch}
            items={colFiltered}
            selected={selectedCols}
            onToggle={(k) => toggle(selectedCols, setSelectedCols, k)}
            onAll={() => setSelectedCols(new Set(fields.map((f) => f.key)))}
            onNone={() => setSelectedCols(new Set())}
            countLabel={`${selectedCols.size} of ${fields.length} selected`}
          />
          {/* Filters → Filters section */}
          <CheckboxPane
            title="Filters"
            hint="Shown as filter controls in the Filters section."
            search={filterSearch}
            onSearch={setFilterSearch}
            items={filterFiltered}
            selected={selectedFilters}
            onToggle={(k) => toggle(selectedFilters, setSelectedFilters, k)}
            onAll={() => setSelectedFilters(new Set(filterableFields.map((f) => f.key)))}
            onNone={() => setSelectedFilters(new Set())}
            countLabel={`${selectedFilters.size} of ${filterableFields.length} selected`}
          />
        </div>

        {canUpdateActive && (
          <div className="flex gap-2 p-1 bg-surface-sunken rounded-lg text-xs font-medium">
            <button
              type="button"
              onClick={() => setMode('update')}
              className={`flex-1 py-2 rounded-md transition ${mode === 'update' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted'}`}
            >
              Update "{activeTemplate!.name}"
            </button>
            <button
              type="button"
              onClick={() => setMode('new')}
              className={`flex-1 py-2 rounded-md transition ${mode === 'new' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted'}`}
            >
              Save as new
            </button>
          </div>
        )}

        <div>
          <Label>Template name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly closed charts" />
          <p className="mt-1 text-[11px] text-ink-muted">
            Saved templates are visible to everyone, shown as “{`your name — ${name.trim() || 'template'}`}”.
          </p>
        </div>

        {noColumns && <p className="text-[11px] text-danger">Select at least one field for the table.</p>}

        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="soft"
            disabled={noColumns}
            onClick={() => {
              onApply(orderedColumns, orderedFilterKeys);
              onClose();
            }}
          >
            Apply without saving
          </Button>
          <Button
            disabled={noColumns || !name.trim()}
            loading={submitting}
            leftIcon={<Save className="w-3.5 h-3.5" />}
            onClick={() => {
              setErr(null);
              if (canUpdateActive && mode === 'update') update.mutate();
              else create.mutate();
            }}
          >
            {canUpdateActive && mode === 'update' ? 'Update template' : 'Save template'}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}

/* ── Reusable checkbox pane for the customize modal ─────── */
function CheckboxPane({
  title,
  hint,
  search,
  onSearch,
  items,
  selected,
  onToggle,
  onAll,
  onNone,
  countLabel,
}: {
  title: string;
  hint: string;
  search: string;
  onSearch: (v: string) => void;
  items: ReportField[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onAll: () => void;
  onNone: () => void;
  countLabel: string;
}) {
  return (
    <div className="border border-line rounded-lg flex flex-col min-h-0">
      <div className="px-3 pt-3 pb-2 border-b border-line">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">{title}</p>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={onAll}>All</Button>
            <Button size="sm" variant="ghost" onClick={onNone}>None</Button>
          </div>
        </div>
        <p className="text-[11px] text-ink-muted mb-2">{hint}</p>
        <SearchInput placeholder="Search…" value={search} onChange={(e) => onSearch(e.target.value)} />
      </div>
      <div className="max-h-[340px] overflow-y-auto p-1">
        {items.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-ink-muted">No matches</p>
        ) : (
          items.map((f) => (
            <label
              key={f.key}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-surface-sunken/60 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(f.key)}
                onChange={() => onToggle(f.key)}
                className="accent-primary w-4 h-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="block text-sm text-ink truncate">{f.label}</span>
                <span className="block text-[10px] text-ink-subtle font-mono truncate">{f.key}</span>
              </span>
            </label>
          ))
        )}
      </div>
      <div className="px-3 py-2 border-t border-line text-[11px] text-ink-muted">{countLabel}</div>
    </div>
  );
}
