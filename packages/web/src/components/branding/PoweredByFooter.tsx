'use client';
import { useBranding } from './BrandingProvider';

export function PoweredByFooter() {
  const { branding } = useBranding();
  if (branding.hidePoweredBy) return null;
  return (
    <div className="mt-12 border-t border-zinc-800 pt-4 text-center text-xs text-zinc-500">
      Powered by US Tow AI-Connect
    </div>
  );
}
