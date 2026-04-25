import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
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
import { Input, Label } from '@/components/ui/Field';
import { Modal, ModalFooter, Pagination, Avatar, DualProgressBar } from '@/components/ui/Primitives';
import { WorklistStatusChip } from '@/components/ui/Chip';
import { useCan } from '@/hooks/useCan';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import { Plus, Filter as FilterIcon, Loader2, ChevronsUpDown } from 'lucide-react';

export function WorklistsPage() {
  const canCreate = useCan('worklist.create');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [filters] = useState<WorklistListParams>({});
  const pageSize = 20;

  const summary = useQuery({
    queryKey: ['worklists', 'summary'],
    queryFn: getStatusSummary,
  });

  const list = useQuery({
    queryKey: ['worklists', { page, filters }],
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
        />
        <IllustrationStatCard
          variant="in-progress"
          value={summary.data?.inProgress ?? 0}
          label="In Progress"
        />
        <IllustrationStatCard
          variant="closed"
          value={summary.data?.closed ?? 0}
          label="Closed"
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
                    ? 0 // placeholder: real allocation % comes from detail endpoint
                    : 0;
                  return (
                    <tr key={wl.id} className="group hover:bg-surface-sunken/40 transition">
                      <td className="table-cell font-bold">
                        <Link
                          to={`/worklists/${wl.id}`}
                          className="text-ink hover:text-primary transition"
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
                        <DualProgressBar percent={allocPct} />
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

        <Pagination page={page} pageCount={totalPages} onPageChange={setPage} />
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
    formState: { errors },
  } = useForm<CreateWorklistDto>({
    defaultValues: {
      worklistNumber: '',
      clientId: 1,
      locationId: 1,
      primarySpecialityId: 1,
      processId: 1,
      receivedDate: new Date().toISOString().slice(0, 10),
    },
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
            numberOfCharts: d.numberOfCharts ? Number(d.numberOfCharts) : undefined,
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
            <Input
              type="date"
              error={errors.receivedDate?.message}
              {...register('receivedDate', { required: 'Required' })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label required>Client ID</Label>
            <Input type="number" {...register('clientId', { required: true, valueAsNumber: true })} />
          </div>
          <div>
            <Label required>Location ID</Label>
            <Input type="number" {...register('locationId', { required: true, valueAsNumber: true })} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label required>Primary Speciality ID</Label>
            <Input
              type="number"
              {...register('primarySpecialityId', { required: true, valueAsNumber: true })}
            />
          </div>
          <div>
            <Label required>Process ID</Label>
            <Input type="number" {...register('processId', { required: true, valueAsNumber: true })} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Date of service</Label>
            <Input type="date" {...register('dateOfService')} />
          </div>
          <div>
            <Label>No. of Charts</Label>
            <Input
              type="number"
              placeholder="Optional"
              {...register('numberOfCharts', { valueAsNumber: true })}
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
