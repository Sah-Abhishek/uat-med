import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getReportFields,
  runReportQuery,
  listReportTemplates,
  createReportTemplate,
  deleteReportTemplate,
  startReportExport,
  getExportStatus,
  type QueryReportDto,
} from '@/api/reports';
import type { ApiErrorShape, ExportFormat, ReportField } from '@/api/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CollapsibleCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, SearchInput } from '@/components/ui/Field';
import { Modal, ModalFooter, Pagination } from '@/components/ui/Primitives';
import { formatNumber } from '@/lib/utils';
import {
  Settings2,
  Download,
  Save,
  BookMarked,
  Loader2,
  Play,
  FileSpreadsheet,
  FileText,
  Trash2,
} from 'lucide-react';

interface QueryState {
  columns: string[];
  filters: Record<string, string>;
  sort: QueryReportDto['sort'];
  page: number;
}

const DEFAULT_COLUMNS = [
  'worklistNumber',
  'chartNo',
  'priority',
  'milestone',
  'chartStatus',
];
const PAGE_SIZE = 50;

export function ReportsPage() {
  const [state, setState] = useState<QueryState>({
    columns: DEFAULT_COLUMNS,
    filters: {},
    sort: [],
    page: 1,
  });
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [exportTaskId, setExportTaskId] = useState<string | null>(null);

  const fields = useQuery({ queryKey: ['reports', 'fields'], queryFn: getReportFields });

  const query = useQuery({
    queryKey: ['reports', 'query', state],
    queryFn: () =>
      runReportQuery({
        columns: state.columns,
        filters: state.filters,
        sort: state.sort,
        page: state.page,
        pageSize: PAGE_SIZE,
      }),
    enabled: state.columns.length > 0,
    placeholderData: (prev) => prev,
  });

  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / PAGE_SIZE)) : 1;

  const exportMutation = useMutation({
    mutationFn: (format: ExportFormat) =>
      startReportExport({
        columns: state.columns,
        filters: state.filters,
        format,
      }),
    onSuccess: (res) => setExportTaskId(res.taskId),
  });

  return (
    <div className="p-8 max-w-[1600px] space-y-5">
      <PageHeader
        title="Reports"
        subtitle="Reports"
        actions={
          <>
            <Button variant="soft" leftIcon={<BookMarked className="w-3.5 h-3.5" />} onClick={() => setTemplatesOpen(true)}>
              Templates
            </Button>
            <Button variant="soft" leftIcon={<Save className="w-3.5 h-3.5" />} onClick={() => setSaveTemplateOpen(true)}>
              Save as template
            </Button>
            <Button
              variant="soft"
              leftIcon={<FileSpreadsheet className="w-3.5 h-3.5" />}
              loading={exportMutation.isPending}
              onClick={() => exportMutation.mutate('xlsx')}
            >
              Export XLSX
            </Button>
            <Button
              variant="soft"
              leftIcon={<FileText className="w-3.5 h-3.5" />}
              onClick={() => exportMutation.mutate('csv')}
            >
              Export CSV
            </Button>
          </>
        }
      />

      {exportTaskId && (
        <ExportProgressBanner taskId={exportTaskId} onClose={() => setExportTaskId(null)} />
      )}

      {/* Filters */}
      <CollapsibleCard title="Filters" defaultOpen>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 pt-3">
          {(fields.data ?? []).filter((f) => f.filterable).slice(0, 8).map((f) => (
            <div key={f.key}>
              <Label>{f.label}</Label>
              <Input
                value={state.filters[f.key] ?? ''}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    page: 1,
                    filters: { ...s.filters, [f.key]: e.target.value },
                  }))
                }
                placeholder="Any"
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button
            variant="ghost"
            onClick={() => setState((s) => ({ ...s, filters: {}, page: 1 }))}
          >
            Clear
          </Button>
          <Button leftIcon={<Play className="w-3.5 h-3.5" />} onClick={() => query.refetch()}>
            Run
          </Button>
        </div>
      </CollapsibleCard>

      {/* Results */}
      <Card padding="none">
        <div className="flex items-center justify-between px-6 py-5 border-b border-line">
          <div>
            <h2 className="text-[15px] font-bold text-ink">
              Results ({formatNumber(query.data?.total ?? 0)})
            </h2>
            <p className="text-xs text-ink-muted mt-0.5">
              {state.columns.length} column{state.columns.length === 1 ? '' : 's'} · page {state.page} of {totalPages}
            </p>
          </div>
          <Button
            variant="soft"
            leftIcon={<Settings2 className="w-3.5 h-3.5" />}
            onClick={() => setCustomizeOpen(true)}
          >
            Customize columns
          </Button>
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
                        {cell == null ? <span className="text-ink-subtle">—</span> : String(cell)}
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

      <CustomizeColumnsModal
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        fields={fields.data ?? []}
        currentColumns={state.columns}
        onApply={(cols) => setState((s) => ({ ...s, columns: cols, page: 1 }))}
      />

      <TemplatesModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onLoad={(tpl) => {
          setState({
            columns: tpl.columns,
            filters: (tpl.filters as Record<string, string>) ?? {},
            sort: [],
            page: 1,
          });
          setTemplatesOpen(false);
        }}
      />

      <SaveTemplateModal
        open={saveTemplateOpen}
        onClose={() => setSaveTemplateOpen(false)}
        state={state}
      />
    </div>
  );
}

/* ── Export progress banner ────────────────────────── */
function ExportProgressBanner({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('queued');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const res = await getExportStatus(taskId);
        if (!mounted) return;
        setStatus(res.status);
        if (res.status === 'done' && res.downloadUrl) {
          setDownloadUrl(res.downloadUrl);
          window.open(res.downloadUrl, '_blank');
        } else if (res.status === 'failed') {
          setErr(res.errorMessage ?? 'Export failed');
        } else {
          setTimeout(poll, 2500);
        }
      } catch (e) {
        setErr((e as Error).message);
      }
    };
    poll();
    return () => { mounted = false; };
  }, [taskId]);

  return (
    <div className="card p-4 flex items-center gap-3 border-primary/30">
      {err ? (
        <>
          <div className="text-sm text-danger">Export failed: {err}</div>
          <Button variant="ghost" size="sm" onClick={onClose}>Dismiss</Button>
        </>
      ) : downloadUrl ? (
        <>
          <Download className="w-4 h-4 text-success" />
          <div className="text-sm text-ink flex-1">
            Export ready.{' '}
            <a href={downloadUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              Download file
            </a>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </>
      ) : (
        <>
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <div className="text-sm text-ink flex-1">Export {status}… (task {taskId.slice(0, 12)})</div>
        </>
      )}
    </div>
  );
}

/* ── Customize Columns modal ───────────────────────── */
function CustomizeColumnsModal({
  open,
  onClose,
  fields,
  currentColumns,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  fields: ReportField[];
  currentColumns: string[];
  onApply: (cols: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(currentColumns));
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (open) setSelected(new Set(currentColumns));
  }, [open, currentColumns]);

  const filtered = useMemo(
    () => fields.filter((f) => f.label.toLowerCase().includes(search.toLowerCase())),
    [fields, search],
  );

  function toggle(key: string) {
    const next = new Set(selected);
    next.has(key) ? next.delete(key) : next.add(key);
    setSelected(next);
  }

  return (
    <Modal open={open} onClose={onClose} title="Customize report" subtitle="Select columns to include" size="lg">
      <div className="space-y-4">
        <SearchInput placeholder="Search fields…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-[400px] overflow-y-auto border border-line rounded-lg">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-sunken">
              <tr>
                <th className="table-head">Field</th>
                <th className="table-head w-24 text-center">Show</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => (
                <tr key={f.key} className="hover:bg-surface-sunken/40 transition">
                  <td className="px-4 py-2 border-b border-line/60">
                    <p className="text-ink font-medium">{f.label}</p>
                    <p className="text-[10px] text-ink-subtle font-mono">{f.key}</p>
                  </td>
                  <td className="px-4 py-2 border-b border-line/60 text-center">
                    <input
                      type="checkbox"
                      checked={selected.has(f.key)}
                      onChange={() => toggle(f.key)}
                      className="accent-primary w-4 h-4"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink-muted">{selected.size} columns selected</p>
        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { onApply(Array.from(selected)); onClose(); }}>
            Apply
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}

/* ── Templates modal ───────────────────────────────── */
function TemplatesModal({
  open,
  onClose,
  onLoad,
}: {
  open: boolean;
  onClose: () => void;
  onLoad: (tpl: Awaited<ReturnType<typeof listReportTemplates>>['items'][number]) => void;
}) {
  const qc = useQueryClient();
  const templates = useQuery({
    queryKey: ['reports', 'templates'],
    queryFn: listReportTemplates,
    enabled: open,
  });

  const delMutation = useMutation({
    mutationFn: (id: string) => deleteReportTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', 'templates'] }),
  });

  return (
    <Modal open={open} onClose={onClose} title="Saved templates" size="md">
      {templates.isPending ? (
        <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-ink-muted" /></div>
      ) : templates.data?.items.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">No saved templates yet.</p>
      ) : (
        <div className="space-y-2">
          {templates.data?.items.map((t) => (
            <div key={t.id} className="flex items-center gap-3 p-3 border border-line rounded-lg">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink">{t.name}</p>
                <p className="text-[11px] text-ink-muted">
                  {t.columns.length} columns{t.isShared && ' · shared'}
                </p>
              </div>
              <Button size="sm" onClick={() => onLoad(t)}>Load</Button>
              <button
                onClick={() => delMutation.mutate(t.id)}
                className="w-8 h-8 rounded-full text-danger hover:bg-danger-soft flex items-center justify-center"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ── Save template modal ───────────────────────────── */
function SaveTemplateModal({
  open,
  onClose,
  state,
}: {
  open: boolean;
  onClose: () => void;
  state: QueryState;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [isShared, setIsShared] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () =>
      createReportTemplate({
        name,
        columns: state.columns,
        filters: state.filters,
        isShared,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports', 'templates'] });
      setName('');
      onClose();
    },
    onError: (e) => setErr((e as unknown as ApiErrorShape).message),
  });

  return (
    <Modal open={open} onClose={onClose} title="Save as template" size="sm">
      <div className="space-y-4">
        {err && <div className="text-xs px-3 py-2 rounded bg-danger-soft text-danger">{err}</div>}
        <div>
          <Label required>Template name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly closed charts" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} className="accent-primary" />
          Share with team
        </label>
        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!name.trim()} loading={m.isPending} onClick={() => m.mutate()}>Save</Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
