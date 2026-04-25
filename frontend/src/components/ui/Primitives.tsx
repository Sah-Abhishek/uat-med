import { useEffect, type ReactNode, type HTMLAttributes } from 'react';
import { X, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { cn, initials } from '@/lib/utils';
import { Button } from './Button';
export { PillBadge } from './Chip';

/* ═══════════════════════════════════════════════════════════
   MODAL — centered overlay with X close
   ═══════════════════════════════════════════════════════════ */
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: ReactNode;
}

export function Modal({ open, onClose, title, subtitle, size = 'md', children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const widthClass = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }[size];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          'relative w-full bg-surface rounded-[20px] shadow-pop dark:shadow-pop-dark overflow-hidden',
          widthClass,
        )}
      >
        {(title || subtitle) && (
          <div className="flex items-start justify-between px-6 pt-6 pb-2">
            <div className="min-w-0">
              {title && <h3 className="text-lg font-bold text-ink">{title}</h3>}
              {subtitle && <p className="text-xs text-ink-muted mt-1">{subtitle}</p>}
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-ink-muted hover:bg-surface-sunken transition"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}

export function ModalFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-end gap-2 pt-4 mt-4 border-t border-line', className)}>
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   CONFIRM MODAL — with yellow alert icon
   ═══════════════════════════════════════════════════════════ */
interface ConfirmProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  loading?: boolean;
}
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  message,
  confirmLabel = 'Yes',
  cancelLabel = 'No',
  variant = 'danger',
  loading,
}: ConfirmProps) {
  return (
    <Modal open={open} onClose={onClose} size="sm">
      <div className="text-center pt-4 pb-2">
        <div className="w-16 h-16 rounded-full bg-primary-soft text-primary-ink flex items-center justify-center mx-auto mb-5">
          <AlertCircle className="w-7 h-7" />
        </div>
        <p className="text-sm text-ink leading-relaxed mb-6">{message}</p>
        <div className="flex items-center justify-center gap-2">
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════
   PAGINATION — circular yellow active page
   ═══════════════════════════════════════════════════════════ */
interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (p: number) => void;
}
export function Pagination({ page, pageCount, onPageChange }: PaginationProps) {
  if (pageCount <= 1) return null;

  const pages: Array<number | '…'> = [];
  const windowSize = 1;
  for (let i = 1; i <= pageCount; i++) {
    if (
      i === 1 ||
      i === pageCount ||
      (i >= page - windowSize && i <= page + windowSize)
    ) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '…') {
      pages.push('…');
    }
  }

  return (
    <div className="flex items-center justify-center gap-1 py-4">
      <button
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="w-8 h-8 rounded-full flex items-center justify-center text-ink-muted hover:bg-surface-sunken disabled:opacity-30 transition"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`e${i}`} className="px-2 text-ink-subtle">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition',
              p === page
                ? 'bg-primary text-primary-ink'
                : 'text-ink-muted hover:bg-surface-sunken',
            )}
          >
            {p}
          </button>
        ),
      )}
      <button
        onClick={() => onPageChange(Math.min(pageCount, page + 1))}
        disabled={page === pageCount}
        className="w-8 h-8 rounded-full flex items-center justify-center text-ink-muted hover:bg-surface-sunken disabled:opacity-30 transition"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   TABS — yellow-underline style
   ═══════════════════════════════════════════════════════════ */
interface Tab {
  key: string;
  label: string;
  count?: number;
}
interface TabsProps {
  tabs: Tab[];
  value: string;
  onChange: (k: string) => void;
  className?: string;
}
export function Tabs({ tabs, value, onChange, className }: TabsProps) {
  return (
    <div className={cn('flex items-center gap-6 border-b border-line', className)}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            'relative py-3 text-sm transition -mb-px border-b-2',
            value === t.key
              ? 'border-primary text-ink font-bold'
              : 'border-transparent text-ink-muted hover:text-ink font-semibold',
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="ml-1.5 text-ink-subtle font-normal">({t.count})</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   AVATAR + AVATAR STACK
   ═══════════════════════════════════════════════════════════ */
interface AvatarProps {
  name?: string | null;
  src?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}
export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  const dims = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-8 h-8 text-[11px]',
    md: 'w-9 h-9 text-xs',
    lg: 'w-12 h-12 text-sm',
  }[size];

  // Seeded background color (consistent per-name gradient)
  const gradient = gradientFromName(name ?? '?');

  return (
    <div
      className={cn(
        'rounded-full overflow-hidden flex items-center justify-center font-semibold text-white shrink-0 bg-gradient-to-br',
        dims,
        gradient,
        className,
      )}
      title={name ?? undefined}
    >
      {src ? (
        <img src={src} alt={name ?? ''} className="w-full h-full object-cover" />
      ) : (
        initials(name)
      )}
    </div>
  );
}

const GRADIENTS = [
  'from-violet-500 via-fuchsia-500 to-orange-400',
  'from-sky-500 via-blue-500 to-indigo-500',
  'from-emerald-500 via-teal-500 to-cyan-500',
  'from-amber-500 via-orange-500 to-rose-500',
  'from-pink-500 via-rose-500 to-red-500',
  'from-lime-500 via-green-500 to-emerald-500',
];
function gradientFromName(n: string): string {
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length]!;
}

interface AvatarStackProps {
  names: string[];
  max?: number;
  size?: AvatarProps['size'];
}
export function AvatarStack({ names, max = 3, size = 'sm' }: AvatarStackProps) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((n, i) => (
        <Avatar
          key={`${n}-${i}`}
          name={n}
          size={size}
          className="ring-2 ring-surface"
        />
      ))}
      {rest > 0 && (
        <div
          className={cn(
            'rounded-full bg-surface-sunken text-ink-muted flex items-center justify-center font-semibold ring-2 ring-surface text-[10px]',
            size === 'sm' ? 'w-8 h-8' : 'w-9 h-9',
          )}
        >
          +{rest}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PROGRESS BARS
   ═══════════════════════════════════════════════════════════ */
interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  value: number; // 0-100
  tone?: 'primary' | 'success' | 'warn' | 'danger' | 'info';
  height?: number;
}
export function ProgressBar({
  value,
  tone = 'primary',
  height = 6,
  className,
  ...rest
}: ProgressBarProps) {
  const fillColor = {
    primary: 'bg-primary',
    success: 'bg-success',
    warn: 'bg-warn',
    danger: 'bg-danger',
    info: 'bg-info',
  }[tone];
  return (
    <div
      className={cn('w-full rounded-full bg-surface-sunken overflow-hidden', className)}
      style={{ height }}
      {...rest}
    >
      <div
        className={cn('h-full rounded-full transition-all', fillColor)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

/**
 * DualProgressBar — the "12.13% / 87.87% pending" pattern from the Worklists list.
 * Shows completed on left, pending on right, with a 2-part bar.
 */
export function DualProgressBar({
  percent,
  tone = 'primary',
}: {
  percent: number;
  tone?: 'primary' | 'success';
}) {
  const completeColor = tone === 'success' ? 'text-success' : 'text-primary';
  const pendingColor = tone === 'success' ? 'text-success' : 'text-warn';
  return (
    <div className="min-w-[180px]">
      <div className="flex items-baseline justify-between text-xs mb-1.5">
        <span className={cn('font-semibold', completeColor)}>
          {percent.toFixed(2)}%
        </span>
        <span className={cn('text-[11px]', pendingColor)}>
          {(100 - percent).toFixed(2)}% pending
        </span>
      </div>
      <div className="flex gap-0.5 h-1.5 w-full">
        <div
          className={cn('rounded-l-full', tone === 'success' ? 'bg-success' : 'bg-primary')}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
        <div
          className="flex-1 bg-primary-soft rounded-r-full"
          style={{
            opacity: percent >= 100 ? 0 : 1,
          }}
        />
      </div>
    </div>
  );
}
