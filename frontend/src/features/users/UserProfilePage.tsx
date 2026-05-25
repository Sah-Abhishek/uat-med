import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  getUser,
  getAttendance,
  markAttendance,
  activateUser,
  updateUser,
  resetUserPassword,
  type UpdateUserDto,
} from '@/api/users';
import {
  listClients,
  listLocations,
  listPrimarySpecialities,
} from '@/api/configurations';
import type { ApiErrorShape, AttendanceStatus, User } from '@/api/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Field';
import { Avatar, ConfirmModal, Modal, ModalFooter, Tabs } from '@/components/ui/Primitives';
import { useAuth } from '@/auth/store';
import { can } from '@/permissions';
import { cn, formatDate } from '@/lib/utils';
import { ArrowLeft, UserX, UserCheck, Loader2, Pencil, KeyRound, Eye, EyeOff, RefreshCw, Copy, Check } from 'lucide-react';

export function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const viewer = useAuth((s) => s.user)!;
  const canAdmin = can(viewer, 'user.deactivate');

  const [tab, setTab] = useState<'details' | 'attendance'>('details');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [resetPwOpen, setResetPwOpen] = useState(false);

  const { data: user, isPending } = useQuery({
    queryKey: ['user', id],
    queryFn: () => getUser(id!),
    enabled: !!id,
  });

  const attendance = useQuery({
    queryKey: ['user', id, 'attendance', month],
    queryFn: () => getAttendance(id!, month),
    enabled: !!id && tab === 'attendance',
  });

  if (isPending) {
    return (
      <div className="p-8 flex items-center gap-2 text-ink-muted">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading user…
      </div>
    );
  }
  if (!user) return <div className="p-8 text-ink-muted">User not found.</div>;

  return (
    <div className="p-8 max-w-[1100px] space-y-5">
      <Link to="/users" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink transition">
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to users
      </Link>

      <PageHeader title={user.fullName} subtitle="User profile" />

      <Card padding="default">
        <div className="flex items-start gap-5">
          <Avatar name={user.fullName} size="lg" />
          <div className="flex-1">
            <h3 className="text-lg font-bold text-ink">{user.fullName}</h3>
            <p className="text-sm text-ink-muted">{user.email}</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-primary-ink bg-primary-soft px-2 py-0.5 rounded-pill">
                {user.role}
              </span>
              <span className={cn(
                'text-[11px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-pill',
                user.status === 'ACTIVE' && 'bg-success-soft text-success',
                user.status === 'INACTIVE' && 'bg-danger-soft text-danger',
                user.status === 'PENDING' && 'bg-warn-soft text-warn',
              )}>
                {user.status}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(canAdmin || user.id === viewer.id) && (
              <Button
                variant="soft"
                leftIcon={<Pencil className="w-3.5 h-3.5" />}
                onClick={() => setEditOpen(true)}
              >
                Edit details
              </Button>
            )}
            {canAdmin && (
              <Button
                variant="soft"
                leftIcon={<KeyRound className="w-3.5 h-3.5" />}
                onClick={() => setResetPwOpen(true)}
              >
                Reset password
              </Button>
            )}
            {canAdmin && user.status === 'ACTIVE' && (
              <Button variant="soft-danger" leftIcon={<UserX className="w-3.5 h-3.5" />} onClick={() => setConfirmOpen(true)}>
                Deactivate
              </Button>
            )}
            {canAdmin && user.status === 'INACTIVE' && <ActivateAction userId={user.id} />}
          </div>
        </div>
      </Card>

      <Card padding="none">
        <div className="px-6 pt-5">
          <Tabs
            tabs={[
              { key: 'details', label: 'Details' },
              { key: 'attendance', label: 'Attendance' },
            ]}
            value={tab}
            onChange={(k) => setTab(k as 'details' | 'attendance')}
          />
        </div>

        {tab === 'details' ? (
          <div className="p-6 grid grid-cols-2 gap-5">
            <InfoRow label="Email" value={user.email} />
            <InfoRow label="Employee ID" value={user.employeeId ?? '—'} />
            <InfoRow label="Designation" value={user.designation ?? '—'} />
            <InfoRow label="Role" value={user.role} />
            <InfoRow label="Date of birth" value={formatDate(user.dateOfBirth)} />
            <InfoRow label="Date of joining" value={formatDate(user.dateOfJoining)} />
            {/* Names come from the relations the backend joins on /users/:id;
                fall back to a "#id" hint when the relation row was deleted. */}
            <InfoRow label="Client" value={refLabel(user.client, user.clientId)} />
            <InfoRow label="Location" value={refLabel(user.location, user.locationId)} />
            <InfoRow label="Primary speciality" value={refLabel(user.primarySpeciality, user.primarySpecialityId)} />
            <InfoRow label="Last login" value={formatDate(user.lastLoginAt)} />
            <InfoRow label="Account created" value={formatDate(user.createdAt)} />
          </div>
        ) : (
          <div className="p-6">
            <div className="flex items-center justify-between mb-5">
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="input w-auto"
              />
              {attendance.data && (
                <div className="flex gap-4 text-xs">
                  <Stat label="Present" value={attendance.data.presentDays} tone="success" />
                  <Stat label="Absent" value={attendance.data.absentDays} tone="danger" />
                  <Stat label="Leave" value={attendance.data.leaveDays} tone="info" />
                </div>
              )}
            </div>
            <AttendanceCalendar month={month} days={attendance.data?.days ?? []} userId={user.id} viewerCanMark={canAdmin || user.id === viewer.id} />
          </div>
        )}
      </Card>

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => setConfirmOpen(false)}
        message={`Deactivate ${user.fullName}? This revokes all active sessions.`}
        confirmLabel="Deactivate"
      />

      <EditUserModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        user={user}
        canEditAdminFields={canAdmin}
      />

      <ResetPasswordModal
        open={resetPwOpen}
        onClose={() => setResetPwOpen(false)}
        userId={user.id}
        userName={user.fullName}
      />
    </div>
  );
}

/* ── Reset password modal — admin sets a new password and the backend
 *    revokes any active sessions for the user. ────────────────────── */
function ResetPasswordModal({
  open,
  onClose,
  userId,
  userName,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
}) {
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [doneRevoked, setDoneRevoked] = useState<number | null>(null);

  // Reset every time the modal opens — never re-show a previous password.
  useEffect(() => {
    if (open) {
      setPw('');
      setShow(false);
      setCopied(false);
      setErr(null);
      setDoneRevoked(null);
    }
  }, [open]);

  const m = useMutation({
    mutationFn: () => resetUserPassword(userId, pw),
    onSuccess: (res) => {
      setDoneRevoked(res.revoked ?? 0);
      // Reveal the password automatically once the reset succeeds so the
      // admin can copy it without an extra toggle.
      setShow(true);
    },
    onError: (e) => setErr((e as unknown as ApiErrorShape).message ?? 'Reset failed.'),
  });

  function copyPw() {
    if (!pw) return;
    navigator.clipboard?.writeText(pw).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const tooShort = pw.length > 0 && pw.length < 12;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reset password"
      subtitle={userName}
      size="sm"
    >
      <div className="space-y-4">
        {err && (
          <div className="text-xs px-3 py-2 rounded-lg bg-danger-soft text-danger border border-danger/30">
            {err}
          </div>
        )}

        <div>
          <Label required>New password</Label>
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <input
                type={show ? 'text' : 'password'}
                value={pw}
                onChange={(e) => {
                  setPw(e.target.value);
                  setDoneRevoked(null);
                }}
                placeholder="Min 12 chars"
                className="input pr-10 font-mono text-xs"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                tabIndex={-1}
                aria-label={show ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
              >
                {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <Button
              type="button"
              variant="soft"
              size="sm"
              leftIcon={<RefreshCw className="w-3 h-3" />}
              onClick={() => {
                setPw(generatePassword());
                setShow(true);
                setDoneRevoked(null);
              }}
              title="Generate a password that meets the requirements"
            >
              Generate
            </Button>
          </div>
          {tooShort && (
            <p className="mt-1 text-[11px] text-danger">Password must be at least 12 characters.</p>
          )}
        </div>

        {doneRevoked != null ? (
          <div className="rounded-lg bg-success-soft text-success px-3 py-2.5 text-xs flex items-start gap-2">
            <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">Password updated.</p>
              <p className="opacity-80">
                {doneRevoked === 0
                  ? 'No active sessions were revoked.'
                  : `Revoked ${doneRevoked} active session${doneRevoked === 1 ? '' : 's'}.`}
                {' '}Share the new password with the user securely.
              </p>
            </div>
            <button
              type="button"
              onClick={copyPw}
              className="text-success hover:underline inline-flex items-center gap-1"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-ink-muted">
            Resetting will sign the user out of all active sessions and force them onto the new password.
          </p>
        )}

        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>
            {doneRevoked != null ? 'Close' : 'Cancel'}
          </Button>
          {doneRevoked == null && (
            <Button
              disabled={pw.length < 12}
              loading={m.isPending}
              onClick={() => {
                setErr(null);
                m.mutate();
              }}
            >
              Reset password
            </Button>
          )}
        </ModalFooter>
      </div>
    </Modal>
  );
}

/** Generate a 16-char password with at least one upper/lower/digit/symbol. */
function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*';
  const all = upper + lower + digits + symbols;
  const parts = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];
  for (let i = 0; i < 12; i++) parts.push(all[Math.floor(Math.random() * all.length)]);
  return parts.sort(() => Math.random() - 0.5).join('');
}

/* ── Edit User modal — admins can fill in any blank profile field ───── */
function EditUserModal({
  open,
  onClose,
  user,
  canEditAdminFields,
}: {
  open: boolean;
  onClose: () => void;
  user: User;
  canEditAdminFields: boolean;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // Seed the form from the loaded user. Re-runs whenever the modal opens or
  // the user payload refetches so we don't show stale draft values.
  const { register, handleSubmit, reset, watch } = useForm<UpdateUserDto>({
    defaultValues: toDefaults(user),
  });
  useEffect(() => {
    if (open) reset(toDefaults(user));
  }, [open, user, reset]);

  // Lookups for the role/client/location/speciality dropdowns.
  const clientsQuery = useQuery({
    queryKey: ['configurations', 'clients'],
    queryFn: () => listClients(),
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
    mutationFn: (dto: UpdateUserDto) => updateUser(user.id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user', user.id] });
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (e) => setError((e as unknown as ApiErrorShape).message ?? 'Update failed.'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Edit details" subtitle={user.fullName} size="lg">
      <form
        onSubmit={handleSubmit((d) => {
          setError(null);
          mutation.mutate({
            // Coerce empty strings to undefined so the optional fields are
            // genuinely omitted rather than failing IsDateString / Length.
            fullName: d.fullName?.trim() || undefined,
            employeeId: d.employeeId?.trim() || undefined,
            designation: d.designation?.trim() || undefined,
            dateOfBirth: d.dateOfBirth || undefined,
            dateOfJoining: d.dateOfJoining || undefined,
            clientId: d.clientId ? Number(d.clientId) : undefined,
            locationId: d.locationId ? Number(d.locationId) : undefined,
            primarySpecialityId: d.primarySpecialityId ? Number(d.primarySpecialityId) : undefined,
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
            <Label>Full name</Label>
            <Input {...register('fullName')} />
          </div>
          <div>
            <Label>Employee ID</Label>
            <Input placeholder="e.g. EMP-1024" {...register('employeeId')} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Designation</Label>
            <Input placeholder="e.g. Senior Coder" {...register('designation')} />
          </div>
          <div>
            <Label>Date of birth</Label>
            <Input type="date" {...register('dateOfBirth')} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Date of joining</Label>
            <Input type="date" {...register('dateOfJoining')} />
          </div>
        </div>

        {canEditAdminFields && (
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Client</Label>
              <Select {...register('clientId', { valueAsNumber: true })}>
                <option value="">{clientsQuery.isPending ? 'Loading…' : 'None'}</option>
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
                  {!selectedClientId ? 'Pick client first' : locationsQuery.isPending ? 'Loading…' : 'None'}
                </option>
                {locationsQuery.data?.items.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Primary speciality</Label>
              <Select {...register('primarySpecialityId', { valueAsNumber: true })}>
                <option value="">{specialitiesQuery.isPending ? 'Loading…' : 'None'}</option>
                {specialitiesQuery.data?.items.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </div>
          </div>
        )}

        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={mutation.isPending}>Save changes</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/** Build the react-hook-form defaultValues from a loaded User payload. */
function toDefaults(user: User): UpdateUserDto {
  return {
    fullName: user.fullName ?? '',
    employeeId: user.employeeId ?? '',
    designation: user.designation ?? '',
    dateOfBirth: user.dateOfBirth ?? '',
    dateOfJoining: user.dateOfJoining ?? '',
    clientId: user.clientId ?? undefined,
    locationId: user.locationId ?? undefined,
    primarySpecialityId: user.primarySpecialityId ?? undefined,
  };
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.08em] text-ink-muted font-semibold mb-1">{label}</p>
      <p className="text-sm text-ink">{value}</p>
    </div>
  );
}

/**
 * Render a lookup field. Prefers the joined name; falls back to "#id" so a
 * deleted-but-still-FK'd row is still recognisable; otherwise an em-dash.
 */
function refLabel(
  ref: { id: number; name: string } | null | undefined,
  id: number | null | undefined,
): string {
  if (ref?.name) return ref.name;
  if (id != null) return `#${id} (not found)`;
  return '—';
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'success' | 'danger' | 'info' }) {
  const colors = {
    success: 'text-success',
    danger: 'text-danger',
    info: 'text-info',
  };
  return (
    <div className="text-center">
      <p className={cn('text-xl font-bold', colors[tone])}>{value}</p>
      <p className="text-[10px] text-ink-muted">{label}</p>
    </div>
  );
}

function ActivateAction({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => activateUser(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user', userId] }),
  });
  return (
    <Button variant="soft" leftIcon={<UserCheck className="w-3.5 h-3.5" />} loading={m.isPending} onClick={() => m.mutate()}>
      Activate
    </Button>
  );
}

/* ── Simple month-grid calendar ───────────────────────── */
function AttendanceCalendar({
  month,
  days,
  userId,
  viewerCanMark,
}: {
  month: string;
  days: Array<{ date: string; status: AttendanceStatus }>;
  userId: string;
  viewerCanMark: boolean;
}) {
  const qc = useQueryClient();
  const [y, m] = month.split('-').map(Number);
  const firstDay = new Date(y!, m! - 1, 1);
  const startOffset = firstDay.getDay(); // 0 = Sun
  const daysInMonth = new Date(y!, m!, 0).getDate();
  const byDate = new Map(days.map((d) => [d.date, d.status]));
  const today = new Date().toISOString().slice(0, 10);

  const markMutation = useMutation({
    mutationFn: (dto: { date: string; status: AttendanceStatus }) => markAttendance(userId, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user', userId, 'attendance'] }),
  });

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-2 text-[10px] text-ink-muted font-semibold uppercase tracking-[0.1em] text-center">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: startOffset }).map((_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const date = `${month}-${String(day).padStart(2, '0')}`;
          const status = byDate.get(date);
          const isToday = date === today;
          const canMark = viewerCanMark && date === today;

          const bg = {
            PRESENT: 'bg-success-soft text-success',
            ABSENT: 'bg-danger-soft text-danger',
            LEAVE: 'bg-info-soft text-info',
          }[status ?? 'PRESENT'];

          return (
            <button
              key={day}
              disabled={!canMark}
              onClick={() => {
                if (canMark) {
                  const next: AttendanceStatus = status === 'PRESENT' ? 'ABSENT' : 'PRESENT';
                  markMutation.mutate({ date, status: next });
                }
              }}
              className={cn(
                'aspect-square rounded-lg text-xs font-semibold transition flex flex-col items-center justify-center',
                status ? bg : 'bg-surface-sunken text-ink-muted',
                isToday && 'ring-2 ring-primary',
                canMark && 'hover:brightness-95 cursor-pointer',
                !canMark && 'cursor-default',
              )}
            >
              <span>{day}</span>
              {status && <span className="text-[8px] opacity-70 uppercase">{status.slice(0, 1)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
