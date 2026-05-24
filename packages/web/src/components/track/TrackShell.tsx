'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { TrackBranding } from './types';

/**
 * White-label shell for the caller-facing tracking page. Brand colors are
 * applied as CSS custom properties on THIS wrapper only (inline style) so the
 * theme never bleeds into /admin — see S43_DECISIONS.md D3. Descendants read
 * `var(--brand-primary)` etc. and inherit them.
 */
export function TrackShell({
  branding,
  eta,
  children,
}: {
  branding: TrackBranding;
  /** Sticky-header ETA in minutes; omitted when not meaningful. */
  eta?: number | null;
  children: ReactNode;
}) {
  const brandVars = {
    '--brand-primary': branding.primaryColor,
    '--brand-secondary': branding.secondaryColor,
    '--brand-accent': branding.accentColor,
  } as CSSProperties;

  return (
    <div
      style={brandVars}
      className="flex min-h-screen flex-col bg-slate-50 text-slate-900"
    >
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-4 py-3">
          <BrandWordmark branding={branding} />
          {eta != null && (
            <div className="flex flex-col items-end leading-tight">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                ETA
              </span>
              <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--brand-primary)' }}>
                {eta} min
              </span>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col">{children}</main>

      <footer className="mx-auto w-full max-w-md px-4 py-5 text-center">
        <p className="text-xs text-slate-400">
          Tracked by <span className="font-semibold text-slate-600">{branding.companyDisplayName}</span>
        </p>
        {!branding.hidePoweredBy && (
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
            Powered by Blue Collar AI
          </p>
        )}
      </footer>
    </div>
  );
}

function BrandWordmark({ branding }: { branding: TrackBranding }) {
  if (branding.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={branding.logoUrl}
        alt={branding.companyDisplayName}
        className="h-8 w-auto max-w-[180px] object-contain object-left"
      />
    );
  }
  return (
    <span className="text-base font-extrabold tracking-tight" style={{ color: 'var(--brand-secondary)' }}>
      {branding.companyDisplayName}
    </span>
  );
}
