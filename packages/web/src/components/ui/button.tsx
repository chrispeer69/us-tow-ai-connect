'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary';
type Size = 'default' | 'sm' | 'lg' | 'icon';

const base =
  'inline-flex items-center justify-center rounded-[12px] font-semibold transition-all disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--alliance-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-bg)]';

const variants: Record<Variant, string> = {
  default:
    'bg-[var(--alliance-blue)] text-white shadow-[0_4px_16px_rgba(37,99,235,0.25)] hover:bg-[var(--alliance-blue-dark)]',
  secondary:
    'bg-[var(--alliance-navy)] text-white hover:bg-[#0a2444]',
  outline:
    'border border-[var(--border-strong)] text-[var(--text-main)] bg-[var(--surface-card)] hover:bg-[var(--surface-low)] hover:border-[var(--alliance-blue)]',
  ghost: 'text-[var(--text-secondary)] hover:bg-[var(--surface-low)] hover:text-[var(--text-main)]',
  destructive: 'bg-[var(--alliance-red)] text-white hover:bg-[#dc2626]',
};
const sizes: Record<Size, string> = {
  default: 'h-10 px-5 text-sm',
  sm: 'h-8 px-3 text-xs',
  lg: 'h-12 px-7 text-base',
  icon: 'h-9 w-9',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
