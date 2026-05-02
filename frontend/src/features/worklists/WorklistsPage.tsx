import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import {
  listWorklists,
  getStatusSummary,
  createWorklist,
  type CreateWorklistDto,
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
import { useCan } from '@/hooks/useCan';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import { Plus, Filter as FilterIcon, Loader2, ChevronsUpDown } from 'lucide-react';

export function WorklistsPage() {
  const canCreate = useCan('worklist.create');
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [modalOpen, setModalOpen] = useState(false);
  const [filters] = useState<WorklistListParams>({});

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
                <HeaderCell sortable>Worklist #</HeaderCell>
                <HeaderCell sortable>Client</HeaderCell>
                <HeaderCell sortable>Location</HeaderCell>
                <HeaderCell sortable>Process</HeaderCell>
                <HeaderCell>Specialty</HeaderCell>
                <HeaderCell sortable>Allocation %</HeaderCell>
                <HeaderCell>Progress %</HeaderCell>
                <HeaderCell sortable>Changed by</HeaderCell>
                <HeaderCell sortable>Date of service</HeaderCell>
                <HeaderCell sortable>Received date</HeaderCell>
                <HeaderCell sortable>Status</HeaderCell>
              </tr>
            </thead>
            <tbody>
              {list.isPending ? (
                <tr>
                  <td colSpan={11} className="py-16 text-center text-ink-muted">
                    <Loader2 className="w-5 h-5 animate-spin inline" />
                  </td>
                </tr>
              ) : list.data?.items.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-20 text-center">
                    <p className="text-sm text-ink-muted">No worklists yet.</p>
                  </td>
                </tr>
              ) : (
                list.data?.items.map((wl) => {
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

/* ── Reusable sortable header cell ───────────────────── */
function HeaderCell({
  children,
  sortable,
}: {
  children: React.ReactNode;
  sortable?: boolean;
}) {
  return (
    <th className={cn('table-head whitespace-nowrap')}>
      <span className="inline-flex items-center gap-1">
        {children}
        {sortable && <ChevronsUpDown className="w-3 h-3 opacity-50" />}
      </span>
    </th>
  );
}

/* ── Add Volume modal ────────────────────────────────── */
function AddVolumeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Volume"
      subtitle="Create a new worklist"
      size="lg"
    >
      <form
        onSubmit={handleSubmit((d) => {
          setServerError(null);
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
              disabled={!clientId}
              placeholder={
                !clientId ? 'Pick client first' : locations.isPending ? 'Loading…' : 'Select location'
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
              disabled={!locationId}
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

        <ModalFooter>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Save
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
