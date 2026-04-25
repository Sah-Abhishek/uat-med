import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  listHccRecords,
  createHccRecord,
  saveAndNextHccRecord,
  getHccFields,
  type CreateHccRecordDto,
  type HccListParams,
} from '@/api/hcc';
import type { ApiErrorShape, HccValidate } from '@/api/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, SearchInput, Textarea } from '@/components/ui/Field';
import { Modal, ModalFooter, Pagination } from '@/components/ui/Primitives';
import { formatDate, formatNumber } from '@/lib/utils';
import {
  Plus,
  Filter as FilterIcon,
  Upload,
  Loader2,
  ArrowRight,
  Save,
} from 'lucide-react';

export function HccPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<HccListParams>({});
  const [addOpen, setAddOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const pageSize = 20;

  const list = useQuery({
    queryKey: ['hcc', 'records', { page, search, filters }],
    queryFn: () =>
      listHccRecords({
        ...filters,
        page,
        pageSize,
        ...(search ? { memberId: search } : {}),
      }),
    placeholderData: (prev) => prev,
  });

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / pageSize)) : 1;

  return (
    <div className="p-8 max-w-[1600px] space-y-5">
      <PageHeader
        title="HCC Project"
        subtitle="HCC Speciality"
        actions={
          <>
            <Button variant="soft" leftIcon={<Upload className="w-3.5 h-3.5" />}>
              Upload
            </Button>
            <Button onClick={() => setAddOpen(true)} leftIcon={<Plus className="w-4 h-4" />}>
              Add Record
            </Button>
          </>
        }
      />

      <Card padding="none">
        <div className="flex items-center justify-between px-6 py-5 border-b border-line">
          <h2 className="text-[15px] font-bold text-ink">
            Records ({formatNumber(list.data?.total ?? 0)})
          </h2>
          <div className="flex items-center gap-2">
            <div className="w-64">
              <SearchInput
                placeholder="Search member ID…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <Button
              variant="soft"
              leftIcon={<FilterIcon className="w-3.5 h-3.5" />}
              onClick={() => setFilterOpen(true)}
            >
              Filter
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px]">
            <thead>
              <tr>
                <th className="table-head">Member ID</th>
                <th className="table-head">Member name</th>
                <th className="table-head">Medicare #</th>
                <th className="table-head">DOB</th>
                <th className="table-head">DOS</th>
                <th className="table-head">V24 ICD</th>
                <th className="table-head">V24 HCC</th>
                <th className="table-head">V28 ICD</th>
                <th className="table-head">V28 HCC</th>
                <th className="table-head">Validate</th>
              </tr>
            </thead>
            <tbody>
              {list.isPending ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center">
                    <Loader2 className="w-5 h-5 animate-spin inline text-ink-muted" />
                  </td>
                </tr>
              ) : list.data?.items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-20 text-center text-sm text-ink-muted">
                    No HCC records yet. Click "Add Record" to create one.
                  </td>
                </tr>
              ) : (
                list.data?.items.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-sunken/40 transition">
                    <td className="table-cell font-mono text-xs">{r.memberId}</td>
                    <td className="table-cell font-semibold text-ink">{r.memberName}</td>
                    <td className="table-cell text-ink-muted">{r.medicareNo ?? '—'}</td>
                    <td className="table-cell text-ink-muted">{formatDate(r.dob)}</td>
                    <td className="table-cell text-ink-muted">{formatDate(r.dos)}</td>
                    <td className="table-cell font-mono text-xs">{r.v24Icd ?? '—'}</td>
                    <td className="table-cell">{r.v24HccValue ?? '—'}</td>
                    <td className="table-cell font-mono text-xs">{r.v28Icd ?? '—'}</td>
                    <td className="table-cell">{r.v28HccValue ?? '—'}</td>
                    <td className="table-cell">
                      <ValidateChip value={r.validate} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination page={page} pageCount={totalPages} onPageChange={setPage} />
      </Card>

      {addOpen && <AddHccModal onClose={() => setAddOpen(false)} />}
      <HccFilterModal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        value={filters}
        onApply={(f) => {
          setFilters(f);
          setPage(1);
        }}
      />
    </div>
  );
}

function ValidateChip({ value }: { value: HccValidate }) {
  const map = {
    ADD: 'bg-info-soft text-info',
    PASS: 'bg-success-soft text-success',
    NA: 'bg-surface-sunken text-ink-muted',
  };
  return <span className={`chip ${map[value]}`}>{value}</span>;
}

/* ── Add HCC record modal — supports Save / Save & Next ─ */
function AddHccModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // Load the field catalog so we can pre-fill preserveNext fields after Save & Next
  const fields = useQuery({ queryKey: ['hcc', 'fields'], queryFn: getHccFields });

  const { register, handleSubmit, reset, formState: { errors }, getValues } = useForm<CreateHccRecordDto>({
    defaultValues: { memberId: '', memberName: '', validate: 'ADD' },
  });

  const saveMutation = useMutation({
    mutationFn: createHccRecord,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hcc'] });
      onClose();
    },
    onError: (err) => setError((err as unknown as ApiErrorShape).message),
  });

  const saveAndNextMutation = useMutation({
    mutationFn: saveAndNextHccRecord,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['hcc'] });
      // Reset with the preserveNext fields the server returned
      reset({
        memberId: '',
        memberName: '',
        validate: 'ADD',
        ...res.nextTemplate,
      });
    },
    onError: (err) => setError((err as unknown as ApiErrorShape).message),
  });

  function prepareDto(): CreateHccRecordDto {
    const d = getValues();
    return {
      ...d,
      v24HccValue: d.v24HccValue ? Number(d.v24HccValue) : undefined,
      v28HccValue: d.v28HccValue ? Number(d.v28HccValue) : undefined,
      coderId: d.coderId ? Number(d.coderId) : undefined,
    };
  }

  const preserveNextFieldNames = fields.data?.filter((f) => f.preserveNext).map((f) => f.name) ?? [];

  return (
    <Modal open onClose={onClose} title="Add HCC Record" size="xl">
      <form
        onSubmit={handleSubmit(() => {
          setError(null);
          saveMutation.mutate(prepareDto());
        })}
        className="space-y-5"
      >
        {error && (
          <div className="text-xs px-3 py-2 rounded-lg bg-danger-soft text-danger border border-danger/30">
            {error}
          </div>
        )}

        {preserveNextFieldNames.length > 0 && (
          <div className="text-[11px] text-ink-muted bg-primary-soft/50 border border-primary/20 rounded-lg px-3 py-2">
            <strong className="text-primary-ink">Save &amp; Next</strong> keeps:{' '}
            {preserveNextFieldNames.join(', ')}
          </div>
        )}

        {/* Member info */}
        <Section title="Member">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label required>Member ID</Label>
              <Input error={errors.memberId?.message} {...register('memberId', { required: 'Required' })} />
            </div>
            <div>
              <Label required>Member name</Label>
              <Input error={errors.memberName?.message} {...register('memberName', { required: 'Required' })} />
            </div>
            <div>
              <Label>Medicare #</Label>
              <Input {...register('medicareNo')} />
            </div>
            <div>
              <Label>DOB</Label>
              <Input type="date" {...register('dob')} />
            </div>
            <div>
              <Label>Payor</Label>
              <Input {...register('payor')} />
            </div>
            <div>
              <Label>Source</Label>
              <Input {...register('source')} />
            </div>
          </div>
        </Section>

        {/* Dates */}
        <Section title="Dates">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>DOS</Label>
              <Input type="date" {...register('dos')} />
            </div>
            <div>
              <Label>Review date</Label>
              <Input type="date" {...register('reviewDate')} />
            </div>
            <div>
              <Label>Received date</Label>
              <Input type="date" {...register('receivedDate')} />
            </div>
          </div>
        </Section>

        {/* V24 */}
        <Section title="V24 coding">
          <div className="grid grid-cols-[1fr_2fr_1fr] gap-4">
            <div>
              <Label>V24 ICD</Label>
              <Input {...register('v24Icd')} />
            </div>
            <div>
              <Label>Description</Label>
              <Input {...register('v24IcdDescription')} />
            </div>
            <div>
              <Label>HCC value</Label>
              <Input type="number" step="0.01" {...register('v24HccValue', { valueAsNumber: true })} />
            </div>
          </div>
        </Section>

        {/* V28 */}
        <Section title="V28 coding">
          <div className="grid grid-cols-[1fr_2fr_1fr] gap-4">
            <div>
              <Label>V28 ICD</Label>
              <Input {...register('v28Icd')} />
            </div>
            <div>
              <Label>Description</Label>
              <Input {...register('v28IcdDescription')} />
            </div>
            <div>
              <Label>HCC value</Label>
              <Input type="number" step="0.01" {...register('v28HccValue', { valueAsNumber: true })} />
            </div>
          </div>
        </Section>

        {/* Review */}
        <Section title="Review">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Validate</Label>
              <Select {...register('validate')}>
                <option value="ADD">ADD</option>
                <option value="PASS">PASS</option>
                <option value="NA">NA</option>
              </Select>
            </div>
            <div>
              <Label>Reason code</Label>
              <Input {...register('reasonCode')} />
            </div>
            <div>
              <Label>Coder ID</Label>
              <Input type="number" {...register('coderId', { valueAsNumber: true })} />
            </div>
          </div>
          <div className="mt-4">
            <Label>Reviewer note</Label>
            <Textarea rows={2} {...register('reviewerNote')} />
          </div>
        </Section>

        <ModalFooter>
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button
            variant="soft"
            type="button"
            leftIcon={<ArrowRight className="w-3.5 h-3.5" />}
            loading={saveAndNextMutation.isPending}
            onClick={() => {
              setError(null);
              if (!getValues('memberId') || !getValues('memberName')) {
                setError('Member ID and name are required');
                return;
              }
              saveAndNextMutation.mutate(prepareDto());
            }}
          >
            Save &amp; Next
          </Button>
          <Button
            type="submit"
            leftIcon={<Save className="w-3.5 h-3.5" />}
            loading={saveMutation.isPending}
          >
            Save
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-ink-muted mb-2">
        {title}
      </p>
      {children}
    </div>
  );
}

/* ── HCC filter modal ──────────────────────────────────── */
function HccFilterModal({
  open,
  onClose,
  value,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  value: HccListParams;
  onApply: (v: HccListParams) => void;
}) {
  const { register, handleSubmit, reset } = useForm<HccListParams>({ defaultValues: value });

  return (
    <Modal open={open} onClose={onClose} title="Filter HCC Records" size="lg">
      <form
        onSubmit={handleSubmit((d) => {
          onApply(d);
          onClose();
        })}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Member ID</Label>
            <Input {...register('memberId')} />
          </div>
          <div>
            <Label>Medicare #</Label>
            <Input {...register('medicareNo')} />
          </div>
          <div>
            <Label>V24 ICD</Label>
            <Input {...register('v24Icd')} />
          </div>
          <div>
            <Label>V28 ICD</Label>
            <Input {...register('v28Icd')} />
          </div>
          <div>
            <Label>Validate</Label>
            <Select {...register('validate')}>
              <option value="">Any</option>
              <option value="ADD">ADD</option>
              <option value="PASS">PASS</option>
              <option value="NA">NA</option>
            </Select>
          </div>
          <div>
            <Label>Coder ID</Label>
            <Input type="number" {...register('coderId', { valueAsNumber: true })} />
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
