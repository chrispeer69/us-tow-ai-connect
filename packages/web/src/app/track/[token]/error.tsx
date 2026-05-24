'use client';

/**
 * Route error boundary for the caller tracking page. Caller-friendly copy —
 * no stack traces, no platform branding. Logs to console for diagnostics.
 */
import { useEffect } from 'react';

export default function TrackError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('track page error', error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center text-slate-900">
      <h1 className="text-2xl font-bold">Link expired or invalid</h1>
      <p className="max-w-xs text-slate-500">
        Something went wrong loading this tracking page. The link may have expired, or there may be
        a temporary issue.
      </p>
      <button
        onClick={reset}
        className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white"
      >
        Try again
      </button>
    </div>
  );
}
