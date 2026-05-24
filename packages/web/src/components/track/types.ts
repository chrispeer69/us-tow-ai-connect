/**
 * Caller-facing tracking types. The public payload is owned by the API
 * (packages/api, not this session). Fields the API does not yet emit
 * (`tenant_id`, `branding`, `driver_call_url`, `cancel_reason`) are typed
 * optional so the page consumes them automatically once the API adds them
 * — see docs/sessions/S43_DECISIONS.md for the handoff blockers.
 */
export interface TrackingView {
  caller_name: string | null;
  status: string;
  assigned_driver_name: string | null;
  last_eta_minutes: number | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  driver_lat: number | null;
  driver_lng: number | null;
  expires_at: string;
  expired: boolean;
  caller_phone_last4: string | null;

  // Forward-compatible (API handoff — see S43_DECISIONS.md):
  tenant_id?: string | null;
  branding?: Partial<TrackBranding> | null;
  driver_call_url?: string | null;
  cancel_reason?: string | null;
}

/** Subset of the tenant BrandingBody consumed by the caller page. */
export interface TrackBranding {
  companyDisplayName: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  supportPhone: string;
  supportEmail: string;
  hidePoweredBy: boolean;
}

/**
 * Neutral fallback — intentionally NOT "Roadside Towing" (a specific tenant)
 * and NOT "US Tow Alliance" (the platform). Plain "US Tow" wordmark + a
 * conservative blue until real tenant branding resolves.
 */
export const DEFAULT_BRANDING: TrackBranding = {
  companyDisplayName: 'US Tow',
  logoUrl: '',
  primaryColor: '#2563eb',
  secondaryColor: '#0f172a',
  accentColor: '#2563eb',
  supportPhone: '',
  supportEmail: '',
  hidePoweredBy: false,
};

export function mergeBranding(partial?: Partial<TrackBranding> | null): TrackBranding {
  if (!partial) return DEFAULT_BRANDING;
  return {
    companyDisplayName: partial.companyDisplayName || DEFAULT_BRANDING.companyDisplayName,
    logoUrl: partial.logoUrl || '',
    primaryColor: partial.primaryColor || DEFAULT_BRANDING.primaryColor,
    secondaryColor: partial.secondaryColor || DEFAULT_BRANDING.secondaryColor,
    // Accent falls back to primary so map/dots stay on-brand.
    accentColor: partial.accentColor || partial.primaryColor || DEFAULT_BRANDING.accentColor,
    supportPhone: partial.supportPhone || '',
    supportEmail: partial.supportEmail || '',
    hidePoweredBy: partial.hidePoweredBy ?? false,
  };
}
