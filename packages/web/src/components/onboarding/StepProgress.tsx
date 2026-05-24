'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

const STEPS = [
  { label: 'Company' },
  { label: 'Contact' },
  { label: 'Integrations' },
  { label: 'AI Agent' },
] as const;

/**
 * Alliance-styled step indicator: numbered navy circles joined by
 * connector lines on a light surface. Completed steps fill navy with a
 * checkmark, the active step fills navy with a focus ring, and upcoming
 * steps stay light. Mobile-first — labels stay legible down to ~340px.
 */
export function StepProgress({ current }: { current: number }) {
  return (
    <nav aria-label="Onboarding progress" className="w-full">
      <ol className="flex items-start">
        {STEPS.map((s, i) => {
          const n = i + 1;
          const state: 'complete' | 'active' | 'upcoming' =
            n < current ? 'complete' : n === current ? 'active' : 'upcoming';
          const isLast = i === STEPS.length - 1;
          return (
            <React.Fragment key={s.label}>
              <li
                className="flex shrink-0 flex-col items-center gap-2"
                data-testid={`step-indicator-${n}`}
                data-active={n <= current}
                aria-current={state === 'active' ? 'step' : undefined}
              >
                <span
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition-all duration-300 sm:h-10 sm:w-10',
                    state === 'complete' &&
                      'bg-[var(--alliance-navy)] text-white shadow-[var(--shadow-md)]',
                    state === 'active' &&
                      'bg-[var(--alliance-navy)] text-white shadow-[var(--shadow-md)] ring-4 ring-[rgba(5,22,43,0.12)]',
                    state === 'upcoming' &&
                      'border border-[var(--border-strong)] bg-[var(--surface-card)] text-[var(--text-muted)]',
                  )}
                >
                  {state === 'complete' ? <CheckMark className="h-4 w-4" /> : n}
                </span>
                <span
                  className={cn(
                    'w-16 text-center font-label text-[11px] font-semibold leading-tight tracking-tight sm:w-20 sm:text-xs',
                    state === 'upcoming'
                      ? 'text-[var(--text-muted)]'
                      : 'text-[var(--alliance-navy)]',
                  )}
                >
                  {s.label}
                </span>
              </li>
              {!isLast && (
                <span
                  aria-hidden
                  className={cn(
                    'mt-[18px] h-0.5 flex-1 rounded-full transition-colors duration-300 sm:mt-5',
                    n < current
                      ? 'bg-[var(--alliance-navy)]'
                      : 'bg-[var(--border-color)]',
                  )}
                />
              )}
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

function CheckMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path
        d="M5 10.5l3.2 3.2L15 7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
