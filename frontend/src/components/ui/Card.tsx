import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Minus, Plus } from 'lucide-react';

interface CardProps {
  className?: string;
  children: ReactNode;
  padding?: 'none' | 'sm' | 'default' | 'lg';
}
export function Card({ className, children, padding = 'default' }: CardProps) {
  return (
    <div
      className={cn(
        'card',
        padding === 'sm' && 'p-4',
        padding === 'default' && 'p-6',
        padding === 'lg' && 'p-8',
        className,
      )}
    >
      {children}
    </div>
  );
}

interface CollapsibleProps {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}
export function CollapsibleCard({
  title,
  subtitle,
  defaultOpen = false,
  actions,
  children,
  className,
}: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn('card overflow-hidden', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-6 py-5 text-left hover:bg-surface-2/60 transition"
      >
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div onClick={(e) => e.stopPropagation()}>{actions}</div>}
        <span
          className={cn(
            'w-7 h-7 rounded-full bg-surface-sunken flex items-center justify-center text-ink-muted transition',
          )}
        >
          {open ? <Minus className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
        </span>
      </button>
      {open && (
        <div className="px-6 pb-6 pt-1 border-t border-line">{children}</div>
      )}
    </div>
  );
}
