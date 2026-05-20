import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type LabelHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { ChevronDown, Check, Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';

/* ── Label ────────────────────────────────── */
interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}
export function Label({ required, className, children, ...rest }: LabelProps) {
  return (
    <label className={cn('label', required && 'label-required', className)} {...rest}>
      {children}
    </label>
  );
}

/* ── Input ────────────────────────────────── */
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  sharp?: boolean;
}
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { error, sharp, className, ...rest },
  ref,
) {
  return (
    <>
      <input
        ref={ref}
        className={cn(
          sharp ? 'input-sharp' : 'input',
          error && 'border-danger focus:border-danger',
          className,
        )}
        {...rest}
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </>
  );
});

/* ── Select ───────────────────────────────── */
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  placeholder?: string;
}
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { error, placeholder, className, children, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          'input appearance-none pr-9 cursor-pointer',
          error && 'border-danger focus:border-danger',
          className,
        )}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        )}
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle" />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
});

/* ── Textarea ────────────────────────────── */
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
}
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { error, className, ...rest },
  ref,
) {
  return (
    <>
      <textarea
        ref={ref}
        className={cn('textarea', error && 'border-danger focus:border-danger', className)}
        {...rest}
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </>
  );
});

/* ── Radio — sleek brand radio ─────────────── */
interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
}
export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { label, className, disabled, ...rest },
  ref,
) {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-2.5 group select-none',
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
        className,
      )}
    >
      <input
        ref={ref}
        type="radio"
        disabled={disabled}
        className="peer sr-only"
        {...rest}
      />
      <span
        className={cn(
          'w-[18px] h-[18px] rounded-full border-2 bg-surface flex items-center justify-center shrink-0 transition',
          'border-line-strong',
          'group-hover:border-primary/60',
          'peer-checked:border-primary',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 peer-focus-visible:ring-offset-2',
          "before:content-[''] before:w-2 before:h-2 before:rounded-full before:bg-primary before:scale-0 before:transition-transform",
          'peer-checked:before:scale-100',
        )}
      />
      {label != null && <span className="text-sm text-ink font-medium">{label}</span>}
    </label>
  );
});

/* ── FancySelect — popover-style replacement for native select ── */
export interface FancySelectOption {
  value: string;
  label: string;
}
interface FancySelectProps {
  value: string;
  onChange: (v: string) => void;
  options: FancySelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}
export function FancySelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled,
  className,
}: FancySelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  // Reposition relative to trigger; flip above when no room below.
  useLayoutEffect(() => {
    if (!open) return;
    const POPOVER_MAX_H = 300;
    function reposition() {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const popH = Math.min(POPOVER_MAX_H, options.length * 38 + 12);
      let top = rect.bottom + 8;
      if (top + popH > vh - 8 && rect.top - 8 > popH) {
        top = rect.top - 8 - popH;
      }
      setPosition({ top, left: rect.left, width: rect.width });
    }
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, options.length]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        popoverRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    }
    // Capture phase: fires before the Modal backdrop's React mousedown handler
    // can call e.stopPropagation(), which would otherwise prevent this listener
    // from running when the trigger is rendered inside a <Modal>.
    if (open) document.addEventListener('mousedown', onClickOutside, true);
    return () => document.removeEventListener('mousedown', onClickOutside, true);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const selected = options.find((o) => o.value === value);
  const display = selected?.label ?? placeholder;

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full h-10 pl-3.5 pr-2.5 rounded-pill border bg-surface flex items-center gap-2 text-sm transition',
          'border-line hover:border-line-strong hover:bg-surface-sunken/60',
          open && 'border-primary/70 bg-surface-sunken/60 shadow-card',
          disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
        )}
      >
        <span
          className={cn(
            'flex-1 text-left truncate',
            selected ? 'font-semibold text-ink' : 'text-ink-subtle',
          )}
        >
          {display}
        </span>
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 text-ink-muted transition-transform shrink-0',
            open && 'rotate-180 text-primary',
          )}
        />
      </button>

      {open && position && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ top: position.top, left: position.left, width: position.width }}
            className={cn(
              'fixed z-[100]',
              'bg-surface border border-line rounded-xl shadow-pop dark:shadow-pop-dark p-1',
              'max-h-[300px] overflow-y-auto',
            )}
          >
            {options.map((o) => {
              const isSelected = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition text-left',
                    isSelected
                      ? 'bg-primary-soft text-primary-ink dark:text-primary font-semibold'
                      : 'text-ink hover:bg-surface-sunken font-medium',
                  )}
                >
                  <span className="flex-1 truncate">{o.label}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ── DatePicker — themed calendar popover ─────────────── */

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Parse `YYYY-MM-DD` as a local-time Date. Returns null for invalid/empty. */
function parseISODate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function formatISODate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Pretty short form like "Apr 26, 2026" used in the trigger button. */
function formatDateDisplay(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface DatePickerProps {
  value?: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  min?: string;
  max?: string;
}
export function DatePicker({
  value,
  onChange,
  placeholder = 'Select date',
  disabled,
  className,
  min,
  max,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const selected = parseISODate(value ?? null);
  const minDate = parseISODate(min);
  const maxDate = parseISODate(max);

  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const base = selected ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  // When the value is cleared/changed externally, sync the view
  useEffect(() => {
    if (selected) {
      setViewMonth((vm) =>
        vm.getFullYear() === selected.getFullYear() && vm.getMonth() === selected.getMonth()
          ? vm
          : new Date(selected.getFullYear(), selected.getMonth(), 1),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Position the popover relative to the trigger; keep it on-screen.
  useLayoutEffect(() => {
    if (!open) return;
    const POPOVER_W = 256;
    const POPOVER_H = 290;
    function reposition() {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = rect.bottom + 8;
      let left = rect.left;
      // Flip up if there's not enough room below
      if (top + POPOVER_H > vh - 8 && rect.top - 8 > POPOVER_H) {
        top = rect.top - 8 - POPOVER_H;
      }
      // Clamp horizontally to viewport
      left = Math.max(8, Math.min(left, vw - POPOVER_W - 8));
      setPosition({ top, left });
    }
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        popoverRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    }
    // Capture phase: fires before the Modal backdrop's React mousedown handler
    // can call e.stopPropagation(), which would otherwise prevent this listener
    // from running when the trigger is rendered inside a <Modal>.
    if (open) document.addEventListener('mousedown', onClickOutside, true);
    return () => document.removeEventListener('mousedown', onClickOutside, true);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  // Build the grid: always 6 weeks × 7 days, anchored to the first Sunday on/before the 1st.
  const gridStart = new Date(viewMonth);
  gridStart.setDate(1 - viewMonth.getDay());
  const cells: Date[] = [];
  for (let i = 0; i < 42; i += 1) {
    cells.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  }

  const today = new Date();
  const display = selected ? formatDateDisplay(selected) : placeholder;

  function isOutOfRange(d: Date) {
    if (minDate && d < new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate())) return true;
    if (maxDate && d > new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate())) return true;
    return false;
  }

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full h-10 pl-3.5 pr-2.5 rounded-pill border bg-surface flex items-center gap-2 text-sm transition',
          'border-line hover:border-line-strong hover:bg-surface-sunken/60',
          open && 'border-primary/70 bg-surface-sunken/60 shadow-card',
          disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
        )}
      >
        <CalendarIcon className="w-4 h-4 text-ink-muted shrink-0" />
        <span
          className={cn(
            'flex-1 text-left truncate',
            selected ? 'font-semibold text-ink' : 'text-ink-subtle',
          )}
        >
          {display}
        </span>
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 text-ink-muted transition-transform shrink-0',
            open && 'rotate-180 text-primary',
          )}
        />
      </button>

      {open && position && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ top: position.top, left: position.left, width: 256 }}
            className={cn(
              'fixed z-[100]',
              'bg-surface border border-line rounded-xl shadow-pop dark:shadow-pop-dark p-2.5',
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
                className="w-6 h-6 rounded-md hover:bg-surface-sunken flex items-center justify-center text-ink-muted transition"
                aria-label="Previous month"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[13px] font-bold text-ink select-none">
                {MONTH_NAMES[viewMonth.getMonth()]} {viewMonth.getFullYear()}
              </span>
              <button
                type="button"
                onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
                className="w-6 h-6 rounded-md hover:bg-surface-sunken flex items-center justify-center text-ink-muted transition"
                aria-label="Next month"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Weekday header */}
            <div className="grid grid-cols-7 gap-y-0.5">
              {WEEKDAY_LABELS.map((w) => (
                <div
                  key={w}
                  className="text-center text-[9px] uppercase tracking-[0.06em] text-ink-subtle font-semibold py-1"
                >
                  {w}
                </div>
              ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((d) => {
                const isOther = d.getMonth() !== viewMonth.getMonth();
                const isToday = isSameDay(d, today);
                const isSelected = selected ? isSameDay(d, selected) : false;
                const disabledCell = isOutOfRange(d);
                return (
                  <button
                    key={d.toISOString()}
                    type="button"
                    disabled={disabledCell}
                    onClick={() => {
                      onChange(formatISODate(d));
                      setOpen(false);
                    }}
                    className={cn(
                      'h-7 rounded-md text-[12px] transition relative',
                      'flex items-center justify-center',
                      isSelected
                        ? 'bg-primary text-primary-ink font-bold shadow-card'
                        : isToday
                        ? 'border border-primary/60 text-ink font-semibold'
                        : isOther
                        ? 'text-ink-subtle hover:bg-surface-sunken'
                        : 'text-ink hover:bg-surface-sunken font-medium',
                      disabledCell && 'opacity-30 pointer-events-none',
                    )}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>

            {/* Footer: Today + Clear */}
            <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-line">
              {(() => {
                const todayDisabled = isOutOfRange(today);
                return (
                  <button
                    type="button"
                    disabled={todayDisabled}
                    onClick={() => {
                      if (todayDisabled) return;
                      onChange(formatISODate(today));
                      setOpen(false);
                    }}
                    title={todayDisabled ? 'Today is outside the allowed range' : undefined}
                    className={cn(
                      'text-[11px] font-semibold transition',
                      todayDisabled
                        ? 'text-ink-subtle cursor-not-allowed'
                        : 'text-primary hover:underline',
                    )}
                  >
                    Today
                  </button>
                );
              })()}
              {value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange('');
                    setOpen(false);
                  }}
                  className="text-[11px] font-medium text-ink-muted hover:text-ink"
                >
                  Clear
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ── RangeDatePicker — two-month range selector ──────────────────── */
interface RangeDatePickerProps {
  value: { from: string | null; to: string | null };
  onChange: (next: { from: string | null; to: string | null }) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  min?: string;
  max?: string;
}
export function RangeDatePicker({
  value,
  onChange,
  placeholder = 'Select date range',
  disabled,
  className,
  min,
  max,
}: RangeDatePickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const fromDate = parseISODate(value.from);
  const toDate = parseISODate(value.to);
  const minDate = parseISODate(min);
  const maxDate = parseISODate(max);

  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const base = fromDate ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [hover, setHover] = useState<Date | null>(null);

  useEffect(() => {
    if (fromDate) {
      setViewMonth((vm) =>
        vm.getFullYear() === fromDate.getFullYear() && vm.getMonth() === fromDate.getMonth()
          ? vm
          : new Date(fromDate.getFullYear(), fromDate.getMonth(), 1),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.from]);

  useLayoutEffect(() => {
    if (!open) return;
    const POPOVER_W = 520;
    const POPOVER_H = 320;
    function reposition() {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = rect.bottom + 8;
      let left = rect.left;
      if (top + POPOVER_H > vh - 8 && rect.top - 8 > POPOVER_H) {
        top = rect.top - 8 - POPOVER_H;
      }
      left = Math.max(8, Math.min(left, vw - POPOVER_W - 8));
      setPosition({ top, left });
    }
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        popoverRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
      setHover(null);
    }
    // Capture phase: fires before the Modal backdrop's React mousedown handler
    // can call e.stopPropagation(), which would otherwise prevent this listener
    // from running when the trigger is rendered inside a <Modal>.
    if (open) document.addEventListener('mousedown', onClickOutside, true);
    return () => document.removeEventListener('mousedown', onClickOutside, true);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function isOutOfRange(d: Date) {
    if (minDate && d < new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate()))
      return true;
    if (maxDate && d > new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate()))
      return true;
    return false;
  }

  function handleSelect(d: Date) {
    if (isOutOfRange(d)) return;
    // No range yet, or both endpoints already chosen → start a fresh range.
    if (!fromDate || (fromDate && toDate)) {
      onChange({ from: formatISODate(d), to: null });
      return;
    }
    // From is set, picking the second endpoint. Swap if user picked an earlier date.
    if (d < fromDate) {
      onChange({ from: formatISODate(d), to: formatISODate(fromDate) });
    } else {
      onChange({ from: formatISODate(fromDate), to: formatISODate(d) });
    }
    setOpen(false);
    setHover(null);
  }

  const monthA = viewMonth;
  const monthB = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);

  const display = (() => {
    if (fromDate && toDate) return `${formatDateDisplay(fromDate)} – ${formatDateDisplay(toDate)}`;
    if (fromDate) return `${formatDateDisplay(fromDate)} – …`;
    return placeholder;
  })();

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full h-10 pl-3.5 pr-2.5 rounded-pill border bg-surface flex items-center gap-2 text-sm transition',
          'border-line hover:border-line-strong hover:bg-surface-sunken/60',
          open && 'border-primary/70 bg-surface-sunken/60 shadow-card',
          disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
        )}
      >
        <CalendarIcon className="w-4 h-4 text-ink-muted shrink-0" />
        <span
          className={cn(
            'flex-1 text-left truncate',
            fromDate ? 'font-semibold text-ink' : 'text-ink-subtle',
          )}
        >
          {display}
        </span>
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 text-ink-muted transition-transform shrink-0',
            open && 'rotate-180 text-primary',
          )}
        />
      </button>

      {open && position && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ top: position.top, left: position.left, width: 520 }}
            className={cn(
              'fixed z-[100]',
              'bg-surface border border-line rounded-xl shadow-pop dark:shadow-pop-dark p-3',
            )}
          >
            <div className="flex items-stretch gap-2">
              <RangeMonthGrid
                month={monthA}
                fromDate={fromDate}
                toDate={toDate}
                hover={hover}
                isOutOfRange={isOutOfRange}
                onHover={setHover}
                onSelect={handleSelect}
                showPrev
                onPrev={() =>
                  setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))
                }
              />
              <div className="w-px bg-line" />
              <RangeMonthGrid
                month={monthB}
                fromDate={fromDate}
                toDate={toDate}
                hover={hover}
                isOutOfRange={isOutOfRange}
                onHover={setHover}
                onSelect={handleSelect}
                showNext
                onNext={() =>
                  setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))
                }
              />
            </div>

            <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-line">
              <span className="text-[11px] text-ink-muted">
                {fromDate && !toDate
                  ? 'Pick the end date'
                  : fromDate && toDate
                  ? 'Click any date to start a new range'
                  : 'Pick the start date'}
              </span>
              {(value.from || value.to) && (
                <button
                  type="button"
                  onClick={() => {
                    onChange({ from: null, to: null });
                    setHover(null);
                  }}
                  className="text-[11px] font-medium text-ink-muted hover:text-ink"
                >
                  Clear
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function RangeMonthGrid({
  month,
  fromDate,
  toDate,
  hover,
  isOutOfRange,
  onHover,
  onSelect,
  showPrev,
  showNext,
  onPrev,
  onNext,
}: {
  month: Date;
  fromDate: Date | null;
  toDate: Date | null;
  hover: Date | null;
  isOutOfRange: (d: Date) => boolean;
  onHover: (d: Date | null) => void;
  onSelect: (d: Date) => void;
  showPrev?: boolean;
  showNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const gridStart = new Date(month);
  gridStart.setDate(1 - month.getDay());
  const cells: Date[] = [];
  for (let i = 0; i < 42; i += 1) {
    cells.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  }
  const today = new Date();

  // Compute the effective range (committed or hover-preview).
  const previewEnd = !toDate && fromDate && hover ? hover : null;
  const rangeLo = fromDate
    ? toDate
      ? fromDate < toDate
        ? fromDate
        : toDate
      : previewEnd
      ? fromDate < previewEnd
        ? fromDate
        : previewEnd
      : null
    : null;
  const rangeHi = fromDate
    ? toDate
      ? fromDate < toDate
        ? toDate
        : fromDate
      : previewEnd
      ? fromDate < previewEnd
        ? previewEnd
        : fromDate
      : null
    : null;

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-2 px-1">
        {showPrev ? (
          <button
            type="button"
            onClick={onPrev}
            className="w-6 h-6 rounded-md hover:bg-surface-sunken flex items-center justify-center text-ink-muted transition"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        ) : (
          <span className="w-6 h-6" />
        )}
        <span className="text-[13px] font-bold text-ink select-none">
          {MONTH_NAMES[month.getMonth()]} {month.getFullYear()}
        </span>
        {showNext ? (
          <button
            type="button"
            onClick={onNext}
            className="w-6 h-6 rounded-md hover:bg-surface-sunken flex items-center justify-center text-ink-muted transition"
            aria-label="Next month"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <span className="w-6 h-6" />
        )}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {WEEKDAY_LABELS.map((w) => (
          <div
            key={w}
            className="text-center text-[9px] uppercase tracking-[0.06em] text-ink-subtle font-semibold py-1"
          >
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((d) => {
          const isOther = d.getMonth() !== month.getMonth();
          const isToday = isSameDay(d, today);
          const disabledCell = isOutOfRange(d);
          const sameLo = rangeLo && isSameDay(d, rangeLo);
          const sameHi = rangeHi && isSameDay(d, rangeHi);
          const inRange =
            rangeLo && rangeHi && d >= rangeLo && d <= rangeHi;
          const isEndpoint = sameLo || sameHi;
          const isOnlyOne = sameLo && sameHi;

          return (
            <button
              key={d.toISOString()}
              type="button"
              disabled={disabledCell || isOther}
              onMouseEnter={() => !isOther && onHover(d)}
              onMouseLeave={() => onHover(null)}
              onClick={() => !isOther && onSelect(d)}
              className={cn(
                'h-7 text-[12px] flex items-center justify-center transition relative',
                isOther
                  ? 'text-ink-subtle/40 pointer-events-none'
                  : disabledCell
                  ? 'text-ink-subtle opacity-30 pointer-events-none'
                  : 'text-ink',
                // Range fill (edges shaped, middle flat) — text stays readable on dark mode
                inRange && !isEndpoint && 'bg-primary-soft text-ink',
                inRange && sameLo && !isOnlyOne && 'bg-primary-soft rounded-l-md',
                inRange && sameHi && !isOnlyOne && 'bg-primary-soft rounded-r-md',
                // Endpoint pill on top
                isEndpoint &&
                  !disabledCell &&
                  'bg-primary text-primary-ink font-bold rounded-md shadow-card',
                // Today marker (only if not already styled)
                !isEndpoint && !inRange && isToday && !isOther &&
                  'border border-primary/60 font-semibold rounded-md',
                !isEndpoint && !inRange && !isToday && !isOther && 'rounded-md hover:bg-surface-sunken font-medium',
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Switch — stylised toggle ─────────────── */
interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}
export function Switch({ checked, onChange, label, description, disabled, className }: SwitchProps) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 cursor-pointer select-none',
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          'relative shrink-0 mt-0.5 w-10 h-6 rounded-full transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          checked ? 'bg-primary' : 'bg-surface-sunken border border-line',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-150',
            checked && 'translate-x-4',
          )}
        />
      </button>
      {(label || description) && (
        <div className="min-w-0">
          {label && <div className="text-sm font-semibold text-ink leading-tight">{label}</div>}
          {description && (
            <div className="text-[11px] text-ink-muted mt-0.5">{description}</div>
          )}
        </div>
      )}
    </label>
  );
}

/* ── OptionsBuilder — type, click + to add, list with × to remove ─ */
interface OptionsBuilderProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}
export function OptionsBuilder({ value, onChange, placeholder = 'Type an option…' }: OptionsBuilderProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function add() {
    const trimmed = draft.trim();
    if (!trimmed || value.includes(trimmed)) {
      setDraft('');
      inputRef.current?.focus();
      return;
    }
    onChange([...value, trimmed]);
    setDraft('');
    // Re-focus so the user keeps typing the next option
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="space-y-1.5">
          {value.map((opt, i) => (
            <div
              key={`${opt}-${i}`}
              className="flex items-center gap-2 rounded-lg border border-line bg-surface-sunken/50 px-3 py-2"
            >
              <span className="w-5 h-5 rounded-full bg-primary-soft text-primary-ink text-[11px] font-bold flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <span className="flex-1 text-sm text-ink truncate">{opt}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                className="w-6 h-6 rounded-full text-ink-muted hover:bg-danger-soft hover:text-danger flex items-center justify-center transition"
                aria-label="Remove option"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="input flex-1"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="px-3 rounded-lg bg-primary text-primary-ink font-semibold text-sm hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1"
        >
          <span className="text-base leading-none">+</span> Add
        </button>
      </div>
      {value.length === 0 && (
        <p className="text-[11px] text-ink-subtle">Type an option and press Enter or click Add.</p>
      )}
    </div>
  );
}

/* ── Search input with icon ─────────────── */
import { Search } from 'lucide-react';
export function SearchInput({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle" />
      <input className="input pl-10" {...rest} />
    </div>
  );
}
