'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto rounded-[12px] border border-[var(--border-color)] bg-[var(--surface-card)]">
      <table className={cn('w-full text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className="bg-[var(--surface-low)] text-[var(--text-secondary)] font-label text-xs uppercase tracking-wide"
      {...props}
    />
  );
}
export function TableBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className="divide-y divide-[var(--border-color)]" {...props} />;
}
export function TableRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn('hover:bg-[var(--surface-low)] transition-colors', className)}
      {...props}
    />
  );
}
export function TableHead({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('px-3 py-2.5 text-left font-semibold', className)} {...props} />;
}
export function TableCell({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2.5 text-[var(--text-main)]', className)} {...props} />;
}
