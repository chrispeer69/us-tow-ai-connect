'use client';

import { useEffect } from 'react';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[admin] segment error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-8 text-center">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-[16px] border border-[var(--border-color)] bg-[var(--surface-card)] p-6 shadow-[var(--shadow-card)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[var(--alliance-amber)]/30 bg-[var(--alliance-amber)]/10 text-[var(--alliance-amber)]">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376C1.83 19.126 2.914 21 4.645 21h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-bold text-[var(--text-main)]">This panel hit an error</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            The sidebar is still usable — try another section, or reload this one.
          </p>
        </div>
        <div className="flex justify-center gap-2">
          <button
            onClick={() => reset()}
            className="rounded-[12px] bg-[var(--alliance-blue)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--alliance-blue-dark)]"
          >
            Reload section
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-[12px] border border-[var(--border-strong)] bg-[var(--surface-card)] px-4 py-2 text-sm font-semibold text-[var(--text-main)] transition hover:bg-[var(--surface-low)]"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}
