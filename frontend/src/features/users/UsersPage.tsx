import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import {
  listUsers,
  getUserStats,
  createUser,
  deactivateUser,
  activateUser,
  listSignupRequests,
  approveSignupRequest,
  declineSignupRequest,
  type CreateUserDto,
  type UserListParams,
} from '@/api/users';
import {
  listClients,
  listLocations,
  listPrimarySpecialities,
} from '@/api/configurations';
import type { ApiErrorShape, Role, User, UserStatus } from '@/api/types';
import { PageHeader, SectionLabel } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, SearchInput } from '@/components/ui/Field';
import {
  Modal,
  ModalFooter,
  Pagination,
  Tabs,
  Avatar,
  ConfirmModal,
} from '@/components/ui/Primitives';
import { IllustrationStatCard } from '@/components/ui/StatCards';
import { useAuth } from '@/auth/store';
import { can } from '@/permissions';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import {
  Plus,
  Loader2,
  UserPlus,
  UserCheck,
  X,
  Filter as FilterIcon,
  User as UserIcon,
  Users as UsersIcon,
  Contact,
  Eye,
  EyeOff,
  RefreshCw,
} from 'lucide-react';

const ROLES: Role[] = ['TEAMLEAD', 'MANAGER', 'AUDITOR', 'CODER'];

/** Expanded filter state — superset of UserListParams with a few client-side fields. */
interface UserFilters extends UserListParams {
  employeeId?: string;
  dateOfBirth?: string;
  dateOfJoining?: string;
  primarySpecialityId?: number;
  clientId?: number;
  locationId?: number;
  designation?: string;
}

export function UsersPage() {
  const user = useAuth((s) => s.user)!;
  const canCreate = can(user, 'user.create');
  const canDeactivate = can(user, 'user.deactivate');

  const [tab, setTab] = useState<UserStatus>('ACTIVE');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<UserFilters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<{ id: string; name: string } | null>(null);
  const pageSize = 20;

  const stats = useQuery({ queryKey: ['users', 'stats'], queryFn: getUserStats });

  // Role-based counts for top tiles (pageSize:1 → we only read .total)
  const codersCount = useQuery({
    queryKey: ['users', 'count', 'CODER'],
    queryFn: () => listUsers({ role: 'CODER', status: 'ACTIVE', pageSize: 1 }),
    select: (res) => res.total,
  });
  const auditorsCount = useQuery({
    queryKey: ['users', 'count', 'AUDITOR'],
    queryFn: () => listUsers({ role: 'AUDITOR', status: 'ACTIVE', pageSize: 1 }),
    select: (res) => res.total,
  });
  const managersCount = useQuery({
    queryKey: ['users', 'count', 'MANAGER'],
    queryFn: () => listUsers({ role: 'MANAGER', status: 'ACTIVE', pageSize: 1 }),
    select: (res) => res.total,
  });

  // ── Lookups: resolve IDs to names in the table ────────────
  // Loaded once at page mount; cached by react-query so switching tabs doesn't refetch.
  const clientsLookup = useQuery({
    queryKey: ['configurations', 'clients'],
    queryFn: listClients,
    staleTime: 60_000,
  });
  const specialitiesLookup = useQuery({
    queryKey: ['configurations', 'primary-specialities', 'all'],
    queryFn: () => listPrimarySpecialities(),
    staleTime: 60_000,
  });

  const clientNameById = new Map<number, string>();
  clientsLookup.data?.items.forEach((c) => clientNameById.set(c.id, c.name));

  const specialityNameById = new Map<number, string>();
  specialitiesLookup.data?.items.forEach((s) => {
    specialityNameById.set(s.id, s.name);
  });

  const list = useQuery({
    queryKey: ['users', { tab, page, search, filters }],
    queryFn: () =>
      listUsers({
        status: tab,
        page,
        pageSize,
        ...(search ? { search } : {}),
        ...filters,
      }),
    enabled: tab !== 'PENDING',
    placeholderData: (prev) => prev,
  });

  const pending = useQuery({
    queryKey: ['users', 'signup-requests'],
    queryFn: listSignupRequests,
    // Always fetch so the Pending tab counter is accurate,
    // regardless of which tab is currently selected.
  });

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / pageSize)) : 1;

  // Placeholder until backend exposes a bulk "today's attendance" endpoint
  const attending = 0;
  const notAttending = stats.data?.active ?? 0;

  const activeFilterCount = Object.values(filters).filter((v) => v !== undefined && v !== '').length;

  return (
    <div className="p-8 max-w-[1600px] space-y-5">
      <PageHeader
        title="Users List"
        subtitle="Users List"
        actions={
          canCreate && (
            <Button onClick={() => setCreateOpen(true)} leftIcon={<Plus className="w-4 h-4" />}>
              Add User
            </Button>
          )
        }
      />

      {/* ── Status + Total Users tile row ───────────────── */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-7">
          <SectionLabel tone="primary">Status</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            <RoleCountTile
              count={codersCount.data ?? 0}
              loading={codersCount.isPending}
              label="Active Coders"
              icon={<UserIcon className="w-4 h-4" />}
              bg="bg-tile-sky"
              numberColor="text-info"
            />
            <RoleCountTile
              count={auditorsCount.data ?? 0}
              loading={auditorsCount.isPending}
              label="Active Auditors"
              icon={<UsersIcon className="w-4 h-4" />}
              bg="bg-tile-mint"
              numberColor="text-success"
            />
            <RoleCountTile
              count={managersCount.data ?? 0}
              loading={managersCount.isPending}
              label="Active Team Leaders"
              icon={<Contact className="w-4 h-4" />}
              bg="bg-tile-butter"
              numberColor="text-primary-ink"
            />
          </div>
        </div>

        <div className="col-span-12 lg:col-span-5">
          <SectionLabel tone="danger">Total Users</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <IllustrationStatCard
              variant="attending"
              value={attending}
              label="Attending"
              loading={stats.isPending}
            />
            <IllustrationStatCard
              variant="not-attending"
              value={notAttending}
              label="Not-Attending"
              loading={stats.isPending}
            />
          </div>
        </div>
      </div>

      <Card padding="none">
        <div className="px-6 pt-5 flex items-center justify-between">
          <Tabs
            tabs={[
              { key: 'ACTIVE', label: 'Active', count: stats.data?.active },
              { key: 'INACTIVE', label: 'Inactive', count: stats.data?.inactive },
              { key: 'PENDING', label: 'Pending', count: pending.data?.total ?? pending.data?.items.length },
            ]}
            value={tab}
            onChange={(k) => {
              setTab(k as UserStatus);
              setPage(1);
            }}
          />
          <Button
            variant="soft"
            leftIcon={<FilterIcon className="w-3.5 h-3.5" />}
            onClick={() => setFilterOpen(true)}
          >
            Filter{activeFilterCount > 0 && ` (${activeFilterCount})`}
          </Button>
        </div>

        <div className="px-6 py-4 border-b border-line">
          <div className="max-w-sm">
            <SearchInput
              placeholder="Search name or email…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>

        {tab === 'PENDING' ? (
          <PendingTable pending={pending.data} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px]">
                <thead>
                  <tr>
                    <th className="table-head">ID</th>
                    <th className="table-head">Name</th>
                    <th className="table-head">Role</th>
                    <th className="table-head">Primary Speciality</th>
                    <th className="table-head">Client</th>
                    <th className="table-head">Designation</th>
                    <th className="table-head">Status</th>
                    {canDeactivate && <th className="table-head text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {list.isPending ? (
                    <tr>
                      <td colSpan={8} className="py-16 text-center">
                        <Loader2 className="w-5 h-5 animate-spin inline text-ink-muted" />
                      </td>
                    </tr>
                  ) : list.data?.items.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-20 text-center text-sm text-ink-muted">
                        No {tab.toLowerCase()} users.
                      </td>
                    </tr>
                  ) : (
                    list.data?.items.map((u) => (
                      <UserRow
                        key={u.id}
                        u={u}
                        tab={tab}
                        canDeactivate={canDeactivate}
                        clientNameById={clientNameById}
                        specialityNameById={specialityNameById}
                        onDeactivate={() => setDeactivateTarget({ id: u.id, name: u.fullName })}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageCount={totalPages} onPageChange={setPage} />
          </>
        )}
      </Card>

      <FilterOptionsModal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        value={filters}
        onApply={(f) => {
          setFilters(f);
          setPage(1);
          setFilterOpen(false);
        }}
      />

      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} />

      {deactivateTarget && (
        <DeactivateModal
          target={deactivateTarget}
          onClose={() => setDeactivateTarget(null)}
        />
      )}
    </div>
  );
}

/* ── Filter Options modal ────────────────────────────── */
function FilterOptionsModal({
  open,
  onClose,
  value,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  value: UserFilters;
  onApply: (v: UserFilters) => void;
}) {
  const { register, handleSubmit, reset } = useForm<UserFilters>({ defaultValues: value });

  return (
    <Modal open={open} onClose={onClose} title="Filter Options" size="md">
      <form
        onSubmit={handleSubmit((d) => {
          // Strip empty values so we don't send empty strings to the API
          const cleaned: UserFilters = {};
          (Object.keys(d) as (keyof UserFilters)[]).forEach((k) => {
            const v = d[k];
            if (v !== '' && v !== undefined && v !== null && !Number.isNaN(v)) {
              (cleaned as Record<string, unknown>)[k] = v;
            }
          });
          onApply(cleaned);
        })}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>ID</Label>
            <Input placeholder="Employee ID" {...register('employeeId')} />
          </div>
          <div>
            <Label>Name</Label>
            <Input placeholder="Full name" {...register('search')} />
          </div>

          <div>
            <Label>Date of birth</Label>
            <Input type="date" {...register('dateOfBirth')} />
          </div>
          <div>
            <Label>Date of joining</Label>
            <Input type="date" {...register('dateOfJoining')} />
          </div>

          <div>
            <Label>Role</Label>
            <Select placeholder="Select..." {...register('role')}>
              <option value="">Select...</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Primary Speciality</Label>
            <Select placeholder="Select..." {...register('primarySpecialityId', { valueAsNumber: true })}>
              <option value="">Select...</option>
              {/* Seed options — replace with /configurations/specialities/general data when wired */}
              <option value={1}>ED</option>
              <option value={2}>IP</option>
              <option value={3}>OP</option>
            </Select>
          </div>

          <div>
            <Label>Client</Label>
            <Select placeholder="Select..." {...register('clientId', { valueAsNumber: true })}>
              <option value="">Select...</option>
              {/* Seed options — replace with /configurations/clients data when wired */}
              <option value={1}>Demo Client</option>
            </Select>
          </div>
          <div>
            <Label>Designation</Label>
            <Input placeholder="e.g. Sr. Coder" {...register('designation')} />
          </div>

          <div>
            <Label>Locations</Label>
            <Select placeholder="Select..." {...register('locationId', { valueAsNumber: true })}>
              <option value="">Select...</option>
              {/* Seed options — replace with /configurations/locations data when wired */}
              <option value={1}>Demo Facility</option>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select placeholder="Select..." {...register('status')}>
              <option value="">Select...</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="PENDING">Pending</option>
            </Select>
          </div>
        </div>

        <ModalFooter>
          <Button
            variant="soft"
            type="button"
            onClick={() => {
              reset({});
              onApply({});
            }}
          >
            Reset
          </Button>
          <Button type="submit">Apply</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/* ── Role count tile ─────────────────────────────────── */
function RoleCountTile({
  count,
  label,
  icon,
  bg,
  numberColor,
  loading,
}: {
  count: number;
  label: string;
  icon: React.ReactNode;
  bg: string;
  numberColor: string;
  loading?: boolean;
}) {
  return (
    <div className={cn('relative rounded-card p-5 min-h-[130px]', bg)}>
      <div className="absolute top-4 right-4 w-9 h-9 rounded-full bg-surface/60 flex items-center justify-center text-ink-muted">
        {icon}
      </div>
      {loading ? (
        // Skeleton: a pulsing bar that approximates the rendered number height
        // so the tile doesn't visually flash from "0" to the real count once
        // the query resolves.
        <div className="h-[40px] w-20 rounded-md bg-surface/60 animate-pulse" />
      ) : (
        <p className={cn('font-bold leading-none tracking-tightish text-[40px]', numberColor)}>
          {formatNumber(count)}
        </p>
      )}
      <p className={cn('mt-3 text-sm font-semibold', numberColor)}>{label}</p>
    </div>
  );
}

/* ── User row ────────────────────────────────────────── */
function UserRow({
  u,
  tab,
  canDeactivate,
  clientNameById,
  specialityNameById,
  onDeactivate,
}: {
  u: User;
  tab: UserStatus;
  canDeactivate: boolean;
  clientNameById: Map<number, string>;
  specialityNameById: Map<number, string>;
  onDeactivate: () => void;
}) {
  const isAttending = u.status === 'ACTIVE';
  const specialityLabel =
    u.primarySpecialityId != null
      ? specialityNameById.get(u.primarySpecialityId) ?? `#${u.primarySpecialityId}`
      : '—';
  const clientLabel =
    u.clientId != null
      ? clientNameById.get(u.clientId) ?? `#${u.clientId}`
      : '—';

  return (
    <tr className="hover:bg-surface-sunken/40 transition">
      <td className="table-cell font-mono text-xs text-ink-muted">
        {u.employeeId ?? u.id}
      </td>
      <td className="table-cell">
        <div className="flex items-center gap-3">
          <Avatar name={u.fullName} src={u.avatarUrl} size="md" />
          <div className="min-w-0">
            <Link to={`/users/${u.id}`} className="block font-semibold text-ink hover:text-primary transition truncate">
              {u.fullName}
            </Link>
            <p className="text-[11px] text-ink-muted truncate">{u.email}</p>
          </div>
        </div>
      </td>
      <td className="table-cell">
        <span className="text-ink capitalize">{u.role.toLowerCase()}</span>
      </td>
      <td className="table-cell text-ink-muted">{specialityLabel}</td>
      <td className="table-cell text-ink-muted">{clientLabel}</td>
      <td className="table-cell text-ink-muted">{u.designation ?? '—'}</td>
      <td className="table-cell">
        <span
          className={cn(
            'inline-flex items-center px-3 py-1 rounded-pill text-[11px] font-semibold',
            isAttending ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
          )}
        >
          {isAttending ? 'Attending' : 'Not-attending'}
        </span>
      </td>
      {canDeactivate && (
        <td className="table-cell text-right">
          {tab === 'ACTIVE' ? (
            <button onClick={onDeactivate} className="text-xs text-danger hover:underline">
              Deactivate
            </button>
          ) : tab === 'INACTIVE' ? (
            <ActivateButton userId={u.id} />
          ) : null}
        </td>
      )}
    </tr>
  );
}

/* ── Pending signup requests table ─────────────────────── */
function PendingTable({
  pending,
}: {
  pending: Awaited<ReturnType<typeof listSignupRequests>> | undefined;
}) {
  const [approvingId, setApprovingId] = useState<string | null>(null);

  if (!pending) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="w-5 h-5 animate-spin inline text-ink-muted" />
      </div>
    );
  }
  if (pending.items.length === 0) {
    return (
      <div className="py-20 text-center text-sm text-ink-muted">
        No pending signup requests.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr>
              <th className="table-head">Email</th>
              <th className="table-head">Requested</th>
              <th className="table-head text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pending.items.map((r) => (
              <tr key={r.id} className="hover:bg-surface-sunken/40 transition">
                <td className="table-cell">
                  <div className="flex items-center gap-3">
                    <Avatar name={r.email} size="sm" />
                    <span className="font-semibold text-ink">{r.email}</span>
                  </div>
                </td>
                <td className="table-cell text-ink-muted">{formatDate(r.requestedAt)}</td>
                <td className="table-cell text-right">
                  <div className="inline-flex gap-2">
                    <Button
                      size="sm"
                      variant="soft"
                      leftIcon={<UserPlus className="w-3 h-3" />}
                      onClick={() => setApprovingId(r.id)}
                    >
                      Approve
                    </Button>
                    <DeclineButton requestId={r.id} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {approvingId && (
        <ApproveModal
          requestId={approvingId}
          email={pending.items.find((r) => r.id === approvingId)?.email ?? ''}
          onClose={() => setApprovingId(null)}
        />
      )}
    </>
  );
}

/* ── Create User modal ────────────────────────────────── */
function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<CreateUserDto>({
    defaultValues: { email: '', fullName: '', password: '', role: 'CODER' },
  });

  // Lookups for the three dropdowns
  const clientsQuery = useQuery({
    queryKey: ['configurations', 'clients'],
    queryFn: listClients,
    enabled: open,
  });
  const selectedClientId = watch('clientId');
  const specialitiesQuery = useQuery({
    queryKey: ['configurations', 'primary-specialities', selectedClientId ?? 'all'],
    queryFn: () => listPrimarySpecialities(selectedClientId ? Number(selectedClientId) : undefined),
    enabled: open,
  });

  const locationsQuery = useQuery({
    queryKey: ['configurations', 'locations', selectedClientId],
    queryFn: () => listLocations(Number(selectedClientId)),
    enabled: open && !!selectedClientId,
  });

  const mutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      reset();
      onClose();
    },
    onError: (err) => setError((err as unknown as ApiErrorShape).message),
  });

  return (
    <Modal open={open} onClose={onClose} title="Add User" size="lg">
      <form
        onSubmit={handleSubmit((d) => {
          setError(null);
          // Empty <input> values come back as '' from react-hook-form, which
          // fails the backend IsDateString / Length validators — coerce blanks
          // to undefined so the optional DTO fields stay truly optional.
          mutation.mutate({
            ...d,
            clientId: d.clientId ? Number(d.clientId) : undefined,
            locationId: d.locationId ? Number(d.locationId) : undefined,
            primarySpecialityId: d.primarySpecialityId ? Number(d.primarySpecialityId) : undefined,
            employeeId: d.employeeId?.trim() || undefined,
            designation: d.designation?.trim() || undefined,
            dateOfBirth: d.dateOfBirth || undefined,
            dateOfJoining: d.dateOfJoining || undefined,
          });
        })}
        className="space-y-4"
      >
        {error && (
          <div className="text-xs px-3 py-2 rounded-lg bg-danger-soft text-danger border border-danger/30">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label required>Full name</Label>
            <Input error={errors.fullName?.message} {...register('fullName', { required: 'Required' })} />
          </div>
          <div>
            <Label required>Email</Label>
            <Input type="email" error={errors.email?.message} {...register('email', { required: 'Required' })} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label required>Password</Label>
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Min 12 chars"
                  className="input pr-10 font-mono text-xs"
                  {...register('password', {
                    required: 'Required',
                    minLength: { value: 12, message: 'Min 12 chars' },
                  })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <Button
                type="button"
                variant="soft"
                size="sm"
                leftIcon={<RefreshCw className="w-3 h-3" />}
                onClick={() => {
                  setValue('password', generatePassword(), { shouldValidate: true, shouldDirty: true });
                  // Reveal the freshly-generated password so the admin can copy it
                  // without toggling — they need to share it with the user.
                  setShowPassword(true);
                }}
                title="Generate a password that meets the requirements"
              >
                Generate
              </Button>
            </div>
            {errors.password?.message && (
              <p className="mt-1 text-[11px] text-danger">{errors.password.message}</p>
            )}
          </div>
          <div>
            <Label required>Role</Label>
            <Select {...register('role', { required: true })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Employee ID</Label>
            <Input placeholder="e.g. EMP-1024" {...register('employeeId')} />
          </div>
          <div>
            <Label>Designation</Label>
            <Input placeholder="e.g. Senior Coder" {...register('designation')} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Date of birth</Label>
            <Input type="date" {...register('dateOfBirth')} />
          </div>
          <div>
            <Label>Date of joining</Label>
            <Input type="date" {...register('dateOfJoining')} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label>Client</Label>
            <Select {...register('clientId', { valueAsNumber: true })}>
              <option value="">
                {clientsQuery.isPending ? 'Loading…' : 'Select…'}
              </option>
              {clientsQuery.data?.items.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Location</Label>
            <Select
              {...register('locationId', { valueAsNumber: true })}
              disabled={!selectedClientId}
            >
              <option value="">
                {!selectedClientId
                  ? 'Pick client first'
                  : locationsQuery.isPending
                    ? 'Loading…'
                    : 'Select…'}
              </option>
              {locationsQuery.data?.items.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Primary Speciality</Label>
            <Select {...register('primarySpecialityId', { valueAsNumber: true })}>
              <option value="">
                {specialitiesQuery.isPending ? 'Loading…' : 'Select…'}
              </option>
              {specialitiesQuery.data?.items.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Date of birth</Label>
            <Input type="date" {...register('dateOfBirth')} />
          </div>
          <div>
            <Label>Date of joining</Label>
            <Input type="date" {...register('dateOfJoining')} />
          </div>
        </div>

        <ModalFooter>
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending}>Create user</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/* ── Approve signup modal ─────────────────────────────── */
function ApproveModal({
  requestId,
  email,
  onClose,
}: {
  requestId: string;
  email: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [ssoOnly, setSsoOnly] = useState(true);

  // Lookups — Configurations APIs. Populate dropdowns with real data.
  const clientsQuery = useQuery({
    queryKey: ['configurations', 'clients'],
    queryFn: listClients,
  });
  const { register, handleSubmit, watch, setValue } = useForm<CreateUserDto>({
    defaultValues: {
      email,
      fullName: nameFromEmail(email),
      password: generatePassword(),
      role: 'CODER',
    },
  });

  const selectedClientId = watch('clientId');
  const specialitiesQuery = useQuery({
    queryKey: ['configurations', 'primary-specialities', selectedClientId ?? 'all'],
    queryFn: () => listPrimarySpecialities(selectedClientId ? Number(selectedClientId) : undefined),
  });
  const locationsQuery = useQuery({
    queryKey: ['configurations', 'locations', selectedClientId],
    queryFn: () => listLocations(Number(selectedClientId)),
    enabled: !!selectedClientId,
  });

  const mutation = useMutation({
    mutationFn: (dto: CreateUserDto) => approveSignupRequest(requestId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (err) => setError((err as unknown as ApiErrorShape).message),
  });

  return (
    <Modal open onClose={onClose} title="Approve signup request" subtitle={email} size="md">
      <form
        onSubmit={handleSubmit((d) =>
          mutation.mutate({
            ...d,
            clientId: d.clientId ? Number(d.clientId) : undefined,
            locationId: d.locationId ? Number(d.locationId) : undefined,
            primarySpecialityId: d.primarySpecialityId ? Number(d.primarySpecialityId) : undefined,
          }),
        )}
        className="space-y-4"
      >
        {error && (
          <div className="text-xs px-3 py-2 rounded-lg bg-danger-soft text-danger">{error}</div>
        )}

        <div>
          <Label required>Full name</Label>
          <Input {...register('fullName', { required: true })} />
          <p className="text-[11px] text-ink-muted mt-1">Pre-filled from email — edit if needed.</p>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label required>Initial password</Label>
            <label className="flex items-center gap-1.5 text-[11px] text-ink-muted cursor-pointer">
              <input
                type="checkbox"
                checked={ssoOnly}
                onChange={(e) => setSsoOnly(e.target.checked)}
                className="accent-primary"
              />
              SSO only — user will sign in with Microsoft
            </label>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <input
                type={showPassword ? 'text' : 'password'}
                className="input pr-10 font-mono text-xs"
                {...register('password', { required: true, minLength: 12 })}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setValue('password', generatePassword())}
              className="btn-soft btn-sm"
              title="Regenerate"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
          <p className="text-[11px] text-ink-muted mt-1">
            {ssoOnly
              ? 'This password is a placeholder — user will never see it. They sign in via Microsoft SSO.'
              : 'Share this with the user securely. They should change it on first login.'}
          </p>
        </div>

        <div>
          <Label required>Role</Label>
          <Select {...register('role', { required: true })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Client</Label>
            <Select {...register('clientId', { valueAsNumber: true })}>
              <option value="">
                {clientsQuery.isPending
                  ? 'Loading…'
                  : clientsQuery.data?.items.length === 0
                    ? 'No clients — add in Configurations'
                    : 'Select…'}
              </option>
              {clientsQuery.data?.items.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Location</Label>
            <Select
              {...register('locationId', { valueAsNumber: true })}
              disabled={!selectedClientId}
            >
              <option value="">
                {!selectedClientId ? 'Pick client first' : locationsQuery.isPending ? 'Loading…' : 'Select…'}
              </option>
              {locationsQuery.data?.items.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Primary Speciality</Label>
            <Select {...register('primarySpecialityId', { valueAsNumber: true })}>
              <option value="">
                {specialitiesQuery.isPending ? 'Loading…' : 'Select…'}
              </option>
              {specialitiesQuery.data?.items.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </div>
        </div>

        <ModalFooter>
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending}>Approve &amp; create</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/** Generate a secure 16-char password with upper/lower/digit/symbol mix. */
function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*';
  const all = upper + lower + digits + symbols;
  // Guarantee one of each, then fill to 16
  const parts = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];
  for (let i = 0; i < 12; i++) {
    parts.push(all[Math.floor(Math.random() * all.length)]);
  }
  // Shuffle
  return parts.sort(() => Math.random() - 0.5).join('');
}

/** "bheem.prakash@foo.com" → "Bheem Prakash" */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}


function DeclineButton({ requestId }: { requestId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => declineSignupRequest(requestId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users', 'signup-requests'] });
      setOpen(false);
    },
  });
  return (
    <>
      <Button size="sm" variant="soft-danger" leftIcon={<X className="w-3 h-3" />} onClick={() => setOpen(true)}>
        Decline
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Decline request" size="sm">
        <div className="space-y-3">
          <Label>Reason</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Not a valid work email" />
          <ModalFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={m.isPending} onClick={() => m.mutate()}>Decline</Button>
          </ModalFooter>
        </div>
      </Modal>
    </>
  );
}

function DeactivateModal({
  target,
  onClose,
}: {
  target: { id: string; name: string };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => deactivateUser(target.id, 'Admin action'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  return (
    <ConfirmModal
      open
      onClose={onClose}
      onConfirm={() => m.mutate()}
      message={`Deactivate ${target.name}? All active sessions will be revoked.`}
      variant="danger"
      confirmLabel="Deactivate"
      loading={m.isPending}
    />
  );
}

function ActivateButton({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => activateUser(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
  return (
    <button
      onClick={() => m.mutate()}
      disabled={m.isPending}
      className="text-xs text-success hover:underline inline-flex items-center gap-1"
    >
      <UserCheck className="w-3 h-3" />
      Activate
    </button>
  );
}