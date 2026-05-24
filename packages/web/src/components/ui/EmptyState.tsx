import * as React from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /** Optional leading icon (e.g. <Icon name="calls" size={22} />). */
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Optional call-to-action(s) rendered below the copy. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Standardized "no data yet" placeholder (Session 47). Replaces the ad-hoc
 * one-off "No X yet" strings scattered across admin pages with one
 * design-token-driven block: dashed card, muted icon chip, title + subtext,
 * optional action.
 */
export function EmptyState({ icon, title, description, actions, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-[16px] border border-dashed border-[var(--border-strong)] bg-[var(--surface-card)] px-6 py-12 text-center',
        className,
      )}
    >
      {icon != null && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-low)] text-[var(--text-muted)]">
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-base font-bold text-[var(--text-main)]">{title}</h3>
        {description != null && (
          <p className="mx-auto max-w-sm text-sm text-[var(--text-secondary)]">{description}</p>
        )}
      </div>
      {actions != null && <div className="mt-1 flex items-center gap-2">{actions}</div>}
    </div>
  );
}
