import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}
export function PageHeader({ title, subtitle, actions, className }: Props) {
  return (
    <div className={cn('flex items-start justify-between gap-4 mb-6', className)}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center">
          <ArrowRight className="w-6 h-6 text-primary" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-ink leading-none tracking-tightish">
            {title}
          </h1>
          {subtitle && <p className="text-xs text-ink-muted mt-1">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

/** Section title with a colored dot prefix (used inside dashboard sections) */
export function SectionLabel({
  children,
  tone = 'primary',
  className,
}: {
  children: ReactNode;
  tone?: 'primary' | 'danger' | 'info' | 'success';
  className?: string;
}) {
  const dotColor = {
    primary: 'bg-primary',
    danger: 'bg-danger',
    info: 'bg-info',
    success: 'bg-success',
  }[tone];
  return (
    <div className={cn('flex items-center gap-2 mb-3', className)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', dotColor)} />
      <h2 className="text-sm font-semibold text-ink">{children}</h2>
      <div className="flex-1 border-b border-dashed border-line mt-1 ml-1" />
    </div>
  );
}
