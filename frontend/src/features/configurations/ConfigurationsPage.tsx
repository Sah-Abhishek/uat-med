import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
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
  getAuditingConfig,
  updateAuditingConfig,
  getCodingConfig,
  updateCodingConfig,
  getChartFieldsConfig,
  updateChartFieldsConfig,
  createCustomChartField,
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
  type FeedbackCategoryGroup,
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
import { Input, Label, Select } from '@/components/ui/Field';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';

type MainTab = 'general' | 'clients' | 'specialities';
type SpecTab = 'general' | 'feedback' | 'auditing' | 'coding' | 'chart-fields' | 'hcc-fields';

const AUDIT_AREAS: FeedbackCategoryGroup['area'][] = [
  'Primary Diagnosis',
  'Secondary Diagnosis',
  'Procedures',
  'ED/EM Level',
  'Modifier',
  'POA Indicator',
  'Drug Value',
];

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
              { key: 'clients', label: 'Clients & Locations' },
              { key: 'specialities', label: 'Specialities' },
            ]}
            value={tab}
            onChange={(k) => setTab(k as MainTab)}
          />
        </div>

        <div className="p-6">
          {tab === 'general' && <GeneralTab canEdit={canEdit} />}
          {tab === 'clients' && <ClientsTab canEdit={canEdit} />}
          {tab === 'specialities' && <SpecialitiesTab canEdit={canEdit} />}
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

/* ═════════════════ Clients tab ═════════════════ */
function ClientsTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [selectedClient, setSelectedClient] = useState<number | null>(null);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [addLocationOpen, setAddLocationOpen] = useState(false);

  const clients = useQuery({ queryKey: ['configurations', 'clients'], queryFn: listClients });

  useEffect(() => {
    if (!selectedClient && clients.data?.items.length) {
      setSelectedClient(clients.data.items[0].id);
    }
  }, [clients.data, selectedClient]);

  const selectedClientObj = clients.data?.items.find((c) => c.id === selectedClient);

  const locations = useQuery({
    queryKey: ['configurations', 'locations', selectedClient],
    queryFn: () => listLocations(selectedClient!),
    enabled: !!selectedClient,
  });

  return (
    <div className="grid grid-cols-2 gap-6">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-ink">Clients</h3>
          {canEdit && (
            <Button size="sm" leftIcon={<Plus className="w-3 h-3" />} onClick={() => setAddClientOpen(true)}>
              Add
            </Button>
          )}
        </div>
        <p className="text-[11px] text-ink-muted mb-2">Click a client to manage its locations →</p>
        {clients.isPending ? (
          <Loader2 className="w-4 h-4 animate-spin text-ink-muted" />
        ) : clients.data?.items.length === 0 ? (
          <div className="border border-dashed border-line rounded-lg p-6 text-center">
            <p className="text-xs text-ink-muted mb-3">No clients yet.</p>
            {canEdit && (
              <Button size="sm" onClick={() => setAddClientOpen(true)} leftIcon={<Plus className="w-3 h-3" />}>
                Add first client
              </Button>
            )}
          </div>
        ) : (
          <div className="border border-line rounded-lg divide-y divide-line overflow-hidden">
            {clients.data?.items.map((c) => {
              const isSelected = selectedClient === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedClient(c.id)}
                  className={cn(
                    'w-full flex items-center justify-between p-3 text-left transition relative',
                    isSelected
                      ? 'bg-primary-soft border-l-4 border-primary pl-2'
                      : 'hover:bg-surface-sunken/50 border-l-4 border-transparent',
                  )}
                >
                  <div>
                    <p className={cn('text-sm font-semibold', isSelected ? 'text-primary-ink' : 'text-ink')}>
                      {c.name}
                    </p>
                    <p className="text-[11px] text-ink-muted">{c.code ?? '—'}</p>
                  </div>
                  <span
                    className={cn(
                      'chip',
                      c.isActive ? 'bg-success-soft text-success' : 'bg-surface-sunken text-ink-muted',
                    )}
                  >
                    {c.isActive ? 'Active' : 'Inactive'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-ink">
            Locations
            {selectedClientObj && (
              <span className="text-ink-muted font-medium"> · {selectedClientObj.name}</span>
            )}
          </h3>
          {canEdit && selectedClient && (
            <Button size="sm" leftIcon={<Plus className="w-3 h-3" />} onClick={() => setAddLocationOpen(true)}>
              Add
            </Button>
          )}
        </div>
        {!selectedClient ? (
          <p className="text-xs text-ink-muted">Select a client to view locations.</p>
        ) : locations.isPending ? (
          <Loader2 className="w-4 h-4 animate-spin text-ink-muted" />
        ) : locations.data?.items.length === 0 ? (
          <div className="border border-dashed border-line rounded-lg p-6 text-center">
            <p className="text-xs text-ink-muted mb-3">No locations for this client yet.</p>
            {canEdit && (
              <Button size="sm" onClick={() => setAddLocationOpen(true)} leftIcon={<Plus className="w-3 h-3" />}>
                Add first location
              </Button>
            )}
          </div>
        ) : (
          <div className="border border-line rounded-lg divide-y divide-line overflow-hidden">
            {locations.data?.items.map((l) => (
              <div key={l.id} className="flex items-center justify-between p-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{l.name}</p>
                  <p className="text-[11px] text-ink-muted">{l.code ?? '—'}</p>
                </div>
                <span
                  className={cn(
                    'chip',
                    l.isActive ? 'bg-success-soft text-success' : 'bg-surface-sunken text-ink-muted',
                  )}
                >
                  {l.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

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
    </div>
  );
}

function AddClientModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { register, handleSubmit } = useForm<{ name: string; code: string; isActive: boolean }>({
    defaultValues: { name: '', code: '', isActive: true },
  });
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (d: { name: string; code: string; isActive: boolean }) => createClient(d),
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
          <Input {...register('name', { required: true })} />
        </div>
        <div>
          <Label>Code</Label>
          <Input placeholder="e.g. CLI01" {...register('code')} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register('isActive')} className="accent-primary" />
          Active
        </label>
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
  const { register, handleSubmit } = useForm<{ name: string; code: string; isActive: boolean }>({
    defaultValues: { name: '', code: '', isActive: true },
  });
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (d: { name: string; code: string; isActive: boolean }) =>
      createLocation({ ...d, clientId }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) => setErr((e as unknown as ApiErrorShape).message),
  });
  return (
    <Modal open onClose={onClose} title="Add Location" subtitle={`Client #${clientId}`} size="sm">
      <form onSubmit={handleSubmit((d) => m.mutate(d))} className="space-y-3">
        {err && <div className="text-xs px-3 py-2 rounded bg-danger-soft text-danger">{err}</div>}
        <div>
          <Label required>Name</Label>
          <Input {...register('name', { required: true })} />
        </div>
        <div>
          <Label>Code</Label>
          <Input {...register('code')} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register('isActive')} className="accent-primary" />
          Active
        </label>
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

  return (
    <div>
      <Tabs
        tabs={[
          { key: 'general', label: 'General' },
          { key: 'feedback', label: 'Feedback Categories' },
          { key: 'auditing', label: 'Auditing' },
          { key: 'coding', label: 'Coding' },
          { key: 'chart-fields', label: 'Chart Fields' },
          { key: 'hcc-fields', label: 'HCC Fields' },
        ]}
        value={sub}
        onChange={(k) => setSub(k as SpecTab)}
        className="mb-5"
      />

      {sub === 'general' && <SpecialitiesGeneralEditor canEdit={canEdit} />}
      {sub === 'feedback' && <FeedbackCategoriesEditor canEdit={canEdit} />}
      {sub === 'auditing' && <AuditingEditor canEdit={canEdit} />}
      {sub === 'coding' && <CodingEditor canEdit={canEdit} />}
      {sub === 'chart-fields' && <ChartFieldsEditor canEdit={canEdit} />}
      {sub === 'hcc-fields' && <HccFieldsEditor canEdit={canEdit} />}
    </div>
  );
}

/* ═════════════════ Specialities → General editor ═════════════════ */
function SpecialitiesGeneralEditor({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['configurations', 'spec-general'],
    queryFn: () => getSpecialitiesGeneral(),
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
      });
    }
  }, [data]);

  const m = useMutation({
    mutationFn: updateSpecialitiesGeneral,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configurations', 'spec-general'] });
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

  return (
    <div className="space-y-6">
      {error && <div className="text-xs px-3 py-2 rounded-lg bg-danger-soft text-danger">{error}</div>}

      <PrimarySpecialitiesSection
        items={state.primarySpecialities}
        canEdit={canEdit}
        onAdd={addPrimary}
        onUpdate={updatePrimary}
        onRemove={removePrimary}
      />

      <SubSpecialitiesSection
        items={state.subSpecialities}
        parents={state.primarySpecialities}
        canEdit={canEdit}
        onAdd={addSub}
        onUpdate={updateSub}
        onRemove={removeSub}
      />

      <NamedSection
        title="Processes"
        description="Workflow categories (Coding, Auditing, QC...)"
        items={state.processes}
        canEdit={canEdit}
        onAdd={() => addNamed('processes')}
        onUpdate={(i, p) => updateNamed('processes', i, p)}
        onRemove={(i) => removeNamed('processes', i)}
      />

      <NamedSection
        title="Facilities"
        description="Physical sites or hospitals"
        items={state.facilities}
        canEdit={canEdit}
        onAdd={() => addNamed('facilities')}
        onUpdate={(i, p) => updateNamed('facilities', i, p)}
        onRemove={(i) => removeNamed('facilities', i)}
      />

      <NamedSection
        title="Designations"
        description="Job titles (Sr. Coder, Team Lead, etc.)"
        items={state.designations}
        canEdit={canEdit}
        onAdd={() => addNamed('designations')}
        onUpdate={(i, p) => updateNamed('designations', i, p)}
        onRemove={(i) => removeNamed('designations', i)}
      />

      {canEdit && (
        <SaveBar
          onRevert={() =>
            data &&
            setState({
              primarySpecialities: data.primarySpecialities ?? [],
              subSpecialities: data.subSpecialities ?? [],
              processes: data.processes ?? [],
              facilities: data.facilities ?? [],
              designations: data.designations ?? [],
            })
          }
          onSave={() => {
            setError(null);
            m.mutate(state);
          }}
          saving={m.isPending}
          savedAt={savedAt}
          saveLabel="Save all changes"
        />
      )}
    </div>
  );
}

function PrimarySpecialitiesSection({
  items,
  canEdit,
  onAdd,
  onUpdate,
  onRemove,
}: {
  items: PrimarySpecialityEntry[];
  canEdit: boolean;
  onAdd: () => void;
  onUpdate: (i: number, patch: Partial<PrimarySpecialityEntry>) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <SectionCard
      title="Primary Specialities"
      description="Top-level medical specialities (ED, IP, OP, etc.)"
      onAdd={canEdit ? onAdd : undefined}
    >
      {items.length === 0 ? (
        <EmptyRow message="No primary specialities yet." />
      ) : (
        <div className="divide-y divide-line">
          {items.map((it, i) => (
            <div key={it.id ?? `new-${i}`} className="py-2 flex items-center gap-3">
              <span className="text-[11px] text-ink-subtle font-mono w-10 shrink-0">{it.id ?? 'new'}</span>
              <Input
                className="flex-1"
                value={it.name}
                disabled={!canEdit}
                placeholder="Name"
                onChange={(e) => onUpdate(i, { name: e.target.value })}
              />
              <ActiveToggle
                value={it.isActive ?? true}
                disabled={!canEdit}
                onChange={(v) => onUpdate(i, { isActive: v })}
              />
              {canEdit && <DeleteRowButton onClick={() => onRemove(i)} />}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function SubSpecialitiesSection({
  items,
  parents,
  canEdit,
  onAdd,
  onUpdate,
  onRemove,
}: {
  items: SubSpecialityEntry[];
  parents: PrimarySpecialityEntry[];
  canEdit: boolean;
  onAdd: () => void;
  onUpdate: (i: number, patch: Partial<SubSpecialityEntry>) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <SectionCard
      title="Sub Specialities"
      description="Nested under a primary speciality (e.g. Trauma under ED)"
      onAdd={canEdit ? onAdd : undefined}
    >
      {items.length === 0 ? (
        <EmptyRow message="No sub specialities yet." />
      ) : (
        <div className="divide-y divide-line">
          {items.map((it, i) => (
            <div key={it.id ?? `new-${i}`} className="py-2 flex items-center gap-3">
              <span className="text-[11px] text-ink-subtle font-mono w-10 shrink-0">{it.id ?? 'new'}</span>
              <Input
                className="flex-1"
                value={it.name}
                disabled={!canEdit}
                placeholder="Name"
                onChange={(e) => onUpdate(i, { name: e.target.value })}
              />
              <Select
                className="w-44"
                value={it.primarySpecialityId ?? ''}
                disabled={!canEdit}
                onChange={(e) =>
                  onUpdate(i, {
                    primarySpecialityId: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              >
                <option value="">Parent…</option>
                {parents.filter((p) => p.id).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <ActiveToggle
                value={it.isActive ?? true}
                disabled={!canEdit}
                onChange={(v) => onUpdate(i, { isActive: v })}
              />
              {canEdit && <DeleteRowButton onClick={() => onRemove(i)} />}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function NamedSection({
  title,
  description,
  items,
  canEdit,
  onAdd,
  onUpdate,
  onRemove,
}: {
  title: string;
  description: string;
  items: NamedEntry[];
  canEdit: boolean;
  onAdd: () => void;
  onUpdate: (i: number, patch: Partial<NamedEntry>) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <SectionCard title={title} description={description} onAdd={canEdit ? onAdd : undefined}>
      {items.length === 0 ? (
        <EmptyRow message={`No ${title.toLowerCase()} yet.`} />
      ) : (
        <div className="divide-y divide-line">
          {items.map((it, i) => (
            <div key={it.id ?? `new-${i}`} className="py-2 flex items-center gap-3">
              <span className="text-[11px] text-ink-subtle font-mono w-10 shrink-0">{it.id ?? 'new'}</span>
              <Input
                className="flex-1"
                value={it.name}
                disabled={!canEdit}
                placeholder="Name"
                onChange={(e) => onUpdate(i, { name: e.target.value })}
              />
              <ActiveToggle
                value={it.isActive ?? true}
                disabled={!canEdit}
                onChange={(v) => onUpdate(i, { isActive: v })}
              />
              {canEdit && <DeleteRowButton onClick={() => onRemove(i)} />}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/* ═════════════════ Feedback Categories editor ═════════════════ */
function FeedbackCategoriesEditor({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['configurations', 'feedback-categories'],
    queryFn: () => getFeedbackCategories(),
  });

  const [groups, setGroups] = useState<FeedbackCategoryGroup[] | null>(null);

  useEffect(() => {
    if (data) {
      // Ensure every standard audit area has a group entry, even if empty
      const existing = data.groups ?? [];
      const complete = AUDIT_AREAS.map(
        (area) => existing.find((g) => g.area === area) ?? { area, categories: [] },
      );
      setGroups(structuredClone(complete));
    }
  }, [data]);

  const m = useMutation({
    mutationFn: updateFeedbackCategories,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configurations', 'feedback-categories'] });
      setSavedAt(new Date());
    },
    onError: (e) => setError((e as unknown as ApiErrorShape).message),
  });

  if (isPending || !groups) return <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />;

  function updateGroup(areaIdx: number, patch: (g: FeedbackCategoryGroup) => FeedbackCategoryGroup) {
    setGroups((gs) => {
      if (!gs) return gs;
      const next = [...gs];
      next[areaIdx] = patch(next[areaIdx]);
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
        {groups.map((group, i) => (
          <FeedbackAreaCard
            key={group.area}
            group={group}
            canEdit={canEdit}
            onChange={(newGroup) => updateGroup(i, () => newGroup)}
          />
        ))}
      </div>

      {canEdit && (
        <SaveBar
          onRevert={() => {
            if (data) {
              const existing = data.groups ?? [];
              const complete = AUDIT_AREAS.map(
                (area) => existing.find((g) => g.area === area) ?? { area, categories: [] },
              );
              setGroups(structuredClone(complete));
            }
          }}
          onSave={() => {
            setError(null);
            // Strip empty-name rows before saving
            const cleaned = groups.map((g) => ({
              ...g,
              categories: g.categories
                .filter((c) => c.name.trim())
                .map((c) => ({
                  ...c,
                  types: c.types.filter((t) => t.name.trim()),
                })),
            }));
            m.mutate(cleaned);
          }}
          saving={m.isPending}
          savedAt={savedAt}
          saveLabel="Save categories"
        />
      )}
    </div>
  );
}

function FeedbackAreaCard({
  group,
  canEdit,
  onChange,
}: {
  group: FeedbackCategoryGroup;
  canEdit: boolean;
  onChange: (g: FeedbackCategoryGroup) => void;
}) {
  function addCategory() {
    onChange({
      ...group,
      categories: [...group.categories, { name: '', types: [] }],
    });
  }
  function updateCategory(i: number, patch: { name?: string }) {
    const next = [...group.categories];
    next[i] = { ...next[i], ...patch };
    onChange({ ...group, categories: next });
  }
  function removeCategory(i: number) {
    onChange({ ...group, categories: group.categories.filter((_, idx) => idx !== i) });
  }
  function addType(catIdx: number) {
    const next = [...group.categories];
    next[catIdx] = { ...next[catIdx], types: [...next[catIdx].types, { name: '' }] };
    onChange({ ...group, categories: next });
  }
  function updateType(catIdx: number, tIdx: number, name: string) {
    const next = [...group.categories];
    const types = [...next[catIdx].types];
    types[tIdx] = { ...types[tIdx], name };
    next[catIdx] = { ...next[catIdx], types };
    onChange({ ...group, categories: next });
  }
  function removeType(catIdx: number, tIdx: number) {
    const next = [...group.categories];
    next[catIdx] = { ...next[catIdx], types: next[catIdx].types.filter((_, idx) => idx !== tIdx) };
    onChange({ ...group, categories: next });
  }

  return (
    <div className="rounded-xl border border-line p-4 bg-surface">
      <h4 className="text-sm font-bold text-ink mb-3">{group.area}</h4>
      {group.categories.length === 0 ? (
        <p className="text-xs text-ink-muted mb-3">No categories yet.</p>
      ) : (
        <div className="space-y-3 mb-3">
          {group.categories.map((cat, i) => (
            <div key={i} className="border border-line rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  className="flex-1 font-semibold"
                  value={cat.name}
                  disabled={!canEdit}
                  placeholder="Category name"
                  onChange={(e) => updateCategory(i, { name: e.target.value })}
                />
                {canEdit && <DeleteRowButton onClick={() => removeCategory(i)} />}
              </div>
              {cat.types.length > 0 && (
                <div className="pl-3 border-l-2 border-line space-y-1.5">
                  {cat.types.map((t, tIdx) => (
                    <div key={tIdx} className="flex items-center gap-2">
                      <Input
                        className="flex-1 text-xs"
                        value={t.name}
                        disabled={!canEdit}
                        placeholder="Feedback type"
                        onChange={(e) => updateType(i, tIdx, e.target.value)}
                      />
                      {canEdit && <DeleteRowButton small onClick={() => removeType(i, tIdx)} />}
                    </div>
                  ))}
                </div>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => addType(i)}
                  className="text-[11px] text-primary-ink hover:underline pl-3"
                >
                  + Add feedback type
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <Button size="sm" variant="soft" leftIcon={<Plus className="w-3 h-3" />} onClick={addCategory}>
          Add category
        </Button>
      )}
    </div>
  );
}

/* ═════════════════ Auditing editor ═════════════════ */
function AuditingEditor({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['configurations', 'auditing'],
    queryFn: () => getAuditingConfig(),
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
    mutationFn: updateAuditingConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configurations', 'auditing'] });
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
function CodingEditor({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['configurations', 'coding'],
    queryFn: () => getCodingConfig(),
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
    mutationFn: updateCodingConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configurations', 'coding'] });
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
function ChartFieldsEditor({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [editingField, setEditingField] = useState<CustomChartField | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['configurations', 'chart-fields'],
    queryFn: () => getChartFieldsConfig({}),
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

  const saveStandard = useMutation({
    mutationFn: (dto: ChartFieldsConfig) => updateChartFieldsConfig(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configurations', 'chart-fields'] });
      setSavedAt(new Date());
    },
    onError: (e) => setError((e as unknown as ApiErrorShape).message),
  });

  const deleteCustom = useMutation({
    mutationFn: (id: number) => deleteCustomChartField(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configurations', 'chart-fields'] });
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
                        <input
                          type="radio"
                          name={`chart-field-${f.key}`}
                          checked={current === v}
                          disabled={!canEdit}
                          onChange={() => setStandardState((s) => ({ ...s, [f.key]: v }))}
                          className="accent-primary w-4 h-4"
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
          onClose={() => {
            setCustomModalOpen(false);
            setEditingField(null);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['configurations', 'chart-fields'] });
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
  onClose,
  onSaved,
}: {
  field: CustomChartField | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, watch } = useForm<CreateCustomChartFieldDto>({
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

  const m = useMutation({
    mutationFn: (d: CreateCustomChartFieldDto) =>
      field ? updateCustomChartField(field.id, d) : createCustomChartField(d),
    onSuccess: () => onSaved(),
    onError: (e) => setError((e as unknown as ApiErrorShape).message),
  });

  return (
    <Modal open onClose={onClose} title={field ? 'Edit custom field' : 'Add custom field'} size="md">
      <form
        onSubmit={handleSubmit((d) => {
          // Convert comma-separated options string back to array when applicable
          const options =
            d.type === 'dropdown'
              ? typeof (d as unknown as { options: string | string[] }).options === 'string'
                ? ((d as unknown as { options: string }).options as string)
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean)
                : d.options
              : undefined;
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
            <Select {...register('type', { required: true })}>
              <option value="text">Text</option>
              <option value="dropdown">Dropdown</option>
              <option value="date">Date</option>
              <option value="number">Number</option>
              <option value="multiline">Multiline</option>
            </Select>
          </div>
          <div>
            <Label required>Validation</Label>
            <Select {...register('validation', { required: true })}>
              <option value="NON_MANDATORY">Non-Mandatory</option>
              <option value="MANDATORY">Mandatory</option>
              <option value="NOT_APPLICABLE">Not-Applicable</option>
            </Select>
          </div>
        </div>

        {type === 'dropdown' && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...register('isMultiSelect')} className="accent-primary" />
              Allow multiple selections
            </label>
            <div>
              <Label>Options (comma separated)</Label>
              <Input
                placeholder="e.g. Smoker, Non Smoker, Quit Smoking"
                defaultValue={field?.options?.join(', ') ?? ''}
                {...register('options' as 'options')}
              />
            </div>
          </>
        )}

        <div>
          <Label>Placement</Label>
          <Select {...register('placement')}>
            <option value="Chart Info">Chart Info</option>
            <option value="Processing Info">Processing Info</option>
            <option value="Audit Info">Audit Info</option>
          </Select>
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
  const { register, handleSubmit, watch } = useForm<Omit<HccFieldDef, 'id'>>({
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
          const options: string[] =
            d.type === 'dropdown'
              ? typeof (d as unknown as { options: string | string[] }).options === 'string'
                ? ((d as unknown as { options: string }).options as string)
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean)
                : (d.options ?? [])
              : [];
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
            <Select {...register('type', { required: true })}>
              <option value="text">Text</option>
              <option value="dropdown">Dropdown</option>
              <option value="date">Date</option>
              <option value="number">Number</option>
              <option value="multiline">Multiline</option>
            </Select>
          </div>
          <div>
            <Label required>Validation</Label>
            <Select {...register('validation', { required: true })}>
              <option value="NON_MANDATORY">Non-Mandatory</option>
              <option value="MANDATORY">Mandatory</option>
              <option value="NOT_APPLICABLE">Not-Applicable</option>
            </Select>
          </div>
        </div>

        {type === 'dropdown' && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...register('isMultiSelect')} className="accent-primary" />
              Allow multiple selections
            </label>
            <div>
              <Label>Options (comma separated)</Label>
              <Input
                placeholder="e.g. Smoker, Non Smoker, Quit Smoking"
                defaultValue={field?.options?.join(', ') ?? ''}
                {...register('options' as 'options')}
              />
            </div>
          </>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register('preserveNext')} className="accent-primary" />
          <span>
            <strong>Preserve next</strong> — keep this value when the user clicks "Save &amp; Next"
          </span>
        </label>

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

function ActiveToggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-xs cursor-pointer shrink-0">
      <input
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-primary w-4 h-4"
      />
      <span className={cn('font-semibold', value ? 'text-success' : 'text-ink-muted')}>
        {value ? 'Active' : 'Inactive'}
      </span>
    </label>
  );
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