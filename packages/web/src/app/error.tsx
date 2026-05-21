'use ' + 'client'; // Prevent client directive issues

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 text-center select-none relative overflow-hidden">
      {/* Background gradients */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-red-600/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="z-10 max-w-md w-full bg-zinc-900/40 backdrop-blur-md border border-zinc-800/80 p-8 rounded-2xl shadow-xl flex flex-col items-center gap-6">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 text-red-400">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376C1.83 19.126 2.914 21 4.645 21h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold text-zinc-200">Something went wrong!</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            An unexpected error occurred while rendering this page.
          </p>
        </div>

        <button
          onClick={() => reset()}
          className="w-full bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-medium py-3 px-6 rounded-xl transition duration-200 shadow-lg shadow-red-500/10 hover:shadow-red-500/20 flex items-center justify-center gap-2"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
