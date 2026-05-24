'use client';

function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return raw;
}

/**
 * Sticky bottom call bar. Renders only the CTAs we have real handles for —
 * never a fabricated number (the old hardcoded Roadside dispatch line was
 * scrubbed; see S43_DECISIONS.md D4):
 *  - dispatcher: tenant `branding.supportPhone`
 *  - driver: `driver_call_url` (masked/relay handle — not yet in the API
 *    payload, so this is absent today; see handoff blocker #2).
 */
export function CallCtas({
  dispatcherPhone,
  driverCallUrl,
}: {
  dispatcherPhone: string;
  driverCallUrl?: string | null;
}) {
  const hasDispatcher = Boolean(dispatcherPhone);
  const hasDriver = Boolean(driverCallUrl);
  if (!hasDispatcher && !hasDriver) return null;

  return (
    <div className="sticky bottom-0 z-20 mt-auto border-t border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-md gap-3 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        {hasDriver && (
          <a
            href={driverCallUrl!}
            className="flex flex-1 items-center justify-center rounded-xl border-2 px-4 py-3 text-sm font-semibold"
            style={{ borderColor: 'var(--brand-primary)', color: 'var(--brand-primary)' }}
          >
            Call driver
          </a>
        )}
        {hasDispatcher && (
          <a
            href={`tel:${dispatcherPhone.replace(/\s/g, '')}`}
            className="flex flex-1 flex-col items-center justify-center rounded-xl px-4 py-2.5 text-white"
            style={{ backgroundColor: 'var(--brand-primary)' }}
          >
            <span className="text-sm font-semibold leading-tight">Call dispatcher</span>
            <span className="text-xs font-normal leading-tight opacity-90">
              {formatPhone(dispatcherPhone)}
            </span>
          </a>
        )}
      </div>
    </div>
  );
}
