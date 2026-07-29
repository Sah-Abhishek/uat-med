import { cn } from '@/lib/utils';

/** Full wordmark — used in sidebar. Swaps for light/dark theme automatically. */
export function ValerionLogo({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center', className)}>
      <img src="/valerion-logo-L.png" alt="Valerion Health" className="h-8 w-auto dark:hidden" />
      <img
        src="/valerion-logo-D.png"
        alt="Valerion Health"
        className="h-8 w-auto hidden dark:block"
      />
    </div>
  );
}
