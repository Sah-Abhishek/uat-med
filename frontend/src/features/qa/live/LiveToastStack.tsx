import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ArrowRight, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LiveVariant } from './shared';

export interface LiveToast {
  id: number;
  message: string;
  variant: LiveVariant;
  /** Draft this toast points at; "see more" opens its detail panel. Null for
   * coalesced/summary toasts that don't map to a single chart. */
  draftKey: string | null;
}

/** Match the tone/icon vocabulary of the shared <Toast> in Primitives. */
const TONE: Record<LiveVariant, string> = {
  warn: 'bg-warn-soft border-warn/40',
  danger: 'bg-danger-soft border-danger/40',
  success: 'bg-success-soft border-success/40',
  info: 'bg-info-soft border-info/40',
};
const ICON_TONE: Record<LiveVariant, string> = {
  warn: 'text-warn',
  danger: 'text-danger',
  success: 'text-success',
  info: 'text-info',
};
const ICON: Record<LiveVariant, typeof AlertCircle> = {
  warn: AlertCircle,
  danger: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

/** Slightly longer than the 4s poll so a toast never blinks out in the gap
 * between two polls. */
const DURATION_MS = 5000;

function ToastItem({
  toast,
  onDismiss,
  onSeeMore,
}: {
  toast: LiveToast;
  onDismiss: (id: number) => void;
  onSeeMore: (draftKey: string) => void;
}) {
  // Each item owns its dismiss timer; FIFO eviction unmounts it and clears the
  // timer here, so an evicted toast never fires a late onDismiss.
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), DURATION_MS);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  const Icon = ICON[toast.variant];
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-auto w-80 flex items-start gap-3 px-4 py-3 rounded-card border shadow-pop',
        'animate-[toast-in_180ms_ease-out]',
        TONE[toast.variant],
      )}
    >
      <Icon className={cn('w-5 h-5 mt-0.5 shrink-0', ICON_TONE[toast.variant])} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug text-ink">{toast.message}</p>
        {toast.draftKey && (
          <button
            type="button"
            onClick={() => onSeeMore(toast.draftKey!)}
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-ink-muted hover:text-ink transition"
          >
            See more <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="text-ink-muted hover:text-ink shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

/** Stacked, auto-dismissing notification host for the Live tab. Newest on top.
 * The single <Toast> primitive is fixed to one corner, so we render our own
 * portal column rather than N overlapping <Toast>s. */
export function LiveToastStack({
  toasts,
  onDismiss,
  onSeeMore,
}: {
  toasts: LiveToast[];
  onDismiss: (id: number) => void;
  onSeeMore: (draftKey: string) => void;
}) {
  if (typeof document === 'undefined' || toasts.length === 0) return null;
  return createPortal(
    <div className="fixed top-6 right-6 z-[200] flex flex-col-reverse gap-2.5 items-end pointer-events-none">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} onSeeMore={onSeeMore} />
      ))}
    </div>,
    document.body,
  );
}
