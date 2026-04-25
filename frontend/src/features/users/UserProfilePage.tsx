import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getUser,
  getAttendance,
  markAttendance,
  activateUser,
} from '@/api/users';
import type { AttendanceStatus } from '@/api/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar, ConfirmModal, Tabs } from '@/components/ui/Primitives';
import { useAuth } from '@/auth/store';
import { can } from '@/permissions';
import { cn, formatDate } from '@/lib/utils';
import { ArrowLeft, UserX, UserCheck, Loader2 } from 'lucide-react';

export function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const viewer = useAuth((s) => s.user)!;
  const canAdmin = can(viewer, 'user.deactivate');

  const [tab, setTab] = useState<'details' | 'attendance'>('details');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [confirmOpen, setConfirmOpen] = useState(false);

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
          {canAdmin && user.status === 'ACTIVE' && (
            <Button variant="soft-danger" leftIcon={<UserX className="w-3.5 h-3.5" />} onClick={() => setConfirmOpen(true)}>
              Deactivate
            </Button>
          )}
          {canAdmin && user.status === 'INACTIVE' && <ActivateAction userId={user.id} />}
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
            <InfoRow label="Employee ID" value={user.employeeId ?? '—'} />
            <InfoRow label="Designation" value={user.designation ?? '—'} />
            <InfoRow label="Date of birth" value={formatDate(user.dateOfBirth)} />
            <InfoRow label="Date of joining" value={formatDate(user.dateOfJoining)} />
            <InfoRow label="Client ID" value={user.clientId ? `#${user.clientId}` : '—'} />
            <InfoRow label="Location ID" value={user.locationId ? `#${user.locationId}` : '—'} />
            <InfoRow label="Speciality ID" value={user.primarySpecialityId ? `#${user.primarySpecialityId}` : '—'} />
            <InfoRow label="Last login" value={formatDate(user.lastLoginAt)} />
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
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.08em] text-ink-muted font-semibold mb-1">{label}</p>
      <p className="text-sm text-ink">{value}</p>
    </div>
  );
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
