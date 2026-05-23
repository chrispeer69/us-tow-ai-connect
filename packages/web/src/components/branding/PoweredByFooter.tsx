'use client';
import { useBranding } from './BrandingProvider';

export function PoweredByFooter() {
  const { branding } = useBranding();
  if (branding.hidePoweredBy) return null;
  return (
    <div className="mt-12 border-t border-[var(--border-color)] pt-5 text-center">
      <span className="font-label text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
        Powered by Blue Collar AI
      </span>
    </div>
  );
}
