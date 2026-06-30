import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Sparkles, X as XIcon } from 'lucide-react';
import { Input, Label, FancySelect, DatePicker, type DateMarker } from '@/components/ui/Field';
import { cn } from '@/lib/utils';

/* ── Audit table row config (mirrors source) ─────────────── */

export interface AuditRow {
  key: string;
  label: string;
  feedKey: string;
  multiFeedback?: boolean;
  totalCodesOptions?: string[];
}

export const AUDIT_ROWS: AuditRow[] = [
  { key: 'primaryDiagnosis', label: 'Primary Diagnosis', feedKey: 'prim_diag_feed' },
  { key: 'secondaryDiagnosis', label: 'Secondary Diagnosis', feedKey: 'sec_diag_feed', multiFeedback: true },
  { key: 'procedures', label: 'Procedures', feedKey: 'procedure_feed', multiFeedback: true },
  { key: 'edEmLevel', label: 'ED/EM Level', feedKey: 'ed_em_feed', totalCodesOptions: ['0', '1'] },
  { key: 'modifier', label: 'Modifier', feedKey: 'modifier_feed', multiFeedback: true },
  { key: 'poaIndicator', label: 'POA Indicator', feedKey: 'poa_feed', multiFeedback: true },
  { key: 'drgValue', label: 'DRG Value', feedKey: 'drug_feed', multiFeedback: true },
];

/* ── Metadata item (icon + label) ────────────────────────── */

export function MetaItem({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted">
      <span className="flex text-ink-subtle">{icon}</span>
      {children}
    </span>
  );
}

/* ── FormField — label + input/select with optional AI badge ── */

interface FormFieldProps {
  label: string;
  value?: string;
  onChange?: (v: string) => void;
  type?: 'text' | 'date' | 'select';
  options?: string[] | { value: string; label: string }[];
  required?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  aiTag?: boolean;
  min?: string;
  max?: string;
  /** Date-only: related dates to mark on the calendar + show in a legend. */
  dateMarkers?: DateMarker[];
  /** Date-only: shared, controlled calendar view-month. */
  viewMonth?: Date;
  onViewMonthChange?: (d: Date) => void;
}

export function FormField({
  label,
  value = '',
  onChange,
  type = 'text',
  options,
  required,
  readOnly,
  placeholder,
  aiTag,
  min,
  max,
  dateMarkers,
  viewMonth,
  onViewMonthChange,
}: FormFieldProps) {
  const opts =
    options?.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)) ?? [];

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between mb-1.5">
        <Label className="!mb-0">
          {label}
          {required && <span className="text-danger"> *</span>}
        </Label>
        {aiTag && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary-ink dark:text-primary bg-primary-soft px-1.5 py-0.5 rounded-pill">
            <Sparkles className="w-2.5 h-2.5" />
            AI Generated
          </span>
        )}
      </div>
      {type === 'select' ? (
        <FancySelect
          value={value}
          onChange={(v) => onChange?.(v)}
          options={opts}
          placeholder={placeholder ?? 'Select…'}
          disabled={readOnly}
        />
      ) : type === 'date' ? (
        <DatePicker
          value={value}
          onChange={(v) => onChange?.(v)}
          placeholder={placeholder ?? 'Select date'}
          disabled={readOnly}
          min={min}
          max={max}
          markers={dateMarkers}
          viewMonth={viewMonth}
          onViewMonthChange={onViewMonthChange}
        />
      ) : (
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          readOnly={readOnly}
          placeholder={placeholder}
          className={cn(readOnly && 'bg-surface-sunken cursor-not-allowed')}
        />
      )}
    </div>
  );
}

/* ── Tags input (free-entry chips) ────────────────────────
 * Free-text multi-value field: type a value and press Enter (or comma) to add a
 * chip, ✕ to remove, Backspace on an empty input removes the last chip. Unlike
 * MultiSelect there's no fixed option list — for codes the coder types freely
 * (e.g. PCS codes, DRG values). Duplicates (case-insensitive) are ignored. */
export function TagsInput({
  label,
  required,
  values,
  onChange,
  readOnly,
  placeholder,
  maxLen,
}: {
  label: string;
  required?: boolean;
  values: string[];
  onChange: (next: string[]) => void;
  readOnly?: boolean;
  placeholder?: string;
  maxLen?: number;
}) {
  const [text, setText] = useState('');

  const add = (raw: string) => {
    const v = maxLen ? raw.trim().slice(0, maxLen) : raw.trim();
    if (!v) return;
    if (!values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setText('');
  };

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between mb-1.5">
        <Label className="!mb-0">
          {label}
          {required && <span className="text-danger"> *</span>}
        </Label>
      </div>
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1.5 min-h-[38px]',
          readOnly && 'bg-surface-sunken opacity-70 pointer-events-none',
        )}
      >
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1 rounded-pill bg-primary-soft text-primary-ink dark:text-primary px-2 py-0.5 text-xs font-medium"
          >
            <span className="font-mono">{v}</span>
            {!readOnly && (
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => onChange(values.filter((_, idx) => idx !== i))}
                className="hover:text-danger"
              >
                <XIcon className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
        {!readOnly && (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                add(text);
              } else if (e.key === 'Backspace' && !text && values.length) {
                onChange(values.slice(0, -1));
              }
            }}
            onBlur={() => add(text)}
            placeholder={values.length === 0 ? placeholder ?? 'Type and press Enter…' : ''}
            className="flex-1 min-w-[80px] bg-transparent outline-none text-sm"
          />
        )}
      </div>
    </div>
  );
}

/* ── Multi-select (chips + searchable dropdown) ──────────── */

interface MultiSelectProps {
  value: string[];
  onChange: (next: string[]) => void;
  options: string[];
  placeholder?: string;
  readOnly?: boolean;
}

export function MultiSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  readOnly,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  };
  const remove = (v: string) => onChange(value.filter((x) => x !== v));

  // Reposition the popover using fixed positioning + portal so it escapes
  // any overflow:hidden ancestor (e.g. modals, collapsible cards).
  useLayoutEffect(() => {
    if (!open) return;
    const POPOVER_MAX_H = 320;
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
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  useEffect(() => {
    if (readOnly) setOpen(false);
  }, [readOnly]);

  return (
    <div className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={readOnly}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full min-h-[40px] rounded-pill border bg-surface pl-2 pr-2.5 flex items-center gap-1.5 text-sm transition',
          'border-line hover:border-line-strong hover:bg-surface-sunken/60',
          open && 'border-primary/70 bg-surface-sunken/60 shadow-card',
          readOnly && 'opacity-50 cursor-not-allowed pointer-events-none bg-surface-sunken',
        )}
      >
        <span className="flex-1 flex flex-wrap items-center gap-1 py-1.5 text-left min-w-0">
          {value.length === 0 ? (
            <span className="text-ink-subtle px-1.5">{placeholder}</span>
          ) : (
            value.map((v) => (
              <span
                key={v}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-ink dark:text-primary bg-primary-soft px-2 py-0.5 rounded-pill"
              >
                {v}
                {!readOnly && (
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(v);
                    }}
                    className="text-primary-ink/70 hover:text-primary-ink dark:text-primary/70 dark:hover:text-primary leading-none cursor-pointer"
                  >
                    <XIcon className="w-2.5 h-2.5" />
                  </span>
                )}
              </span>
            ))
          )}
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
              'max-h-[320px] overflow-y-auto',
            )}
          >
            {options.length === 0 && (
              <div className="px-3 py-2 text-xs text-ink-subtle">No options</div>
            )}
            {options.map((opt) => {
              const checked = value.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggle(opt)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition text-left',
                    checked
                      ? 'text-primary-ink dark:text-primary font-semibold hover:bg-primary-soft/60'
                      : 'text-ink hover:bg-surface-sunken font-medium',
                  )}
                >
                  <span
                    className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition',
                      checked ? 'bg-primary border-primary' : 'bg-surface border-line',
                    )}
                  >
                    {checked && <Check className="w-3 h-3 text-primary-ink" strokeWidth={3} />}
                  </span>
                  <span className="flex-1 truncate">{opt}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ── Skeleton helpers ───────────────────────────────────── */

/** A single faux field — label bar + input pill — used in section skeletons. */
export function FieldSkeleton() {
  return (
    <div className="min-w-0">
      <div className="h-3 w-20 rounded-full bg-surface-sunken animate-pulse mb-2" />
      <div className="h-10 rounded-pill bg-surface-sunken animate-pulse" />
    </div>
  );
}

/** Renders `count` field skeletons inside an N-column grid. */
export function SkeletonGrid({ cols = 3, count = 3 }: { cols?: number; count?: number }) {
  return (
    <div
      className={cn(
        'grid gap-4 mb-4',
        cols === 1 && 'grid-cols-1',
        cols === 2 && 'grid-cols-2',
        cols === 3 && 'grid-cols-3',
      )}
    >
      {Array.from({ length: count }, (_, i) => (
        <FieldSkeleton key={i} />
      ))}
    </div>
  );
}

/* ── Priority badge (matches source's coloured pill) ─────── */

export function PriorityBadge({ priority }: { priority?: string }) {
  if (!priority) return null;
  const p = priority.toLowerCase();
  const tone =
    p === 'critical'
      ? 'bg-danger-soft text-danger border-danger/30'
      : p === 'high'
      ? 'bg-warn-soft text-warn border-warn/30'
      : p === 'medium'
      ? 'bg-primary-soft text-primary-ink dark:text-primary border-primary/30'
      : 'bg-success-soft text-success border-success/30';
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-pill border text-[11px] font-semibold uppercase tracking-wide',
        tone,
      )}
    >
      {priority}
    </span>
  );
}
