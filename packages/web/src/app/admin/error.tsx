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
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="max-w-md w-full bg-zinc-900/40 border border-zinc-800 p-6 rounded-xl flex flex-col gap-4">
        <div className="flex items-center justify-center w-12 h-12 mx-auto rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376C1.83 19.126 2.914 21 4.645 21h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-zinc-100">This panel hit an error</h2>
          <p className="text-sm text-zinc-400">
            The sidebar is still usable — try another section, or reload this one.
          </p>
        </div>
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => reset()}
            className="px-4 py-2 rounded-md text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition"
          >
            Reload section
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-md text-sm font-medium border border-zinc-700 text-zinc-100 hover:bg-zinc-800 transition"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}
