'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full min-h-[80px] rounded-[12px] border border-[var(--border-strong)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--alliance-blue)] focus-visible:border-[var(--alliance-blue)]',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
