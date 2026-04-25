import { cn } from '@/lib/utils';

/** Full wordmark — used in sidebar and login */
export function ValerionLogo({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <ValerionMark className="w-10 h-10" />
      <div className="flex flex-col leading-none">
        <div className="flex items-baseline">
          <span className="text-xl font-extrabold text-ink tracking-tightish">V</span>
          <span className="text-xl font-extrabold text-primary tracking-tightish">alerion</span>
          <sup className="text-primary text-xs ml-0.5">++</sup>
        </div>
        <span className="text-[10px] text-ink-muted tracking-[0.3em] font-medium self-end">
          Health
        </span>
      </div>
    </div>
  );
}

/** Just the circular mark */
export function ValerionMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <circle cx="24" cy="24" r="22" fill="#FFC72C" />
      {/* Stacked V shape */}
      <path
        d="M12 14 L24 34 L36 14"
        stroke="#1E1A06"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M16 12 L24 26 L32 12"
        stroke="#1E1A06"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.4"
      />
    </svg>
  );
}
