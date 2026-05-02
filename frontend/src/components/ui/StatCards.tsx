import { cn, formatNumber } from '@/lib/utils';
import type { ReactNode } from 'react';

type Tint = 'taupe' | 'indigo' | 'teal' | 'mint' | 'sky' | 'butter' | 'coral';

const TILE_BG: Record<Tint, string> = {
  taupe: 'bg-tile-taupe',
  indigo: 'bg-tile-indigo',
  teal: 'bg-tile-teal',
  mint: 'bg-tile-mint',
  sky: 'bg-tile-sky',
  butter: 'bg-tile-butter',
  coral: 'bg-tile-coral',
};

const TILE_NUMBER: Record<Tint, string> = {
  taupe: 'text-primary',
  indigo: 'text-indigo-500 dark:text-indigo-300',
  teal: 'text-teal-600 dark:text-teal-300',
  mint: 'text-success',
  sky: 'text-info',
  butter: 'text-primary-ink',
  coral: 'text-danger',
};

interface TintedProps {
  tint: Tint;
  value: number | string;
  label: string;
  sublabel?: string;
  icon?: ReactNode;
  className?: string;
  loading?: boolean;
}
/** Big color-tinted stat card — used for Milestones on Dashboard */
export function TintedStatCard({ tint, value, label, sublabel, icon, className, loading }: TintedProps) {
  return (
    <div className={cn('relative rounded-card p-5 min-h-[130px] overflow-hidden', TILE_BG[tint], className)}>
      {icon && (
        <div className="absolute top-4 right-4 text-ink opacity-60">
          {icon}
        </div>
      )}
      {loading ? (
        <div className="h-[40px] w-20 rounded bg-ink/10 animate-pulse" />
      ) : (
        <p
          className={cn(
            'font-bold leading-none tracking-tightish',
            'text-[40px]',
            TILE_NUMBER[tint],
          )}
        >
          {typeof value === 'number' ? formatNumber(value) : value}
        </p>
      )}
      <p className={cn('mt-3 text-sm font-semibold', TILE_NUMBER[tint])}>
        {label}
      </p>
      {sublabel && (
        <p className="text-[11px] text-ink-muted mt-0.5">{sublabel}</p>
      )}
    </div>
  );
}

/** Hand-drawn illustration stat card — two variants (complete/incomplete) */
interface IllProps {
  value: number;
  label: string;
  sublabel?: string;
  variant: 'complete' | 'incomplete' | 'open' | 'in-progress' | 'closed' | 'attending' | 'not-attending';
  className?: string;
  loading?: boolean;
}

export function IllustrationStatCard({ value, label, sublabel, variant, className, loading }: IllProps) {
  const numberColor = {
    complete: 'text-success',
    incomplete: 'text-danger',
    open: 'text-warn',
    'in-progress': 'text-info',
    closed: 'text-success',
    attending: 'text-success',
    'not-attending': 'text-danger',
  }[variant];

  return (
    <div className={cn('card p-5 flex items-start gap-4 min-h-[130px]', className)}>
      <div className="flex-1">
        <div className="flex items-baseline gap-2">
          {loading ? (
            <span className="h-[40px] w-20 rounded bg-ink/10 animate-pulse" />
          ) : (
            <span className={cn('text-[40px] font-bold leading-none tracking-tightish', numberColor)}>
              {formatNumber(value)}
            </span>
          )}
          <span className="text-sm font-semibold text-ink">{label}</span>
        </div>
        {sublabel && <p className="text-[11px] text-ink-muted mt-2">{sublabel}</p>}
      </div>
      <div className="shrink-0 w-20 h-20 text-ink-muted opacity-70">
        <IllustrationSvg variant={variant} />
      </div>
    </div>
  );
}

/** Coral pill stat — for Unallocated on Dashboard */
interface CoralProps {
  value: string;
  label: string;
  className?: string;
  loading?: boolean;
}
export function CoralPillStat({ value, label, className, loading }: CoralProps) {
  return (
    <div className={cn('rounded-card bg-tile-coral p-5 min-h-[90px] flex flex-col justify-center text-center', className)}>
      {loading ? (
        <div className="mx-auto h-6 w-24 rounded bg-ink/10 animate-pulse" />
      ) : (
        <p className="text-2xl font-bold text-danger">{value}</p>
      )}
      <p className="text-xs font-medium text-danger mt-1">{label}</p>
    </div>
  );
}

/* ── Hand-drawn SVG illustrations (simple line-art) ───────────────── */
function IllustrationSvg({ variant }: { variant: IllProps['variant'] }) {
  const common = { stroke: 'currentColor', strokeWidth: 1.3, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (variant) {
    case 'complete':
    case 'closed':
      return (
        <svg viewBox="0 0 80 80" className="w-full h-full">
          {/* Person holding clipboard */}
          <circle cx="40" cy="22" r="7" {...common} />
          <path d="M28 42 c 0 -6 5 -10 12 -10 s 12 4 12 10 v 15 h -24 z" {...common} />
          <rect x="45" y="36" width="16" height="20" rx="2" {...common} />
          <path d="M49 44 h 8 M49 48 h 8 M49 52 h 5" {...common} />
          <path d="M51 40 l 2 2 l 4 -4" stroke="#22C55E" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'incomplete':
      return (
        <svg viewBox="0 0 80 80" className="w-full h-full">
          {/* Person scratching head */}
          <circle cx="40" cy="22" r="7" {...common} />
          <path d="M34 18 q 3 -6 12 -2" {...common} />
          <path d="M28 42 c 0 -6 5 -10 12 -10 s 12 4 12 10 v 15 h -24 z" {...common} />
          <path d="M52 36 l 10 -6" {...common} />
          <path d="M58 28 q 2 -3 6 -1" {...common} />
          <path d="M50 62 l -4 8 M34 62 l 4 8" {...common} />
        </svg>
      );
    case 'open':
      return (
        <svg viewBox="0 0 80 80" className="w-full h-full">
          {/* Person with thought bubbles */}
          <circle cx="30" cy="28" r="6" {...common} />
          <path d="M20 48 c 0 -5 4 -9 10 -9 s 10 4 10 9 v 14 h -20 z" {...common} />
          <circle cx="55" cy="20" r="3" {...common} />
          <circle cx="62" cy="14" r="5" {...common} />
          <circle cx="50" cy="26" r="1.5" fill="currentColor" />
        </svg>
      );
    case 'in-progress':
      return (
        <svg viewBox="0 0 80 80" className="w-full h-full">
          {/* Person at desk, working */}
          <circle cx="30" cy="22" r="6" {...common} />
          <path d="M20 42 c 0 -5 4 -9 10 -9 s 10 4 10 9 v 12 h -20 z" {...common} />
          <rect x="42" y="44" width="22" height="14" rx="1" {...common} />
          <path d="M42 50 h 22" {...common} />
          <path d="M40 58 h 28" {...common} />
          <circle cx="56" cy="22" r="6" {...common} />
          <path d="M51 28 l -2 8 M61 28 l 2 8" {...common} />
        </svg>
      );
    case 'attending':
      return (
        <svg viewBox="0 0 80 80" className="w-full h-full">
          {/* Happy person with check */}
          <circle cx="40" cy="25" r="8" {...common} />
          <path d="M36 25 l 2 2 l 6 -4" stroke="#22C55E" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M26 48 c 0 -6 6 -10 14 -10 s 14 4 14 10 v 16 h -28 z" {...common} />
        </svg>
      );
    case 'not-attending':
    default:
      return (
        <svg viewBox="0 0 80 80" className="w-full h-full">
          {/* Person with question mark */}
          <circle cx="40" cy="25" r="8" {...common} />
          <path d="M26 48 c 0 -6 6 -10 14 -10 s 14 4 14 10 v 16 h -28 z" {...common} />
          <path d="M56 18 q 4 -6 8 -2 q 2 3 -2 6 v 3 M62 31 v 1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      );
  }
}
