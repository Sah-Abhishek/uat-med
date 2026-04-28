import { CollapsibleCard, Card } from '@/components/ui/Card';
import { SkeletonGrid, FieldSkeleton } from './shared';

/**
 * Full-page skeleton matching the loaded layout. Used while
 * `getChart(id)` is in flight so the user doesn't see a "Loading chart…"
 * message followed by a separate section-level skeleton — just one
 * continuous skeleton that fills in as data arrives.
 */
export function ChartDetailSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 items-start">
      {/* LEFT */}
      <div className="space-y-5 min-w-0">
        {/* Header card skeleton */}
        <div className="card p-6 grid grid-cols-[1fr_auto] gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-6 w-48 rounded bg-surface-sunken animate-pulse" />
              <div className="h-5 w-16 rounded-pill bg-surface-sunken animate-pulse" />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {Array.from({ length: 7 }, (_, i) => (
                <div key={i} className="h-3.5 w-32 rounded bg-surface-sunken animate-pulse" />
              ))}
            </div>
            <div className="grid grid-cols-4 gap-3 pt-3 border-t border-line">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i}>
                  <div className="h-4 w-20 rounded bg-surface-sunken animate-pulse mb-1" />
                  <div className="h-3 w-14 rounded bg-surface-sunken animate-pulse" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-3">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i}>
                  <div className="h-4 w-20 rounded bg-surface-sunken animate-pulse mb-1" />
                  <div className="h-3 w-14 rounded bg-surface-sunken animate-pulse" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-card border border-line bg-surface-sunken/40 p-5 min-w-[260px] space-y-3 animate-pulse">
            <div className="h-3 w-16 rounded bg-surface-sunken" />
            <div className="h-9 w-32 rounded bg-surface-sunken" />
            <div className="flex gap-2">
              <div className="h-8 flex-1 rounded-lg bg-surface-sunken" />
              <div className="h-8 flex-1 rounded-lg bg-surface-sunken" />
            </div>
          </div>
        </div>

        {/* Upload section — collapsed bar */}
        <div className="card px-6 py-5 flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-4 w-56 rounded bg-surface-sunken animate-pulse" />
            <div className="h-3 w-72 rounded bg-surface-sunken animate-pulse" />
          </div>
          <div className="w-7 h-7 rounded-full bg-surface-sunken animate-pulse" />
        </div>

        {/* Chart Info skeleton */}
        <CollapsibleCard title="Chart Info" subtitle="All relevant chart fields" defaultOpen>
          <div className="pt-3">
            <SkeletonGrid cols={3} count={3} />
            <SkeletonGrid cols={3} count={2} />
            <SkeletonGrid cols={3} count={3} />
            <SkeletonGrid cols={2} count={2} />
            <SkeletonGrid cols={3} count={3} />
            <SkeletonGrid cols={3} count={2} />
          </div>
        </CollapsibleCard>

        {/* Processing Info skeleton */}
        <CollapsibleCard
          title="Processing Info"
          subtitle="All fields related to processing this chart"
          defaultOpen
        >
          <div className="pt-3 space-y-4">
            <div className="grid grid-cols-[1fr_3fr] gap-4">
              <FieldSkeleton />
              <FieldSkeleton />
            </div>
            <FieldSkeleton />
            <FieldSkeleton />
            <FieldSkeleton />
            <FieldSkeleton />
            <SkeletonGrid cols={3} count={3} />
            <SkeletonGrid cols={3} count={3} />
          </div>
        </CollapsibleCard>
      </div>

      {/* RIGHT — sidebar */}
      <aside className="space-y-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} padding="default">
            <div className="h-3 w-20 rounded bg-surface-sunken animate-pulse mb-3" />
            <div className="space-y-2">
              <div className="h-4 w-full rounded bg-surface-sunken animate-pulse" />
              <div className="h-4 w-2/3 rounded bg-surface-sunken animate-pulse" />
            </div>
          </Card>
        ))}
      </aside>
    </div>
  );
}
