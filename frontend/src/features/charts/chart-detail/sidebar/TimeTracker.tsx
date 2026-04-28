import { Clock } from 'lucide-react';
import { Card } from '@/components/ui/Card';

export function TimeTracker() {
  return (
    <Card padding="default">
      <div className="mb-3">
        <p className="text-[11px] uppercase tracking-[0.1em] text-ink-muted font-semibold">
          Time Tracker
        </p>
        <p className="text-[11px] text-ink-subtle">Overall processing time by user</p>
      </div>
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <Clock className="w-3.5 h-3.5 text-ink-subtle" />
        No time tracked yet
      </div>
    </Card>
  );
}
