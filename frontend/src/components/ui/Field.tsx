import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';

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
