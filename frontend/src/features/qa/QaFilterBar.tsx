import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FancySelect, Input, RangeDatePicker } from '@/components/ui/Field';
import {
  listClients,
  listLocations,
  listPrimarySpecialities,
} from '@/api/configurations';
import { listQaCoders, type QaFilters } from '@/api/qa';
import { cn } from '@/lib/utils';

const MILESTONES = [
  { key: 'READY_TO_ALLOCATE',  label: 'Ready · Allocate' },
  { key: 'READY_TO_CODE',      label: 'Ready · Code' },
  { key: 'CODING_IN_PROGRESS', label: 'Coding' },
  { key: 'CODING_DONE',        label: 'Coding Done' },
  { key: 'READY_TO_AUDIT',     label: 'Ready · Audit' },
  { key: 'AUDIT_IN_PROGRESS',  label: 'Auditing' },
  { key: 'AUDIT_DONE',         label: 'Audit Done' },
  { key: 'CLOSED',             label: 'Closed' },
];

interface Props {
  filters: QaFilters;
  onChange: (patch: Partial<QaFilters>) => void;
  onReset: () => void;
}

export function QaFilterBar({ filters, onChange, onReset }: Props) {
  const clientsQ = useQuery({
    queryKey: ['configurations', 'clients'],
    queryFn: listClients,
  });
  const locationsQ = useQuery({
    queryKey: ['configurations', 'locations', filters.clientId],
    queryFn: () => listLocations(filters.clientId!),
    enabled: !!filters.clientId,
  });
  const specialitiesQ = useQuery({
    queryKey: ['configurations', 'primary-specialities', filters.clientId],
    queryFn: () => listPrimarySpecialities(filters.clientId),
  });
  const codersQ = useQuery({
    queryKey: ['qa', 'coders'],
    queryFn: listQaCoders,
  });

  const selectedMilestones = (filters.milestone ?? '').split(',').filter(Boolean);
  const toggleMilestone = (key: string) => {
    const set = new Set(selectedMilestones);
    if (set.has(key)) set.delete(key); else set.add(key);
    onChange({ milestone: set.size ? Array.from(set).join(',') : undefined });
  };

  const hasAny =
    !!filters.clientId ||
    !!filters.locationId ||
    !!filters.specialityId ||
    !!filters.coderId ||
    !!filters.milestone ||
    !!filters.q ||
    !!filters.from ||
    !!filters.to;

  return (
    <div className="rounded-xl border border-line bg-surface-sunken/30 p-4 space-y-3">
      {/* Row 1: date range + dropdowns + search + reset */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-3">
          <RangeDatePicker
            value={{ from: filters.from ?? null, to: filters.to ?? null }}
            onChange={(v) => onChange({ from: v.from ?? undefined, to: v.to ?? undefined })}
            placeholder="Date range"
          />
        </div>

        <div className="md:col-span-2">
          <FancySelect
            value={filters.clientId ? String(filters.clientId) : ''}
            onChange={(v) => onChange({ clientId: v ? Number(v) : undefined, locationId: undefined })}
            options={[
              { value: '', label: 'All clients' },
              ...(clientsQ.data?.items ?? []).map((c) => ({
                value: String(c.id),
                label: c.name,
              })),
            ]}
            placeholder="All clients"
          />
        </div>

        <div className="md:col-span-2">
          <FancySelect
            value={filters.locationId ? String(filters.locationId) : ''}
            onChange={(v) => onChange({ locationId: v ? Number(v) : undefined })}
            options={[
              { value: '', label: filters.clientId ? 'All locations' : 'Pick a client first' },
              ...(locationsQ.data?.items ?? []).map((l) => ({
                value: String(l.id),
                label: l.name,
              })),
            ]}
            placeholder={filters.clientId ? 'All locations' : 'All locations'}
            disabled={!filters.clientId}
          />
        </div>

        <div className="md:col-span-2">
          <FancySelect
            value={filters.specialityId ? String(filters.specialityId) : ''}
            onChange={(v) => onChange({ specialityId: v ? Number(v) : undefined })}
            options={[
              { value: '', label: 'All specialties' },
              ...(specialitiesQ.data?.items ?? []).map((s) => ({
                value: String(s.id),
                label: s.name,
              })),
            ]}
            placeholder="All specialties"
          />
        </div>

        <div className="md:col-span-2">
          <FancySelect
            value={filters.coderId ? String(filters.coderId) : ''}
            onChange={(v) => onChange({ coderId: v ? Number(v) : undefined })}
            options={[
              { value: '', label: 'All coders / auditors' },
              ...(codersQ.data?.items ?? []).map((u) => ({
                value: String(u.id),
                label: u.name,
              })),
            ]}
            placeholder="All coders"
          />
        </div>

        <div className="md:col-span-1 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onReset}
            disabled={!hasAny}
            leftIcon={<X className="w-3 h-3" />}
            title="Reset all filters"
          >
            Reset
          </Button>
        </div>
      </div>

      {/* Row 2: milestone chips + search */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted mr-1">
          Milestones
        </span>
        {MILESTONES.map((m) => {
          const active = selectedMilestones.includes(m.key);
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => toggleMilestone(m.key)}
              className={cn(
                'inline-flex items-center px-2.5 h-7 rounded-pill text-[11px] font-semibold border transition',
                active
                  ? 'border-primary bg-primary text-white'
                  : 'border-line bg-surface text-ink-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              {m.label}
            </button>
          );
        })}
        <div className="flex-1" />
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
          <Input
            value={filters.q ?? ''}
            onChange={(e) => onChange({ q: e.target.value || undefined })}
            placeholder="Search Chart #"
            className="pl-8 w-[220px]"
          />
        </div>
      </div>
    </div>
  );
}
