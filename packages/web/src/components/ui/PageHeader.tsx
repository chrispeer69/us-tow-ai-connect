'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** `hero` renders the navy alliance gradient treatment used on index pages. */
  variant?: 'default' | 'hero';
  className?: string;
}

/**
 * Section / page header matching the alliance hero + section-header pattern:
 * a Work-Sans uppercase eyebrow, a Manrope display title, and an optional
 * subtitle, with an actions slot pinned right. The `hero` variant reproduces
 * the dark navy gradient band used at the top of landing sections.
 */
export function PageHeader({
  title,
  eyebrow,
  subtitle,
  actions,
  variant = 'default',
  className,
}: PageHeaderProps) {
  if (variant === 'hero') {
    return (
      <div
        className={cn(
          'relative mb-8 overflow-hidden rounded-[20px] px-7 py-9 text-white shadow-[var(--shadow-lift)]',
          className,
        )}
        style={{ background: 'var(--hero-gradient)' }}
      >
        <span
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-25 blur-3xl"
          style={{ background: 'var(--alliance-blue)' }}
          aria-hidden
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            {eyebrow != null && (
              <div className="font-label text-xs font-semibold uppercase tracking-[0.18em] text-[var(--alliance-amber-light)]">
                {eyebrow}
              </div>
            )}
            <h1 className="mt-2 font-display text-3xl font-extrabold leading-tight text-white sm:text-4xl">
              {title}
            </h1>
            {subtitle != null && (
              <p className="mt-2 max-w-2xl text-sm text-slate-300">{subtitle}</p>
            )}
          </div>
          {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'mb-7 flex flex-col gap-4 border-b border-[var(--border-color)] pb-5 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div>
        {eyebrow != null && (
          <div className="font-label text-xs font-semibold uppercase tracking-[0.18em] text-[var(--alliance-blue)]">
            {eyebrow}
          </div>
        )}
        <h1 className="mt-1 font-display text-2xl font-extrabold leading-tight text-[var(--text-main)] sm:text-3xl">
          {title}
        </h1>
        {subtitle != null && (
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">{subtitle}</p>
        )}
      </div>
      {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
