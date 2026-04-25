import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

export type ButtonVariant =
  | 'primary'
  | 'danger'
  | 'soft'
  | 'soft-danger'
  | 'ghost'
  | 'outline';

type Size = 'default' | 'sm';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  danger: 'btn-danger',
  soft: 'btn-soft',
  'soft-danger': 'btn-soft-danger',
  ghost: 'btn-ghost',
  outline: 'btn-outline',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = 'primary',
    size = 'default',
    loading = false,
    leftIcon,
    rightIcon,
    className,
    disabled,
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(VARIANT_CLASS[variant], size === 'sm' && 'btn-sm', className)}
      {...rest}
    >
      {loading ? (
        <Loader2 className={cn('animate-spin', size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </button>
  );
});
