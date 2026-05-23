'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  accent?: 'blue' | 'green' | 'amber' | 'navy' | 'purple' | 'red';
  className?: string;
}

const accentColor: Record<NonNullable<StatTileProps['accent']>, string> = {
  blue: 'var(--alliance-blue)',
  green: '#22c55e',
  amber: 'var(--alliance-amber)',
  navy: 'var(--alliance-navy)',
  purple: 'var(--alliance-purple)',
  red: 'var(--alliance-red)',
};

/**
 * Mirrors the alliance "10.6K Verified Carriers" stat tiles: a clean white
 * card with a thin accent rule, an oversized display-font value, and a
 * Work-Sans uppercase label.
 */
export function StatTile({ label, value, hint, icon, accent = 'blue', className }: StatTileProps) {
  const color = accentColor[accent];
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[16px] border border-[var(--border-color)] bg-[var(--surface-card)] p-5 shadow-[var(--shadow-card)] transition-transform hover:-translate-y-0.5',
        className,
      )}
    >
      <span
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: color }}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div
            className="font-display text-3xl font-extrabold leading-none text-[var(--text-main)]"
            style={{ color }}
          >
            {value}
          </div>
          <div className="mt-2 font-label text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {label}
          </div>
          {hint != null && (
            <div className="mt-1 text-xs text-[var(--text-secondary)]">{hint}</div>
          )}
        </div>
        {icon != null && (
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-lg"
            style={{ background: `${color}14`, color }}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

export function StatTileGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  );
}
