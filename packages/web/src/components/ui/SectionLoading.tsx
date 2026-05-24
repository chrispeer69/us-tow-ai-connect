import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SectionLoadingProps {
  /** Number of skeleton rows to render under the header block. */
  rows?: number;
  label?: string;
  className?: string;
}

/**
 * Shared route-segment loading fallback (Session 47). Plain server component
 * (no hooks / no 'use client') so it can be the default export of any
 * `loading.tsx`. Renders a header skeleton + a few shimmering rows that match
 * the card/surface tokens, so navigation feels consistent across pages.
 */
export function SectionLoading({ rows = 4, label = 'Loading…', className }: SectionLoadingProps) {
  return (
    <div className={cn('animate-pulse space-y-6', className)} aria-busy="true" aria-label={label}>
      <div className="space-y-2 border-b border-[var(--border-color)] pb-5">
        <div className="h-3 w-24 rounded bg-[var(--surface-low)]" />
        <div className="h-7 w-64 rounded bg-[var(--surface-low)]" />
        <div className="h-3 w-80 rounded bg-[var(--surface-low)]" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-[14px] border border-[var(--border-color)] bg-[var(--surface-card)]"
          />
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
