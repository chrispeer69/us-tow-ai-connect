'use client';
import * as React from 'react';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

interface ChartCardProps {
  title: string;
  subtitle?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  /** When true, render the empty-state message instead of children. */
  empty?: boolean;
  emptyHint?: string;
  onExport?: () => void;
  exporting?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * Uniform card chrome for a single chart: title, optional subtitle, a CSV
 * export action, and graceful loading / empty / error states so a fresh
 * tenant never sees a broken chart.
 */
export function ChartCard({
  title,
  subtitle,
  loading,
  error,
  empty,
  emptyHint = 'No data for this range yet.',
  onExport,
  exporting,
  className,
  children,
}: ChartCardProps) {
  return (
    <Card className={className}>
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border-color)] px-5 py-4">
        <div>
          <h2 className="font-display text-base font-bold text-[var(--text-main)]">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">{subtitle}</p>
          )}
        </div>
        {onExport && (
          <button
            type="button"
            onClick={onExport}
            disabled={loading || empty || exporting}
            className="shrink-0 rounded-[8px] border border-[var(--border-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--alliance-blue)] hover:text-[var(--alliance-blue)] disabled:cursor-not-allowed disabled:opacity-40"
            title="Download CSV"
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        )}
      </div>
      <div className="relative h-[260px] px-2 py-3">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
            <Spinner /> <span className="ml-2">Loading…</span>
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--alliance-red)]">
            {error}
          </div>
        ) : empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <span className="text-sm font-medium text-[var(--text-secondary)]">{emptyHint}</span>
            <span className="text-xs text-[var(--text-muted)]">
              Charts populate as jobs, dispatches and messages come in.
            </span>
          </div>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}
