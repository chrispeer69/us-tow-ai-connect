/**
 * Route-level loading skeleton. Branding isn't known server-side (tenant is
 * resolved client-side from the tracking payload — see S43_DECISIONS.md), so
 * this stays neutral and is replaced the moment the client hydrates.
 */
export default function TrackLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto h-8 w-32 max-w-md animate-pulse rounded bg-slate-200" />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-4">
        <div className="h-28 animate-pulse rounded-2xl bg-slate-200" />
        <div className="h-20 animate-pulse rounded-2xl bg-slate-200" />
        <div className="h-72 animate-pulse rounded-2xl bg-slate-200" />
      </main>
    </div>
  );
}
