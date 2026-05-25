import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import {
  listWorklists,
  getStatusSummary,
  createWorklist,
  createWorklistFromExcel,
  downloadBulkTemplateUrl,
  type CreateWorklistDto,
  type CreateWorklistFromExcelResult,
  type WorklistListParams,
} from '@/api/worklists';
import type { ApiErrorShape } from '@/api/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { IllustrationStatCard } from '@/components/ui/StatCards';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, FancySelect, DatePicker, RangeDatePicker } from '@/components/ui/Field';
import {
  listClients,
  listLocations,
  listPrimarySpecialities,
  listProcessesByLocation,
} from '@/api/configurations';
import { Modal, ModalFooter, Pagination, Avatar, DualProgressBar } from '@/components/ui/Primitives';
import { WorklistStatusChip } from '@/components/ui/Chip';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { useCan } from '@/hooks/useCan';
import { useTableSort, sortRows } from '@/hooks/useTableSort';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import {
  Plus,
  Filter as FilterIcon,
  Loader2,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  Upload,
  X as XIcon,
  AlertCircle,
} from 'lucide-react';

export function WorklistsPage() {
  const canCreate = useCan('worklist.create');
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [modalOpen, setModalOpen] = useState(false);
  const [filters] = useState<WorklistListParams>({});
  // Client-side sort: reorders the rows on the page currently in view. The
  // initial undefined keeps the server's default order (received date desc).
  const { sort, toggle: onSort } = useTableSort({ sortBy: undefined, sortDir: 'asc' });

  const summary = useQuery({
    queryKey: ['worklists', 'summary'],
    queryFn: getStatusSummary,
  });

  const list = useQuery({
    queryKey: ['worklists', { page, pageSize, filters }],
    queryFn: () =>
      listWorklists({
        ...filters,
        page,
        pageSize,
        sortBy: 'receivedDate',
        sortDir: 'desc',
      }),
    placeholderData: (prev) => prev,
  });

  const totalPages = list.data
    ? Math.max(1, Math.ceil(list.data.total / pageSize))
    : 1;

  // Sort the current page's rows in the browser by the clicked column.
  const sortedItems = sortRows(list.data?.items ?? [], sort, {
    worklistNumber: (w) => w.worklistNumber,
    clientId: (w) => w.clientId,
    locationId: (w) => w.locationId,
    processId: (w) => w.processId,
    primarySpecialityId: (w) => w.primarySpecialityId,
    dateOfService: (w) => w.dateOfService,
    receivedDate: (w) => w.receivedDate,
    status: (w) => w.status,
  });

  return (
    <div className="p-8 max-w-[1600px] space-y-6">
      <PageHeader title="Worklists" subtitle="Worklists" />

      {/* ── Status tiles ───────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <IllustrationStatCard
          variant="open"
          value={summary.data?.open ?? 0}
          label="Open"
          loading={summary.isPending}
        />
        <IllustrationStatCard
          variant="in-progress"
          value={summary.data?.inProgress ?? 0}
          label="In Progress"
          loading={summary.isPending}
        />
        <IllustrationStatCard
          variant="closed"
          value={summary.data?.closed ?? 0}
          label="Closed"
          loading={summary.isPending}
        />
      </div>

      {/* ── Main table card ────────────────────────────── */}
      <Card padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-line">
          <h2 className="text-[15px] font-bold text-ink">
            Worklist ({formatNumber(list.data?.total ?? 0)})
          </h2>
          <div className="flex items-center gap-2">
            <Button variant="soft" leftIcon={<FilterIcon className="w-3.5 h-3.5" />}>
              Filter
            </Button>
            {canCreate && (
              <Button onClick={() => setModalOpen(true)} leftIcon={<Plus className="w-4 h-4" />}>
                Add Volume
              </Button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px]">
            <thead>
              <tr>
                <SortableHeader column="worklistNumber" sort={sort} onSort={onSort}>Worklist #</SortableHeader>
                <SortableHeader column="clientId" sort={sort} onSort={onSort}>Client</SortableHeader>
                <SortableHeader column="locationId" sort={sort} onSort={onSort}>Location</SortableHeader>
                <SortableHeader column="processId" sort={sort} onSort={onSort}>Process</SortableHeader>
                <SortableHeader column="primarySpecialityId" sort={sort} onSort={onSort}>Specialty</SortableHeader>
                <SortableHeader>Allocation %</SortableHeader>
                <SortableHeader>Progress %</SortableHeader>
                <SortableHeader>Changed by</SortableHeader>
                <SortableHeader column="dateOfService" sort={sort} onSort={onSort}>Date of service</SortableHeader>
                <SortableHeader column="receivedDate" sort={sort} onSort={onSort}>Received date</SortableHeader>
                <SortableHeader column="status" sort={sort} onSort={onSort}>Status</SortableHeader>
              </tr>
            </thead>
            <tbody>
              {list.isPending ? (
                <tr>
                  <td colSpan={11} className="py-16 text-center text-ink-muted">
                    <Loader2 className="w-5 h-5 animate-spin inline" />
                  </td>
                </tr>
              ) : sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-20 text-center">
                    <p className="text-sm text-ink-muted">No worklists yet.</p>
                  </td>
                </tr>
              ) : (
                sortedItems.map((wl) => {
                  const allocPct = wl.totalCharts > 0
                    ? (wl.allocatedCharts / wl.totalCharts) * 100
                    : 0;
                  const progressPct = wl.totalCharts > 0
                    ? (wl.closedCharts / wl.totalCharts) * 100
                    : 0;
                  return (
                    <tr
                      key={wl.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/worklists/${wl.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(`/worklists/${wl.id}`);
                        }
                      }}
                      className="group cursor-pointer hover:bg-surface-sunken/40 transition focus:outline-none focus-visible:bg-surface-sunken/40 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
                    >
                      <td className="table-cell font-bold">
                        <Link
                          to={`/worklists/${wl.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-ink group-hover:text-primary transition"
                        >
                          {wl.worklistNumber}
                        </Link>
                      </td>
                      <td className="table-cell text-ink">#{wl.clientId}</td>
                      <td className="table-cell text-ink">#{wl.locationId}</td>
                      <td className="table-cell text-ink-muted">#{wl.processId}</td>
                      <td className="table-cell text-ink-muted">#{wl.primarySpecialityId}</td>
                      <td className="table-cell">
                        <DualProgressBar percent={allocPct} />
                      </td>
                      <td className="table-cell">
                        <DualProgressBar percent={progressPct} tone="success" />
                      </td>
                      <td className="table-cell">
                        <Avatar name="—" size="sm" />
                      </td>
                      <td className="table-cell text-ink-muted">
                        {formatDate(wl.dateOfService)}
                      </td>
                      <td className="table-cell text-ink-muted">
                        {formatDate(wl.receivedDate)}
                      </td>
                      <td className="table-cell">
                        <WorklistStatusChip status={wl.status} />
                      </td>
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

      <AddVolumeModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}

/* ── Add Volume modal ────────────────────────────────── */
function AddVolumeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [mode, setMode] = useState<'manual' | 'excel'>('manual');
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelResult, setExcelResult] = useState<CreateWorklistFromExcelResult | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateWorklistDto>({
    defaultValues: {
      worklistNumber: '',
      receivedDate: new Date().toISOString().slice(0, 10),
    },
  });

  const clientId = watch('clientId');
  const locationId = watch('locationId');
  const primarySpecialityId = watch('primarySpecialityId');
  const processId = watch('processId');

  const clients = useQuery({
    queryKey: ['configurations', 'clients'],
    queryFn: listClients,
    enabled: open,
  });
  const locations = useQuery({
    queryKey: ['configurations', 'locations', clientId],
    queryFn: () => listLocations(Number(clientId)),
    enabled: open && !!clientId,
  });
  const specialities = useQuery({
    queryKey: ['configurations', 'primary-specialities', clientId],
    queryFn: () => listPrimarySpecialities(Number(clientId)),
    enabled: open && !!clientId,
  });
  const processes = useQuery({
    queryKey: ['configurations', 'processes', locationId],
    queryFn: () => listProcessesByLocation(Number(locationId)),
    enabled: open && !!locationId,
  });

  const mutation = useMutation({
    mutationFn: createWorklist,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worklists'] });
      reset();
      onClose();
    },
    onError: (err) => {
      const e = err as unknown as ApiErrorShape;
      setServerError(e.message);
    },
  });

  const excelMutation = useMutation({
    mutationFn: (vars: { dto: Omit<CreateWorklistDto, 'numberOfCharts'>; file: File }) =>
      createWorklistFromExcel(vars.dto, vars.file),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['worklists'] });
      setExcelResult(r);
    },
    onError: (err) => setServerError((err as unknown as ApiErrorShape).message),
  });

  function handleClose() {
    reset();
    setMode('manual');
    setExcelFile(null);
    setExcelResult(null);
    setServerError(null);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add Volume"
      subtitle="Create a new worklist"
      size="lg"
    >
      {excelResult ? (
        <ExcelImportSuccess
          result={excelResult}
          onClose={handleClose}
          onOpenWorklist={() => {
            navigate(`/worklists/${excelResult.id}`);
            handleClose();
          }}
        />
      ) : (
      <form
        onSubmit={handleSubmit((d) => {
          setServerError(null);
          if (mode === 'excel') {
            if (!excelFile) {
              setServerError('Pick an Excel file first.');
              return;
            }
            excelMutation.mutate({
              dto: {
                worklistNumber: d.worklistNumber,
                clientId: Number(d.clientId),
                locationId: Number(d.locationId),
                primarySpecialityId: Number(d.primarySpecialityId),
                processId: Number(d.processId),
                receivedDate: d.receivedDate,
                dateOfService: d.dateOfService || undefined,
                dateOfServiceTo: d.dateOfServiceTo || undefined,
              },
              file: excelFile,
            });
            return;
          }
          mutation.mutate({
            ...d,
            clientId: Number(d.clientId),
            locationId: Number(d.locationId),
            primarySpecialityId: Number(d.primarySpecialityId),
            processId: Number(d.processId),
            numberOfCharts: Number(d.numberOfCharts),
          });
        })}
        className="space-y-4"
      >
        {/* Mode toggle — pill segmented control */}
        <ModeToggle mode={mode} setMode={(m) => { setMode(m); setServerError(null); }} />

        {serverError && (
          <div className="text-xs px-3 py-2 rounded-lg bg-danger-soft text-danger border border-danger/30">
            {serverError}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label required>Worklist #</Label>
            <Input
              placeholder="e.g. 19309A"
              error={errors.worklistNumber?.message}
              {...register('worklistNumber', { required: 'Required' })}
            />
          </div>
          <div>
            <Label required>Received Date</Label>
            <input type="hidden" {...register('receivedDate', { required: 'Required' })} />
            <DatePicker
              value={watch('receivedDate')}
              onChange={(v) => setValue('receivedDate', v, { shouldValidate: true })}
              placeholder="Select received date"
              max={new Date().toISOString().slice(0, 10)}
            />
            {errors.receivedDate && (
              <p className="mt-1 text-xs text-danger">{errors.receivedDate.message}</p>
            )}
          </div>
        </div>

        <input type="hidden" {...register('clientId', { required: 'Required', valueAsNumber: true })} />
        <input type="hidden" {...register('locationId', { required: 'Required', valueAsNumber: true })} />
        <input type="hidden" {...register('primarySpecialityId', { required: 'Required', valueAsNumber: true })} />
        <input type="hidden" {...register('processId', { required: 'Required', valueAsNumber: true })} />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label required>Client</Label>
            <FancySelect
              value={clientId ? String(clientId) : ''}
              placeholder={clients.isPending ? 'Loading…' : 'Select client'}
              options={(clients.data?.items ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
              onChange={(v) => {
                setValue('clientId', Number(v), { shouldValidate: true });
                setValue('locationId', undefined as unknown as number);
                setValue('primarySpecialityId', undefined as unknown as number);
                setValue('processId', undefined as unknown as number);
              }}
            />
            {errors.clientId && <p className="mt-1 text-xs text-danger">{errors.clientId.message}</p>}
          </div>
          <div>
            <Label required>Location</Label>
            <FancySelect
              value={locationId ? String(locationId) : ''}
              disabled={!clientId || (!locations.isPending && (locations.data?.items.length ?? 0) === 0)}
              placeholder={
                !clientId
                  ? 'Pick client first'
                  : locations.isPending
                  ? 'Loading…'
                  : (locations.data?.items.length ?? 0) === 0
                  ? 'No locations for this client'
                  : 'Select location'
              }
              options={(locations.data?.items ?? []).map((l) => ({ value: String(l.id), label: l.name }))}
              onChange={(v) => {
                setValue('locationId', Number(v), { shouldValidate: true });
                setValue('processId', undefined as unknown as number);
              }}
            />
            {errors.locationId && <p className="mt-1 text-xs text-danger">{errors.locationId.message}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label required>Primary Speciality</Label>
            <FancySelect
              value={primarySpecialityId ? String(primarySpecialityId) : ''}
              disabled={!clientId}
              placeholder={
                !clientId
                  ? 'Pick client first'
                  : specialities.isPending
                  ? 'Loading…'
                  : (specialities.data?.items.length ?? 0) === 0
                  ? 'No specialities for this client'
                  : 'Select speciality'
              }
              options={(specialities.data?.items ?? []).map((s) => ({ value: String(s.id), label: s.name }))}
              onChange={(v) => setValue('primarySpecialityId', Number(v), { shouldValidate: true })}
            />
            {errors.primarySpecialityId && (
              <p className="mt-1 text-xs text-danger">{errors.primarySpecialityId.message}</p>
            )}
          </div>
          <div>
            <Label required>Process</Label>
            <FancySelect
              value={processId ? String(processId) : ''}
              disabled={!locationId || (!processes.isPending && (processes.data?.items.length ?? 0) === 0)}
              placeholder={
                !locationId
                  ? 'Pick location first'
                  : processes.isPending
                  ? 'Loading…'
                  : (processes.data?.items.length ?? 0) === 0
                  ? 'No processes for this location'
                  : 'Select process'
              }
              options={(processes.data?.items ?? []).map((p) => ({ value: String(p.id), label: p.name }))}
              onChange={(v) => setValue('processId', Number(v), { shouldValidate: true })}
            />
            {errors.processId && <p className="mt-1 text-xs text-danger">{errors.processId.message}</p>}
          </div>
        </div>

        {mode === 'manual' ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Date of service</Label>
              <input type="hidden" {...register('dateOfService')} />
              <input type="hidden" {...register('dateOfServiceTo')} />
              <RangeDatePicker
                value={{
                  from: watch('dateOfService') ?? null,
                  to: watch('dateOfServiceTo') ?? null,
                }}
                onChange={({ from, to }) => {
                  setValue('dateOfService', from ?? undefined);
                  setValue('dateOfServiceTo', to ?? undefined);
                }}
                placeholder="Optional — pick a service-date range"
              />
            </div>
            <div>
              <Label required>No. of Charts</Label>
              <Input
                type="number"
                min={1}
                placeholder="e.g. 50"
                error={errors.numberOfCharts?.message}
                {...register('numberOfCharts', {
                  required: 'Required',
                  valueAsNumber: true,
                  min: { value: 1, message: 'Must be at least 1' },
                })}
              />
            </div>
          </div>
        ) : (
          <ExcelUploadField file={excelFile} setFile={setExcelFile} />
        )}

        <ModalFooter>
          <Button variant="ghost" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={mode === 'excel' ? excelMutation.isPending : mutation.isPending}
            leftIcon={mode === 'excel' ? <Upload className="w-3.5 h-3.5" /> : undefined}
          >
            {mode === 'excel' ? 'Create & Import' : 'Save'}
          </Button>
        </ModalFooter>
      </form>
      )}
    </Modal>
  );
}

/* ── Mode toggle — segmented pill control ──────────── */
function ModeToggle({
  mode,
  setMode,
}: {
  mode: 'manual' | 'excel';
  setMode: (m: 'manual' | 'excel') => void;
}) {
  const items = [
    { key: 'manual' as const, label: 'Manual entry', icon: Plus },
    { key: 'excel' as const, label: 'From Excel', icon: FileSpreadsheet },
  ];
  return (
    <div
      role="tablist"
      aria-label="Worklist creation mode"
      className="inline-flex p-1 bg-surface-sunken rounded-pill"
    >
      {items.map((it) => {
        const active = mode === it.key;
        const Icon = it.icon;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setMode(it.key)}
            className={cn(
              'inline-flex items-center gap-1.5 px-4 py-1.5 rounded-pill text-xs font-semibold transition',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-sunken',
              active
                ? 'bg-surface text-ink shadow-card'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Excel upload field for the create modal ───────── */
function ExcelUploadField({
  file,
  setFile,
}: {
  file: File | null;
  setFile: (f: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOver, setIsOver] = useState(false);

  function handleFiles(fl: FileList | null) {
    if (!fl || fl.length === 0) return;
    setFile(fl[0]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 p-3 rounded-card bg-info-soft/40 border border-info/20">
        <div className="flex gap-2 min-w-0">
          <FileSpreadsheet className="w-4 h-4 text-info shrink-0 mt-0.5" />
          <p className="text-[12px] text-ink-muted leading-relaxed">
            Upload an Excel with these headers:{' '}
            <code className="font-mono text-[11px] bg-surface px-1.5 py-0.5 rounded">A/C, MRN, DOS, ADM, DSC</code>.
            Charts will be created automatically from each row.
          </p>
        </div>
        <a
          href={downloadBulkTemplateUrl()}
          className="btn btn-soft btn-sm inline-flex items-center gap-1.5 shrink-0"
          aria-label="Download Excel template"
        >
          <Download className="w-3 h-3" />
          Template
        </a>
      </div>

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
        onDragLeave={() => setIsOver(false)}
        onDrop={(e) => { e.preventDefault(); setIsOver(false); handleFiles(e.dataTransfer.files); }}
        className={cn(
          'rounded-card border-2 border-dashed transition-colors px-6 py-6 cursor-pointer text-center',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
          isOver
            ? 'border-primary bg-primary-soft/30'
            : file
              ? 'border-success/40 bg-success-soft/20'
              : 'border-line hover:border-primary/40 hover:bg-surface-sunken/40',
        )}
        aria-label="Excel file"
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {file ? (
          <div className="flex items-center justify-center gap-2 text-sm text-ink">
            <CheckCircle2 className="w-4 h-4 text-success" />
            <span className="font-semibold truncate max-w-[16rem]">{file.name}</span>
            <span className="text-ink-muted text-xs">· {(file.size / 1024).toFixed(0)} KB</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setFile(null); }}
              className="ml-2 w-6 h-6 rounded-full hover:bg-surface-sunken flex items-center justify-center"
              aria-label="Remove file"
            >
              <XIcon className="w-3 h-3 text-ink-muted" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <Upload className="w-5 h-5 text-info" />
            <p className="text-sm font-semibold text-ink">Drop .xlsx here or click to browse</p>
            <p className="text-[11px] text-ink-muted">Up to 50&nbsp;MB.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Excel import success panel inside the modal ───── */
function ExcelImportSuccess({
  result,
  onClose,
  onOpenWorklist,
}: {
  result: CreateWorklistFromExcelResult;
  onClose: () => void;
  onOpenWorklist: () => void;
}) {
  return (
    <div className="text-center py-6 space-y-5">
      <div className="w-16 h-16 rounded-full bg-success-soft text-success flex items-center justify-center mx-auto">
        <CheckCircle2 className="w-7 h-7" />
      </div>
      <div>
        <h4 className="text-xl font-bold text-ink">Worklist created</h4>
        <p className="text-sm text-ink-muted mt-1">
          <span className="font-mono text-ink">{result.worklistNumber}</span> ·{' '}
          {formatNumber(result.inserted)} chart{result.inserted === 1 ? '' : 's'} imported
          {result.skipped > 0 && `, ${formatNumber(result.skipped)} skipped`}.
        </p>
      </div>
      {result.errors.length > 0 && (
        <div className="text-left max-w-md mx-auto p-3 rounded-card bg-warn-soft/40 border border-warn/30">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-warn mb-1.5">
            <AlertCircle className="w-3.5 h-3.5" /> {result.errors.length} row issue{result.errors.length === 1 ? '' : 's'}
          </div>
          <ul className="text-[12px] text-ink-muted space-y-0.5 max-h-24 overflow-y-auto">
            {result.errors.slice(0, 5).map((e, i) => (
              <li key={i}>Row {e.row}: {e.message}</li>
            ))}
            {result.errors.length > 5 && <li className="text-ink-subtle">… and {result.errors.length - 5} more</li>}
          </ul>
        </div>
      )}
      <div className="flex items-center justify-center gap-2">
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button onClick={onOpenWorklist}>Open worklist</Button>
      </div>
    </div>
  );
}
