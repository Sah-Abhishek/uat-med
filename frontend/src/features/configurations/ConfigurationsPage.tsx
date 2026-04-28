import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import {
  getGeneralConfig,
  updateGeneralConfig,
  listClients,
  createClient,
  listLocations,
  createLocation,
  getSpecialitiesGeneral,
  updateSpecialitiesGeneral,
  getFeedbackCategories,
  updateFeedbackCategories,
  createAuditArea,
  deleteAuditArea,
  getAuditingConfig,
  updateAuditingConfig,
  getCodingConfig,
  updateCodingConfig,
  getChartFieldsConfig,
  updateChartFieldsConfig,
  createCustomChartField,
  listPrimarySpecialities,
  updateCustomChartField,
  deleteCustomChartField,
  listHccFieldConfig,
  createHccField,
  updateHccField,
  deleteHccField,
  type GeneralConfig,
  type SpecialitiesGeneralDto,
  type PrimarySpecialityEntry,
  type SubSpecialityEntry,
  type NamedEntry,
  type FeedbackArea,
  type FeedbackReason,
  type AuditingConfig,
  type CodingConfig,
  type ChartFieldsConfig,
  type CustomChartField,
  type CreateCustomChartFieldDto,
} from '@/api/configurations';
import type { ApiErrorShape, HccFieldDef, ValidationRule } from '@/api/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, FancySelect, Radio, Switch, OptionsBuilder } from '@/components/ui/Field';
import { Modal, ModalFooter, Tabs, ConfirmModal } from '@/components/ui/Primitives';
import { useAuth } from '@/auth/store';
import { can } from '@/permissions';
import {
  Loader2,
  Plus,
  Save,
  Trash2,
  CheckCircle2,
  Pencil,
  AlertTriangle,
  X,
  Check,
  Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type MainTab = 'general' | 'specialities' | 'hcc';
type SpecTab = 'general' | 'feedback' | 'auditing' | 'coding' | 'chart-fields';

const STANDARD_CHART_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'chartNo', label: 'Chart No.' },
  { key: 'mrNumber', label: 'MR Number' },
  { key: 'dos', label: 'DOS' },
  { key: 'admitDate', label: 'Admit Date' },
  { key: 'dischargeDate', label: 'Discharge Date' },
  { key: 'disposition', label: 'Disposition' },
  { key: 'emLevel', label: 'EM' },
  { key: 'primaryDiagnosis', label: 'Primary Diagnosis' },
  { key: 'primaryHealthPlan', label: 'Primary Health Plan' },
  { key: 'facility', label: 'Facility' },
  { key: 'poa', label: 'POA' },
  { key: 'los', label: 'LOS' },
  { key: 'drgValue', label: 'DRG Value' },
  { key: 'procedureCode', label: 'Procedure Code' },
  { key: 'subSpeciality', label: 'Sub Speciality' },
  { key: 'chartStatus', label: 'Chart Status' },
  { key: 'responsibleParty', label: 'Responsible Party' },
  { key: 'coderCommentsToClient', label: 'Coder Comments to Client' },
  { key: 'rejectionDenialComments', label: 'Rejection/Denial Comments' },
  { key: 'deficiencyComments', label: 'Deficiency Comments' },
];

export function ConfigurationsPage() {
  const user = useAuth((s) => s.user)!;
  const canEdit = can(user, 'config.edit');
  const [tab, setTab] = useState<MainTab>('general');

  return (
    <div className="p-8 max-w-[1600px] space-y-5">
      <PageHeader title="Configurations" subtitle="Configurations" />

      <Card padding="none">
        <div className="px-6 pt-5">
          <Tabs
            tabs={[
              { key: 'general', label: 'General' },
              { key: 'specialities', label: 'Specialities' },
              { key: 'hcc', label: 'HCC' },
            ]}
            value={tab}
            onChange={(k) => setTab(k as MainTab)}
          />
        </div>

        <div className="p-6">
          {tab === 'general' && <GeneralTab canEdit={canEdit} />}
          {tab === 'specialities' && <SpecialitiesTab canEdit={canEdit} />}
          {tab === 'hcc' && <HccFieldsEditor canEdit={canEdit} />}
        </div>
      </Card>
    </div>
  );
}

/* ═════════════════ General tab ═════════════════ */
function GeneralTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['configurations', 'general'],
    queryFn: getGeneralConfig,
  });

  const { register, handleSubmit, reset } = useForm<GeneralConfig>();

  useEffect(() => {
    if (data) reset(data);
  }, [data, reset]);

  const m = useMutation({
    mutationFn: updateGeneralConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configurations', 'general'] });
      setSavedAt(new Date());
    },
    onError: (e) => setError((e as unknown as ApiErrorShape).message),
  });

  if (isPending) return <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />;

  return (
    <form
      onSubmit={handleSubmit((d) => {
        setError(null);
        m.mutate({
          ...d,
          chartListViewDays: d.chartListViewDays ? Number(d.chartListViewDays) : undefined,
          defaultPageSize: d.defaultPageSize ? Number(d.defaultPageSize) : undefined,
          autoCloseCompletedAfterDays: d.autoCloseCompletedAfterDays
            ? Number(d.autoCloseCompletedAfterDays)
            : undefined,
        });
      })}
      className="max-w-3xl space-y-5"
    >
      {error && <div className="text-xs px-3 py-2 rounded-lg bg-danger-soft text-danger">{error}</div>}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Chart list view (days)</Label>
          <Input type="number" disabled={!canEdit} {...register('chartListViewDays', { valueAsNumber: true })} />
        </div>
        <div>
          <Label>Default page size</Label>
          <Input type="number" disabled={!canEdit} {...register('defaultPageSize', { valueAsNumber: true })} />
        </div>
        <div>
          <Label>Auto-close completed after (days)</Label>
          <Input
            type="number"
            disabled={!canEdit}
            {...register('autoCloseCompletedAfterDays', { valueAsNumber: true })}
          />
        </div>
        <div>
          <Label>Timezone</Label>
          <Select disabled={!canEdit} {...register('timezone')}>
            <option value="Asia/Kolkata">Asia/Kolkata</option>
            <option value="America/New_York">America/New_York</option>
            <option value="America/Los_Angeles">America/Los_Angeles</option>
            <option value="Europe/London">Europe/London</option>
            <option value="UTC">UTC</option>
          </Select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={!canEdit} {...register('allowSelfAllocation')} className="accent-primary" />
        Allow self-allocation (coders can pull unassigned charts)
      </label>

      {canEdit && (
        <div className="flex items-center justify-end gap-3">
          {savedAt && (
            <span className="text-[11px] text-success inline-flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Saved
            </span>
          )}
          <Button type="submit" leftIcon={<Save className="w-3.5 h-3.5" />} loading={m.isPending}>
            Save general settings
          </Button>
        </div>
      )}
    </form>
  );
}

/* ═════════════════ Client + Location left rail ═════════════════ */
function ConfigScopeRail({
  canEdit,
  selectedClient,
  selectedLocation,
  onClientChange,
  onLocationChange,
}: {
  canEdit: boolean;
  selectedClient: number | null;
  selectedLocation: number | null;
  onClientChange: (id: number | null) => void;
  onLocationChange: (id: number | null) => void;
}) {
  const qc = useQueryClient();
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [addLocationOpen, setAddLocationOpen] = useState(false);

  const clients = useQuery({ queryKey: ['configurations', 'clients'], queryFn: listClients });

  useEffect(() => {
    if (!selectedClient && clients.data?.items.length) {
      onClientChange(clients.data.items[0].id);
    }
  }, [clients.data, selectedClient, onClientChange]);

  const locations = useQuery({
    queryKey: ['configurations', 'locations', selectedClient],
    queryFn: () => listLocations(selectedClient!),
    enabled: !!selectedClient,
  });

  useEffect(() => {
    const items = locations.data?.items;
    if (!items) return;
    if (selectedLocation && items.some((l) => l.id === selectedLocation)) return;
    onLocationChange(items[0]?.id ?? null);
  }, [locations.data, selectedLocation, onLocationChange]);

  return (
    <aside className="w-[260px] shrink-0 space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-ink">Client</h3>
          {canEdit && (
            <Button size="sm" variant="ghost" leftIcon={<Plus className="w-3 h-3" />} onClick={() => setAddClientOpen(true)}>
              Add
            </Button>
          )}
        </div>
        {clients.isPending ? (
          <Loader2 className="w-4 h-4 animate-spin text-ink-muted" />
        ) : clients.data?.items.length === 0 ? (
          <div className="border border-dashed border-line rounded-lg p-4 text-center">
            <p className="text-xs text-ink-muted mb-2">No clients yet.</p>
            {canEdit && (
              <Button size="sm" onClick={() => setAddClientOpen(true)} leftIcon={<Plus className="w-3 h-3" />}>
                Add first client
              </Button>
            )}
          </div>
        ) : (
          <Select
            value={selectedClient ?? ''}
            onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : null;
              onClientChange(v);
              onLocationChange(null);
            }}
          >
            {clients.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-ink">Location</h3>
          {canEdit && selectedClient && (
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Plus className="w-3 h-3" />}
              onClick={() => setAddLocationOpen(true)}
            >
              Add
            </Button>
          )}
        </div>
        {!selectedClient ? (
          <p className="text-xs text-ink-muted">Select a client first.</p>
        ) : locations.isPending ? (
          <Loader2 className="w-4 h-4 animate-spin text-ink-muted" />
        ) : locations.data?.items.length === 0 ? (
          <div className="border border-dashed border-line rounded-lg p-4 text-center">
            <p className="text-xs text-ink-muted mb-2">No locations yet.</p>
            {canEdit && (
              <Button size="sm" onClick={() => setAddLocationOpen(true)} leftIcon={<Plus className="w-3 h-3" />}>
                Add first location
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {locations.data?.items.map((l) => {
              const isSelected = selectedLocation === l.id;
              return (
                <button
                  key={l.id}
                  onClick={() => onLocationChange(l.id)}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition text-sm',
                    isSelected
                      ? 'bg-primary-soft text-primary-ink dark:text-primary font-semibold'
                      : 'text-ink hover:bg-surface-sunken font-medium',
                  )}
                >
                  <span className="truncate">{l.name}</span>
                  <span className="text-ink-muted">›</span>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {addClientOpen && (
        <AddClientModal
          onClose={() => setAddClientOpen(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['configurations', 'clients'] })}
        />
      )}
      {addLocationOpen && selectedClient && (
        <AddLocationModal
          clientId={selectedClient}
          onClose={() => setAddLocationOpen(false)}
          onSaved={() =>
            qc.invalidateQueries({ queryKey: ['configurations', 'locations', selectedClient] })
          }
        />
      )}
    </aside>
  );
}

function AddClientModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { register, handleSubmit } = useForm<{ name: string }>({ defaultValues: { name: '' } });
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (d: { name: string }) => createClient({ ...d, isActive: true }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) => setErr((e as unknown as ApiErrorShape).message),
  });
  return (
    <Modal open onClose={onClose} title="Add Client" size="sm">
      <form onSubmit={handleSubmit((d) => m.mutate(d))} className="space-y-3">
        {err && <div className="text-xs px-3 py-2 rounded bg-danger-soft text-danger">{err}</div>}
        <div>
          <Label required>Name</Label>
          <Input {...register('name', { required: true })} autoFocus />
        </div>
        <ModalFooter>
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={m.isPending}>Create</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function AddLocationModal({
  clientId,
  onClose,
  onSaved,
}: {
  clientId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { register, handleSubmit } = useForm<{ name: string }>({ defaultValues: { name: '' } });
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (d: { name: string }) => createLocation({ ...d, clientId, isActive: true }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) => setErr((e as unknown as ApiErrorShape).message),
  });
  return (
    <Modal open onClose={onClose} title="Add Location" size="sm">
      <form onSubmit={handleSubmit((d) => m.mutate(d))} className="space-y-3">
        {err && <div className="text-xs px-3 py-2 rounded bg-danger-soft text-danger">{err}</div>}
        <div>
          <Label required>Name</Label>
          <Input {...register('name', { required: true })} autoFocus />
        </div>
        <ModalFooter>
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={m.isPending}>Create</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/* ═════════════════ Specialities tab ═════════════════ */
function SpecialitiesTab({ canEdit }: { canEdit: boolean }) {
  const [sub, setSub] = useState<SpecTab>('general');
  const [clientId, setClientId] = useState<number | null>(null);
  const [locationId, setLocationId] = useState<number | null>(null);

  return (
    <div className="flex gap-6">
      <ConfigScopeRail
        canEdit={canEdit}
        selectedClient={clientId}
        selectedLocation={locationId}
        onClientChange={setClientId}
        onLocationChange={setLocationId}
      />

      <div className="flex-1 min-w-0">
        <Tabs
          tabs={[
            { key: 'general', label: 'General' },
            { key: 'feedback', label: 'Feedback Categories' },
            { key: 'auditing', label: 'Auditing' },
            { key: 'coding', label: 'Coding' },
            { key: 'chart-fields', label: 'Chart Field Configuration' },
          ]}
          value={sub}
          onChange={(k) => setSub(k as SpecTab)}
          className="mb-5"
        />

        {!clientId || !locationId ? (
          <div className="border border-dashed border-line rounded-lg p-12 text-center">
            <p className="text-sm text-ink-muted">
              Select a client and location from the left to configure its settings.
            </p>
          </div>
        ) : (
          <>
            {sub === 'general' && (
              <SpecialitiesGeneralEditor canEdit={canEdit} clientId={clientId} locationId={locationId} />
            )}
            {sub === 'feedback' && (
              <FeedbackCategoriesEditor canEdit={canEdit} clientId={clientId} locationId={locationId} />
            )}
            {sub === 'auditing' && (
              <AuditingEditor canEdit={canEdit} clientId={clientId} locationId={locationId} />
            )}
            {sub === 'coding' && (
              <CodingEditor canEdit={canEdit} clientId={clientId} locationId={locationId} />
            )}
            {sub === 'chart-fields' && (
              <ChartFieldsEditor canEdit={canEdit} clientId={clientId} locationId={locationId} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ═════════════════ Specialities → General editor ═════════════════ */
function SpecialitiesGeneralEditor({
  canEdit,
  clientId,
  locationId,
}: {
  canEdit: boolean;
  clientId: number;
  locationId: number;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['configurations', 'spec-general', clientId, locationId],
    queryFn: () => getSpecialitiesGeneral({ clientId, locationId }),
  });

  const [state, setState] = useState<SpecialitiesGeneralDto | null>(null);

  useEffect(() => {
    if (data) {
      setState({
        primarySpecialities: data.primarySpecialities ?? [],
        subSpecialities: data.subSpecialities ?? [],
        processes: data.processes ?? [],
        facilities: data.facilities ?? [],
        designations: data.designations ?? [],
        doesSupportProcessWiseCoding: data.doesSupportProcessWiseCoding ?? false,
      });
    }
  }, [data]);

  const m = useMutation({
    mutationFn: (dto: SpecialitiesGeneralDto) =>
      updateSpecialitiesGeneral({ ...dto, clientId, locationId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configurations', 'spec-general', clientId, locationId] });
      setSavedAt(new Date());
    },
    onError: (e) => setError((e as unknown as ApiErrorShape).message),
  });

  if (isPending || !state) {
    return <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />;
  }

  function addPrimary() {
    setState((s) =>
      s ? { ...s, primarySpecialities: [...s.primarySpecialities, { name: '', isActive: true }] } : s,
    );
  }
  function updatePrimary(i: number, patch: Partial<PrimarySpecialityEntry>) {
    setState((s) => {
      if (!s) return s;
      const next = [...s.primarySpecialities];
      next[i] = { ...next[i], ...patch } as PrimarySpecialityEntry;
      return { ...s, primarySpecialities: next };
    });
  }
  function removePrimary(i: number) {
    setState((s) =>
      s ? { ...s, primarySpecialities: s.primarySpecialities.filter((_, idx) => idx !== i) } : s,
    );
  }

  function addSub() {
    setState((s) => (s ? { ...s, subSpecialities: [...s.subSpecialities, { name: '', isActive: true }] } : s));
  }
  function updateSub(i: number, patch: Partial<SubSpecialityEntry>) {
    setState((s) => {
      if (!s) return s;
      const next = [...s.subSpecialities];
      next[i] = { ...next[i], ...patch } as SubSpecialityEntry;
      return { ...s, subSpecialities: next };
    });
  }
  function removeSub(i: number) {
    setState((s) => (s ? { ...s, subSpecialities: s.subSpecialities.filter((_, idx) => idx !== i) } : s));
  }

  function addNamed(key: 'processes' | 'facilities' | 'designations') {
    setState((s) => (s ? { ...s, [key]: [...s[key], { name: '', isActive: true }] } : s));
  }
  function updateNamed(key: 'processes' | 'facilities' | 'designations', i: number, patch: Partial<NamedEntry>) {
    setState((s) => {
      if (!s) return s;
      const next = [...s[key]];
      next[i] = { ...next[i], ...patch } as NamedEntry;
      return { ...s, [key]: next };
    });
  }
  function removeNamed(key: 'processes' | 'facilities' | 'designations', i: number) {
    setState((s) => (s ? { ...s, [key]: s[key].filter((_, idx) => idx !== i) } : s));
  }

  function setProcessWiseCoding(v: boolean) {
    setState((s) => (s ? { ...s, doesSupportProcessWiseCoding: v } : s));
  }

  return (
    <div className="space-y-6">
      {error && <div className="text-xs px-3 py-2 rounded-lg bg-danger-soft text-danger">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <GridSection title="Processes">
          <BrandCheckbox
            checked={state.doesSupportProcessWiseCoding ?? false}
            disabled={!canEdit}
            onChange={setProcessWiseCoding}
            label="Does location supports process wise coding?"
          />
          {!state.doesSupportProcessWiseCoding && state.processes.length === 0 && (
            <p className="mt-3 text-[11px] text-ink-muted italic">
              Enable the checkbox above to define per-process coding queues.
            </p>
          )}
          <div
            className={cn(
              'mt-4 space-y-2 transition',
              !state.doesSupportProcessWiseCoding && 'opacity-50 pointer-events-none',
            )}
          >
            {state.processes.map((it, i) => (
              <NameRow
                key={it.id ?? `new-${i}`}
                value={it.name}
                disabled={!canEdit}
                placeholder="Process name"
                onChange={(v) => updateNamed('processes', i, { name: v })}
                onRemove={() => removeNamed('processes', i)}
              />
            ))}
            {canEdit && <AddAnotherButton onClick={() => addNamed('processes')} />}
          </div>
        </GridSection>

        <GridSection title="Primary Specialities">
          <div className="space-y-2">
            {state.primarySpecialities.map((it, i) => (
              <NameRow
                key={it.id ?? `new-${i}`}
                value={it.name}
                disabled={!canEdit}
                placeholder="Speciality name"
                onChange={(v) => updatePrimary(i, { name: v })}
                onRemove={() => removePrimary(i)}
              />
            ))}
            {canEdit && <AddAnotherButton onClick={addPrimary} />}
          </div>
        </GridSection>

        <GridSection title="Facility">
          <div className="space-y-2">
            {state.facilities.map((it, i) => (
              <NameRow
                key={it.id ?? `new-${i}`}
                value={it.name}
                disabled={!canEdit}
                placeholder="Facility name"
                onChange={(v) => updateNamed('facilities', i, { name: v })}
                onRemove={() => removeNamed('facilities', i)}
              />
            ))}
            {canEdit && <AddAnotherButton onClick={() => addNamed('facilities')} />}
          </div>
        </GridSection>

        <GridSection title="Sub Speciality">
          <div className="space-y-2">
            {state.subSpecialities.map((it, i) => (
              <NameRow
                key={it.id ?? `new-${i}`}
                value={it.name}
                disabled={!canEdit}
                placeholder="Sub speciality name"
                onChange={(v) => updateSub(i, { name: v })}
                onRemove={() => removeSub(i)}
              />
            ))}
            {canEdit && <AddAnotherButton onClick={addSub} />}
          </div>
        </GridSection>
      </div>

      {canEdit && (
        <div className="flex items-center justify-end gap-3 pt-2">
          {savedAt && (
            <span className="text-[11px] text-success inline-flex items-center gap-1 mr-2">
              <CheckCircle2 className="w-3 h-3" /> Saved
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              data &&
              setState({
                primarySpecialities: data.primarySpecialities ?? [],
                subSpecialities: data.subSpecialities ?? [],
                processes: data.processes ?? [],
                facilities: data.facilities ?? [],
                designations: data.designations ?? [],
                doesSupportProcessWiseCoding: data.doesSupportProcessWiseCoding ?? false,
              })
            }
          >
            Cancel
          </Button>
          <Button
            loading={m.isPending}
            onClick={() => {
              setError(null);
              m.mutate(state);
            }}
          >
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

/* ── Grid section card (collapsible) ──────────────── */
function GridSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="w-6 h-6 rounded hover:bg-surface-sunken flex items-center justify-center text-ink-muted transition"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <Plus className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
        </button>
      </div>
      {!collapsed && children}
    </Card>
  );
}

/* ── Editable name row with × delete ──────────────── */
function NameRow({
  value,
  onChange,
  onRemove,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onRemove: () => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <Input
        className="flex-1"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          className="w-8 h-8 rounded-full bg-danger-soft text-danger hover:bg-danger/15 transition flex items-center justify-center shrink-0"
          title="Remove"
        >
          <X className="w-3.5 h-3.5" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

/* ── "+ Add another" pill ─────────────────────────── */
function AddAnotherButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-pill bg-surface-sunken text-ink-muted hover:bg-surface-2 hover:text-ink text-xs font-semibold transition"
    >
      <Plus className="w-3.5 h-3.5" />
      Add another
    </button>
  );
}

/* ── Brand-styled checkbox ────────────────────────── */
function BrandCheckbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-2.5 group select-none',
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <span
        className={cn(
          'w-[18px] h-[18px] rounded-md border-2 transition flex items-center justify-center shrink-0',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-primary/50 peer-focus-visible:ring-offset-2',
          checked
            ? 'bg-primary border-primary'
            : 'bg-surface border-line-strong group-hover:border-primary/60',
        )}
      >
        {checked && <Check className="w-3 h-3 text-primary-ink" strokeWidth={3.5} />}
      </span>
      <span className="text-sm text-ink font-medium">{label}</span>
    </label>
  );
}


/* ═════════════════ Feedback Categories editor ═════════════════ */
function FeedbackCategoriesEditor({
  canEdit,
  clientId,
  locationId,
}: {
  canEdit: boolean;
  clientId: number;
  locationId: number;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [addAreaOpen, setAddAreaOpen] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ['configurations', 'feedback-categories', clientId, locationId],
    queryFn: () => getFeedbackCategories({ clientId, locationId }),
  });

  const [areas, setAreas] = useState<FeedbackArea[] | null>(null);

  useEffect(() => {
    if (data) setAreas(structuredClone(data.areas));
  }, [data]);

  const m = useMutation({
    mutationFn: (payload: { areas: Array<{ id: number; reasons: FeedbackReason[] }> }) =>
      updateFeedbackCategories({ clientId, locationId, ...payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configurations', 'feedback-categories', clientId, locationId] });
      setSavedAt(new Date());
    },
    onError: (e) => setError((e as unknown as ApiErrorShape).message),
  });

  const addArea = useMutation({
    mutationFn: (name: string) => createAuditArea({ clientId, locationId, name }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['configurations', 'feedback-categories', clientId, locationId] }),
    onError: (e) => setError((e as unknown as ApiErrorShape).message),
  });

  const removeArea = useMutation({
    mutationFn: (id: number) => deleteAuditArea(id, { clientId, locationId }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['configurations', 'feedback-categories', clientId, locationId] }),
    onError: (e) => setError((e as unknown as ApiErrorShape).message),
  });

  if (isPending || !areas) return <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />;

  function updateArea(idx: number, patch: (a: FeedbackArea) => FeedbackArea) {
    setAreas((as) => {
      if (!as) return as;
      const next = [...as];
      next[idx] = patch(next[idx]);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs text-danger">
        <AlertTriangle className="w-3.5 h-3.5" />
        Changes to existing feedback categories will impact all charts, including audited ones.
      </div>

      {error && <div className="text-xs px-3 py-2 rounded-lg bg-danger-soft text-danger">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {areas.map((area, i) => (
          <FeedbackAreaCard
            key={area.id}
            area={area}
            canEdit={canEdit}
            onChange={(updated) => updateArea(i, () => updated)}
            onDelete={
              canEdit && !area.isBuiltin && !area.isSystem
                ? () => {
                    if (confirm(`Delete audit area "${area.name}"?`)) removeArea.mutate(area.id);
                  }
                : undefined
            }
          />
        ))}
      </div>

      {canEdit && (
        <div className="flex items-center justify-between gap-3 pt-2">
          <Button
            type="button"
            variant="soft"
            leftIcon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setAddAreaOpen(true)}
          >
            Add Audit Area
          </Button>
          <div className="flex items-center gap-3">
            {savedAt && (
              <span className="text-[11px] text-success inline-flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Saved
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={() => data && setAreas(structuredClone(data.areas))}
            >
              Cancel
            </Button>
            <Button
              loading={m.isPending}
              onClick={() => {
                setError(null);
                m.mutate({
                  areas: areas.map((a) => ({
                    id: a.id,
                    reasons: a.reasons.filter((r) => r.name.trim()),
                  })),
                });
              }}
            >
              Save
            </Button>
          </div>
        </div>
      )}

      {addAreaOpen && (
        <AddAuditAreaModal
          existingNames={areas.map((a) => a.name)}
          onClose={() => setAddAreaOpen(false)}
          onSubmit={(name) => addArea.mutate(name, { onSuccess: () => setAddAreaOpen(false) })}
          submitting={addArea.isPending}
        />
      )}
    </div>
  );
}

function FeedbackAreaCard({
  area,
  canEdit,
  onChange,
  onDelete,
}: {
  area: FeedbackArea;
  canEdit: boolean;
  onChange: (a: FeedbackArea) => void;
  onDelete?: () => void;
}) {
  function addReason() {
    onChange({ ...area, reasons: [...area.reasons, { name: '' }] });
  }
  function updateReason(i: number, name: string) {
    const next = [...area.reasons];
    next[i] = { ...next[i], name };
    onChange({ ...area, reasons: next });
  }
  function removeReason(i: number) {
    onChange({ ...area, reasons: area.reasons.filter((_, idx) => idx !== i) });
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-ink">{area.name}</h3>
          {!area.isBuiltin && (
            <span className="text-[10px] uppercase tracking-[0.08em] text-ink-muted bg-surface-sunken px-1.5 py-0.5 rounded">
              Custom
            </span>
          )}
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="w-7 h-7 rounded-full bg-danger-soft text-danger hover:bg-danger/15 transition flex items-center justify-center"
            title="Delete custom audit area"
          >
            <X className="w-3.5 h-3.5" strokeWidth={2.5} />
          </button>
        )}
      </div>
      <div className="space-y-2">
        {area.reasons.map((r, i) => (
          <NameRow
            key={r.id ?? `new-${i}`}
            value={r.name}
            disabled={!canEdit}
            placeholder="Feedback reason"
            onChange={(v) => updateReason(i, v)}
            onRemove={() => removeReason(i)}
          />
        ))}
        {canEdit && <AddAnotherButton onClick={addReason} />}
      </div>
    </Card>
  );
}

function AddAuditAreaModal({
  existingNames,
  onClose,
  onSubmit,
  submitting,
}: {
  existingNames: string[];
  onClose: () => void;
  onSubmit: (name: string) => void;
  submitting: boolean;
}) {
  const { register, handleSubmit, formState } = useForm<{ name: string }>({ defaultValues: { name: '' } });
  return (
    <Modal open onClose={onClose} title="Add Audit Area" size="sm">
      <form
        onSubmit={handleSubmit((d) => {
          const name = d.name.trim();
          if (!name) return;
          if (existingNames.some((n) => n.toLowerCase() === name.toLowerCase())) return;
          onSubmit(name);
        })}
        className="space-y-3"
      >
        <div>
          <Label required>Name</Label>
          <Input
            autoFocus
            placeholder="e.g. Deep Analysis"
            {...register('name', {
              required: true,
              validate: (v) =>
                !existingNames.some((n) => n.toLowerCase() === v.trim().toLowerCase()) ||
                'An audit area with this name already exists.',
            })}
          />
          {formState.errors.name && (
            <p className="mt-1 text-xs text-danger">{formState.errors.name.message ?? 'Required'}</p>
          )}
        </div>
        <ModalFooter>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Create
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/* ═════════════════ Auditing editor ═════════════════ */
function AuditingEditor({
  canEdit,
  clientId,
  locationId,
}: {
  canEdit: boolean;
  clientId: number;
  locationId: number;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['configurations', 'auditing', clientId, locationId],
    queryFn: () => getAuditingConfig({ clientId, locationId }),
  });

  const [state, setState] = useState<AuditingConfig | null>(null);

  useEffect(() => {
    if (data) {
      setState({
        auditOptions: data.auditOptions ?? [],
        feedbackTypes: data.feedbackTypes ?? [],
      });
    }
  }, [data]);

  const m = useMutation({
    mutationFn: (dto: AuditingConfig) => updateAuditingConfig({ ...dto, clientId, locationId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configurations', 'auditing', clientId, locationId] });
      setSavedAt(new Date());
    },
    onError: (e) => setError((e as unknown as ApiErrorShape).message),
  });

  if (isPending || !state) return <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />;

  return (
    <div className="space-y-5">
      {error && <div className="text-xs px-3 py-2 rounded-lg bg-danger-soft text-danger">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FlatListCard
          title="Audit Options"
          description="Audit dispositions available when auditor reviews a chart"
          items={state.auditOptions}
          canEdit={canEdit}
          onChange={(next) => setState((s) => (s ? { ...s, auditOptions: next } : s))}
        />
        <FlatListCard
          title="Feedback Types"
          description="Top-level types of feedback auditors can provide"
          items={state.feedbackTypes}
          canEdit={canEdit}
          onChange={(next) => setState((s) => (s ? { ...s, feedbackTypes: next } : s))}
        />
      </div>

      {canEdit && (
        <SaveBar
          onRevert={() =>
            data &&
            setState({
              auditOptions: data.auditOptions ?? [],
              feedbackTypes: data.feedbackTypes ?? [],
            })
          }
          onSave={() => {
            setError(null);
            m.mutate({
              auditOptions: (state.auditOptions ?? []).filter((x) => x.name.trim()),
              feedbackTypes: (state.feedbackTypes ?? []).filter((x) => x.name.trim()),
            });
          }}
          saving={m.isPending}
          savedAt={savedAt}
          saveLabel="Save auditing config"
        />
      )}
    </div>
  );
}

/* ═════════════════ Coding editor ═════════════════ */
function CodingEditor({
  canEdit,
  clientId,
  locationId,
}: {
  canEdit: boolean;
  clientId: number;
  locationId: number;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['configurations', 'coding', clientId, locationId],
    queryFn: () => getCodingConfig({ clientId, locationId }),
  });

  const [state, setState] = useState<CodingConfig | null>(null);

  useEffect(() => {
    if (data) {
      setState({
        holdReasons: data.holdReasons ?? [],
        responsibleParties: data.responsibleParties ?? [],
        dispositions: data.dispositions ?? [],
        primaryHealthPlans: data.primaryHealthPlans ?? [],
      });
    }
  }, [data]);

  const m = useMutation({
    mutationFn: (dto: CodingConfig) => updateCodingConfig({ ...dto, clientId, locationId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configurations', 'coding', clientId, locationId] });
      setSavedAt(new Date());
    },
    onError: (e) => setError((e as unknown as ApiErrorShape).message),
  });

  if (isPending || !state) return <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />;

  return (
    <div className="space-y-5">
      {error && <div className="text-xs px-3 py-2 rounded-lg bg-danger-soft text-danger">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FlatListCard
          title="Hold Reasons"
          description="Why a chart was put on hold"
          items={state.holdReasons}
          canEdit={canEdit}
          onChange={(next) => setState((s) => (s ? { ...s, holdReasons: next } : s))}
        />
        <FlatListCard
          title="Responsible Parties"
          description="Who owns resolution when a chart is on hold"
          items={state.responsibleParties}
          canEdit={canEdit}
          onChange={(next) => setState((s) => (s ? { ...s, responsibleParties: next } : s))}
        />
        <FlatListCard
          title="Dispositions"
          description="Final chart dispositions (Admit, Discharge, AMA...)"
          items={state.dispositions}
          canEdit={canEdit}
          onChange={(next) => setState((s) => (s ? { ...s, dispositions: next } : s))}
        />
        <FlatListCard
          title="Primary Health Plans"
          description="Common payors for the Primary Health Plan dropdown"
          items={state.primaryHealthPlans}
          canEdit={canEdit}
          onChange={(next) => setState((s) => (s ? { ...s, primaryHealthPlans: next } : s))}
        />
      </div>

      {canEdit && (
        <SaveBar
          onRevert={() =>
            data &&
            setState({
              holdReasons: data.holdReasons ?? [],
              responsibleParties: data.responsibleParties ?? [],
              dispositions: data.dispositions ?? [],
              primaryHealthPlans: data.primaryHealthPlans ?? [],
            })
          }
          onSave={() => {
            setError(null);
            m.mutate({
              holdReasons: (state.holdReasons ?? []).filter((x) => x.name.trim()),
              responsibleParties: (state.responsibleParties ?? []).filter((x) => x.name.trim()),
              dispositions: (state.dispositions ?? []).filter((x) => x.name.trim()),
              primaryHealthPlans: (state.primaryHealthPlans ?? []).filter((x) => x.name.trim()),
            });
          }}
          saving={m.isPending}
          savedAt={savedAt}
          saveLabel="Save coding config"
        />
      )}
    </div>
  );
}

/* ─── Shared: flat "name-only" list with add/delete ─── */
function FlatListCard({
  title,
  description,
  items,
  canEdit,
  onChange,
}: {
  title: string;
  description: string;
  items: Array<{ id?: number; name: string }> | undefined | null;
  canEdit: boolean;
  onChange: (items: Array<{ id?: number; name: string }>) => void;
}) {
  const safeItems = items ?? [];

  function add() {
    onChange([...safeItems, { name: '' }]);
  }
  function update(i: number, name: string) {
    const next = [...safeItems];
    next[i] = { ...next[i], name };
    onChange(next);
  }
  function remove(i: number) {
    onChange(safeItems.filter((_, idx) => idx !== i));
  }

  return (
    <SectionCard title={title} description={description} onAdd={canEdit ? add : undefined}>
      {safeItems.length === 0 ? (
        <EmptyRow message={`No entries yet.`} />
      ) : (
        <div className="space-y-1.5">
          {safeItems.map((it, i) => (
            <div key={it.id ?? `new-${i}`} className="flex items-center gap-2">
              <Input
                className="flex-1"
                value={it.name}
                disabled={!canEdit}
                placeholder="Name"
                onChange={(e) => update(i, e.target.value)}
              />
              {canEdit && <DeleteRowButton onClick={() => remove(i)} />}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/* ═════════════════ Chart Fields editor ═════════════════ */
function ChartFieldsEditor({
  canEdit,
  clientId,
  locationId,
}: {
  canEdit: boolean;
  clientId: number;
  locationId: number;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [editingField, setEditingField] = useState<CustomChartField | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [specialityId, setSpecialityId] = useState<number | null>(null);

  const specs = useQuery({
    queryKey: ['configurations', 'primary-specialities', clientId],
    queryFn: () => listPrimarySpecialities(clientId),
  });

  const { data, isPending } = useQuery({
    queryKey: ['configurations', 'chart-fields', clientId, locationId, specialityId],
    queryFn: () => getChartFieldsConfig({ clientId, locationId, specialityId }),
  });

  const [standardState, setStandardState] = useState<Record<string, ValidationRule>>({});

  useEffect(() => {
    if (data) {
      const byKey: Record<string, ValidationRule> = {};
      for (const f of data.standardFields ?? []) {
        byKey[f.key] = f.validation;
      }
      setStandardState(byKey);
    }
  }, [data]);

  const invalidateChartFields = () =>
    qc.invalidateQueries({ queryKey: ['configurations', 'chart-fields', clientId, locationId] });

  const saveStandard = useMutation({
    mutationFn: (dto: ChartFieldsConfig) =>
      updateChartFieldsConfig({ ...dto, clientId, locationId, specialityId }),
    onSuccess: () => {
      invalidateChartFields();
      setSavedAt(new Date());
    },
    onError: (e) => setError((e as unknown as ApiErrorShape).message),
  });

  const deleteCustom = useMutation({
    mutationFn: (id: number) => deleteCustomChartField(id),
    onSuccess: () => {
      invalidateChartFields();
      setDeletingId(null);
    },
    onError: (e) => setError((e as unknown as ApiErrorShape).message),
  });

  function setAllValidation(value: ValidationRule) {
    const next: Record<string, ValidationRule> = {};
    STANDARD_CHART_FIELDS.forEach((f) => {
      next[f.key] = value;
    });
    setStandardState(next);
  }

  if (isPending) return <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />;

  return (
    <div className="space-y-6">
      {error && <div className="text-xs px-3 py-2 rounded-lg bg-danger-soft text-danger">{error}</div>}

      {/* Primary Speciality scope picker */}
      <Card>
        <div className="flex items-center gap-3">
          <Label className="!mb-0 shrink-0">Primary Speciality</Label>
          <div className="w-72">
            <FancySelect
              value={specialityId == null ? 'all' : String(specialityId)}
              onChange={(v) => setSpecialityId(v === 'all' ? null : Number(v))}
              options={[
                { value: 'all', label: 'All (baseline)' },
                ...(specs.data?.items ?? []).map((s) => ({ value: String(s.id), label: s.name })),
              ]}
            />
          </div>
          <p className="text-[11px] text-ink-muted ml-auto">
            {specialityId == null
              ? 'Editing the All-specialities baseline.'
              : 'Editing speciality override (only changes from baseline are saved).'}
          </p>
        </div>
      </Card>

      {/* Standard Fields Matrix */}
      <SectionCard
        title="Standard Chart Fields"
        description="Mandatory / Non-Mandatory / Not-Applicable per field for coders"
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-head text-left" style={{ width: '40%' }}>Field</th>
                <th className="table-head text-center">
                  <div className="flex flex-col items-center gap-1">
                    Mandatory
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setAllValidation('MANDATORY')}
                        className="text-[10px] px-2 py-0.5 rounded-pill bg-primary text-primary-ink font-semibold"
                      >
                        Select all
                      </button>
                    )}
                  </div>
                </th>
                <th className="table-head text-center">
                  <div className="flex flex-col items-center gap-1">
                    Non-Mandatory
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setAllValidation('NON_MANDATORY')}
                        className="text-[10px] px-2 py-0.5 rounded-pill bg-primary text-primary-ink font-semibold"
                      >
                        Select all
                      </button>
                    )}
                  </div>
                </th>
                <th className="table-head text-center">Not-Applicable</th>
              </tr>
            </thead>
            <tbody>
              {STANDARD_CHART_FIELDS.map((f) => {
                const current = standardState[f.key] ?? 'NON_MANDATORY';
                return (
                  <tr key={f.key} className="border-t border-line">
                    <td className="py-2 text-sm text-ink">{f.label}</td>
                    {(['MANDATORY', 'NON_MANDATORY', 'NOT_APPLICABLE'] as ValidationRule[]).map((v) => (
                      <td key={v} className="text-center py-2">
                        <Radio
                          name={`chart-field-${f.key}`}
                          checked={current === v}
                          disabled={!canEdit}
                          onChange={() => setStandardState((s) => ({ ...s, [f.key]: v }))}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div className="flex justify-end mt-4">
            <Button
              size="sm"
              leftIcon={<Save className="w-3 h-3" />}
              loading={saveStandard.isPending}
              onClick={() => {
                setError(null);
                saveStandard.mutate({
                  standardFields: STANDARD_CHART_FIELDS.map((f) => ({
                    key: f.key,
                    validation: standardState[f.key] ?? 'NON_MANDATORY',
                  })),
                  customFields: data?.customFields ?? [],
                });
              }}
            >
              Save standard fields
            </Button>
          </div>
        )}
      </SectionCard>

      {/* Custom Fields Table */}
      <SectionCard
        title="Custom Chart Fields"
        description="Tenant-specific fields added to the chart editor"
        onAdd={
          canEdit
            ? () => {
                setEditingField(null);
                setCustomModalOpen(true);
              }
            : undefined
        }
        addLabel="Add field"
      >
        {(data?.customFields ?? []).length === 0 ? (
          <EmptyRow message="No custom fields yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-head">Name</th>
                  <th className="table-head">Type</th>
                  <th className="table-head">Multi-select</th>
                  <th className="table-head">Validation</th>
                  <th className="table-head">Placement</th>
                  <th className="table-head text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.customFields.map((f) => (
                  <tr key={f.id} className="border-t border-line">
                    <td className="table-cell font-semibold text-ink">{f.name}</td>
                    <td className="table-cell text-ink-muted">{f.type}</td>
                    <td className="table-cell text-ink-muted">{f.isMultiSelect ? 'Yes' : 'No'}</td>
                    <td className="table-cell text-ink-muted">{f.validation}</td>
                    <td className="table-cell text-ink-muted">{f.placement ?? '—'}</td>
                    <td className="table-cell text-right">
                      {canEdit && (
                        <div className="inline-flex gap-1">
                          <button
                            onClick={() => {
                              setEditingField(f);
                              setCustomModalOpen(true);
                            }}
                            className="w-7 h-7 rounded-full bg-surface-sunken hover:bg-primary-soft flex items-center justify-center text-ink-muted hover:text-primary-ink transition"
                            title="Edit"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setDeletingId(f.id)}
                            className="w-7 h-7 rounded-full bg-danger-soft hover:bg-danger/20 flex items-center justify-center text-danger transition"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {savedAt && (
        <p className="text-[11px] text-success text-right inline-flex items-center gap-1 justify-end w-full">
          <CheckCircle2 className="w-3 h-3" /> Saved
        </p>
      )}

      {customModalOpen && (
        <CustomChartFieldModal
          field={editingField}
          clientId={clientId}
          locationId={locationId}
          specialityId={specialityId}
          onClose={() => {
            setCustomModalOpen(false);
            setEditingField(null);
          }}
          onSaved={() => {
            invalidateChartFields();
            setCustomModalOpen(false);
            setEditingField(null);
          }}
        />
      )}

      {deletingId !== null && (
        <ConfirmModal
          open
          onClose={() => setDeletingId(null)}
          onConfirm={() => deleteCustom.mutate(deletingId)}
          message="Delete this custom field? Existing data for this field on saved charts will be preserved."
          variant="danger"
          confirmLabel="Delete"
          loading={deleteCustom.isPending}
        />
      )}
    </div>
  );
}

function CustomChartFieldModal({
  field,
  clientId,
  locationId,
  specialityId,
  onClose,
  onSaved,
}: {
  field: CustomChartField | null;
  clientId: number;
  locationId: number;
  specialityId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, watch, setValue, control } = useForm<Omit<CreateCustomChartFieldDto, 'clientId' | 'locationId' | 'specialityId'>>({
    defaultValues: field ?? {
      name: '',
      type: 'text',
      isMultiSelect: false,
      validation: 'NON_MANDATORY',
      placement: 'Chart Info',
      options: [],
    },
  });
  const type = watch('type');
  const placement = watch('placement');
  const validation = watch('validation');

  const m = useMutation({
    mutationFn: (d: Omit<CreateCustomChartFieldDto, 'clientId' | 'locationId' | 'specialityId'>) =>
      field
        ? updateCustomChartField(field.id, d)
        : createCustomChartField({ ...d, clientId, locationId, specialityId }),
    onSuccess: () => onSaved(),
    onError: (e) => setError((e as unknown as ApiErrorShape).message),
  });

  return (
    <Modal open onClose={onClose} title={field ? 'Edit custom field' : 'Add custom field'} size="md">
      <form
        onSubmit={handleSubmit((d) => {
          const options = d.type === 'dropdown' ? d.options ?? [] : undefined;
          m.mutate({ ...d, options });
        })}
        className="space-y-4"
      >
        {error && <div className="text-xs px-3 py-2 rounded bg-danger-soft text-danger">{error}</div>}

        <div>
          <Label required>Field name</Label>
          <Input {...register('name', { required: true })} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label required>Type</Label>
            <FancySelect
              value={type ?? 'text'}
              onChange={(v) =>
                setValue('type', v as CreateCustomChartFieldDto['type'], { shouldDirty: true })
              }
              options={[
                { value: 'text', label: 'Text' },
                { value: 'dropdown', label: 'Dropdown' },
                { value: 'date', label: 'Date' },
                { value: 'number', label: 'Number' },
                { value: 'multiline', label: 'Multiline' },
              ]}
            />
          </div>
          <div>
            <Label required>Validation</Label>
            <FancySelect
              value={validation ?? 'NON_MANDATORY'}
              onChange={(v) =>
                setValue('validation', v as ValidationRule, { shouldDirty: true })
              }
              options={[
                { value: 'NON_MANDATORY', label: 'Non-Mandatory' },
                { value: 'MANDATORY', label: 'Mandatory' },
                { value: 'NOT_APPLICABLE', label: 'Not-Applicable' },
              ]}
            />
          </div>
        </div>

        {type === 'dropdown' && (
          <>
            <Controller
              control={control}
              name="isMultiSelect"
              render={({ field: f }) => (
                <Switch
                  checked={!!f.value}
                  onChange={f.onChange}
                  label="Allow multiple selections"
                  description="Users can pick more than one option from this dropdown."
                />
              )}
            />
            <div>
              <Label>Options</Label>
              <Controller
                control={control}
                name="options"
                render={({ field: f }) => (
                  <OptionsBuilder
                    value={Array.isArray(f.value) ? f.value : []}
                    onChange={f.onChange}
                    placeholder="e.g. Smoker"
                  />
                )}
              />
            </div>
          </>
        )}

        <div>
          <Label>Placement</Label>
          <FancySelect
            value={placement ?? 'Chart Info'}
            onChange={(v) =>
              setValue('placement', v as CreateCustomChartFieldDto['placement'], {
                shouldDirty: true,
              })
            }
            options={[
              { value: 'Chart Info', label: 'Chart Info' },
              { value: 'Processing Info', label: 'Processing Info' },
            ]}
          />
        </div>

        <ModalFooter>
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={m.isPending}>{field ? 'Save changes' : 'Create field'}</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/* ═════════════════ HCC Fields editor ═════════════════ */
function HccFieldsEditor({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingField, setEditingField] = useState<HccFieldDef | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['configurations', 'hcc-fields'],
    queryFn: listHccFieldConfig,
  });

  const deleteM = useMutation({
    mutationFn: (id: number) => deleteHccField(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configurations', 'hcc-fields'] });
      setDeletingId(null);
    },
    onError: (e) => setError((e as unknown as ApiErrorShape).message),
  });

  if (isPending) return <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />;

  const fields = data ?? [];

  return (
    <div className="space-y-5">
      {error && <div className="text-xs px-3 py-2 rounded-lg bg-danger-soft text-danger">{error}</div>}

      <SectionCard
        title="HCC Fields"
        description="Fields shown in the HCC records entry form. Fields with 'Preserve next' stay filled in on Save & Next."
        onAdd={
          canEdit
            ? () => {
                setEditingField(null);
                setModalOpen(true);
              }
            : undefined
        }
        addLabel="Add field"
      >
        {fields.length === 0 ? (
          <EmptyRow message="No HCC fields yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-head">Name</th>
                  <th className="table-head">Type</th>
                  <th className="table-head">Multi-select</th>
                  <th className="table-head">Validation</th>
                  <th className="table-head">Preserve next</th>
                  <th className="table-head text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.id} className="border-t border-line">
                    <td className="table-cell font-semibold text-ink">{f.name}</td>
                    <td className="table-cell text-ink-muted">{f.type}</td>
                    <td className="table-cell text-ink-muted">{f.isMultiSelect ? 'Yes' : 'No'}</td>
                    <td className="table-cell text-ink-muted">{f.validation}</td>
                    <td className="table-cell">
                      {f.preserveNext ? (
                        <span className="chip bg-success-soft text-success">Yes</span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className="table-cell text-right">
                      {canEdit && (
                        <div className="inline-flex gap-1">
                          <button
                            onClick={() => {
                              setEditingField(f);
                              setModalOpen(true);
                            }}
                            className="w-7 h-7 rounded-full bg-surface-sunken hover:bg-primary-soft flex items-center justify-center text-ink-muted hover:text-primary-ink transition"
                            title="Edit"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setDeletingId(f.id)}
                            className="w-7 h-7 rounded-full bg-danger-soft hover:bg-danger/20 flex items-center justify-center text-danger transition"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {modalOpen && (
        <HccFieldModal
          field={editingField}
          onClose={() => {
            setModalOpen(false);
            setEditingField(null);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['configurations', 'hcc-fields'] });
            setModalOpen(false);
            setEditingField(null);
          }}
        />
      )}

      {deletingId !== null && (
        <ConfirmModal
          open
          onClose={() => setDeletingId(null)}
          onConfirm={() => deleteM.mutate(deletingId)}
          message="Delete this HCC field? Existing record values will be preserved."
          variant="danger"
          confirmLabel="Delete"
          loading={deleteM.isPending}
        />
      )}
    </div>
  );
}

function HccFieldModal({
  field,
  onClose,
  onSaved,
}: {
  field: HccFieldDef | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, watch, setValue, control } = useForm<Omit<HccFieldDef, 'id'>>({
    defaultValues: field ?? {
      name: '',
      type: 'text',
      isMultiSelect: false,
      validation: 'NON_MANDATORY',
      preserveNext: false,
      options: [],
    },
  });
  const type = watch('type');
  const validation = watch('validation');

  const m = useMutation({
    mutationFn: (d: Omit<HccFieldDef, 'id'>) =>
      field ? updateHccField(field.id, d) : createHccField(d),
    onSuccess: () => onSaved(),
    onError: (e) => setError((e as unknown as ApiErrorShape).message),
  });

  return (
    <Modal open onClose={onClose} title={field ? 'Edit HCC field' : 'Add HCC field'} size="md">
      <form
        onSubmit={handleSubmit((d) => {
          const options: string[] = d.type === 'dropdown' ? d.options ?? [] : [];
          m.mutate({ ...d, options });
        })}
        className="space-y-4"
      >
        {error && <div className="text-xs px-3 py-2 rounded bg-danger-soft text-danger">{error}</div>}

        <div>
          <Label required>Field name</Label>
          <Input {...register('name', { required: true })} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label required>Type</Label>
            <FancySelect
              value={type ?? 'text'}
              onChange={(v) =>
                setValue('type', v as HccFieldDef['type'], { shouldDirty: true })
              }
              options={[
                { value: 'text', label: 'Text' },
                { value: 'dropdown', label: 'Dropdown' },
                { value: 'date', label: 'Date' },
                { value: 'number', label: 'Number' },
                { value: 'multiline', label: 'Multiline' },
              ]}
            />
          </div>
          <div>
            <Label required>Validation</Label>
            <FancySelect
              value={validation ?? 'NON_MANDATORY'}
              onChange={(v) =>
                setValue('validation', v as ValidationRule, { shouldDirty: true })
              }
              options={[
                { value: 'NON_MANDATORY', label: 'Non-Mandatory' },
                { value: 'MANDATORY', label: 'Mandatory' },
                { value: 'NOT_APPLICABLE', label: 'Not-Applicable' },
              ]}
            />
          </div>
        </div>

        {type === 'dropdown' && (
          <>
            <Controller
              control={control}
              name="isMultiSelect"
              render={({ field: f }) => (
                <Switch
                  checked={!!f.value}
                  onChange={f.onChange}
                  label="Allow multiple selections"
                  description="Users can pick more than one option from this dropdown."
                />
              )}
            />
            <div>
              <Label>Options</Label>
              <Controller
                control={control}
                name="options"
                render={({ field: f }) => (
                  <OptionsBuilder
                    value={Array.isArray(f.value) ? f.value : []}
                    onChange={f.onChange}
                    placeholder="e.g. Smoker"
                  />
                )}
              />
            </div>
          </>
        )}

        <Controller
          control={control}
          name="preserveNext"
          render={({ field: f }) => (
            <Switch
              checked={!!f.value}
              onChange={f.onChange}
              label="Preserve next"
              description='Keep this value when the user clicks "Save & Next".'
            />
          )}
        />

        <ModalFooter>
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={m.isPending}>{field ? 'Save changes' : 'Create field'}</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/* ═════════════════ Shared helpers ═════════════════ */

function SectionCard({
  title,
  description,
  onAdd,
  addLabel,
  children,
}: {
  title: string;
  description: string;
  onAdd?: () => void;
  addLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-ink">{title}</h3>
          <p className="text-[11px] text-ink-muted">{description}</p>
        </div>
        {onAdd && (
          <Button size="sm" variant="soft" leftIcon={<Plus className="w-3 h-3" />} onClick={onAdd}>
            {addLabel ?? 'Add row'}
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyRow({ message }: { message: string }) {
  return <p className="py-3 text-xs text-ink-muted text-center">{message}</p>;
}

function DeleteRowButton({ onClick, small }: { onClick: () => void; small?: boolean }) {
  const size = small ? 'w-6 h-6' : 'w-8 h-8';
  const icon = small ? 'w-3 h-3' : 'w-3.5 h-3.5';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        size,
        'rounded-full bg-danger-soft text-danger hover:bg-danger/20 transition flex items-center justify-center shrink-0',
      )}
      title="Remove row"
    >
      <Trash2 className={icon} />
    </button>
  );
}

function SaveBar({
  onRevert,
  onSave,
  saving,
  savedAt,
  saveLabel,
}: {
  onRevert: () => void;
  onSave: () => void;
  saving: boolean;
  savedAt: Date | null;
  saveLabel: string;
}) {
  return (
    <div className="flex items-center justify-end gap-3 pt-2 border-t border-line">
      {savedAt && (
        <span className="text-[11px] text-success inline-flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> Saved
        </span>
      )}
      <Button type="button" variant="ghost" onClick={onRevert}>
        Revert
      </Button>
      <Button leftIcon={<Save className="w-3.5 h-3.5" />} loading={saving} onClick={onSave}>
        {saveLabel}
      </Button>
    </div>
  );
}