import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Primitives';
import type { Chart } from '@/api/types';

export function UsersPanel({ chart }: { chart: Chart }) {
  const items = [
    {
      role: 'Coder',
      id: chart.allocatedCoderId,
      // Prefer the resolved full name (from the detail endpoint); fall back to
      // the id only if the name didn't come through.
      label:
        chart.allocatedCoderName ??
        (chart.allocatedCoderId ? `User ${chart.allocatedCoderId}` : 'Unassigned'),
      avatarUrl: chart.allocatedCoderAvatarUrl ?? undefined,
    },
    {
      role: 'Auditor',
      id: chart.allocatedAuditorId,
      label:
        chart.allocatedAuditorName ??
        (chart.allocatedAuditorId ? `User ${chart.allocatedAuditorId}` : 'Unassigned'),
      avatarUrl: chart.allocatedAuditorAvatarUrl ?? undefined,
    },
  ];

  return (
    <Card padding="default">
      <p className="text-[11px] uppercase tracking-[0.1em] text-ink-muted font-semibold mb-3">
        Users
      </p>
      <div className="space-y-3">
        {items.map((u) => (
          <div key={u.role} className="flex items-center gap-2.5">
            {u.id ? (
              <Avatar name={u.label} src={u.avatarUrl} size="md" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-surface-sunken" />
            )}
            <div className="min-w-0">
              <p className="text-[11px] text-ink-subtle uppercase tracking-[0.08em] font-semibold">
                {u.role}
              </p>
              <p className="text-sm text-ink font-semibold truncate">{u.label}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
