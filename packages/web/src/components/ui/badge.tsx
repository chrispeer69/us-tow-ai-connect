'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'default' | 'outline' | 'destructive' | 'success' | 'warning';

const variants: Record<Variant, string> = {
  default: 'bg-[var(--alliance-blue)] text-white',
  outline: 'border border-[var(--border-strong)] text-[var(--text-secondary)] bg-[var(--surface-card)]',
  destructive: 'bg-[#fee2e2] text-[#b91c1c]',
  success: 'bg-[#dcfce7] text-[#15803d]',
  warning: 'bg-[#fef3c7] text-[#b45309]',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
