'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';

export interface Branding {
  companyDisplayName: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  emailSignatureHtml: string;
  smsSignature: string;
  supportPhone: string;
  supportEmail: string;
  customDomain: string | null;
  hidePoweredBy: boolean;
}

export const DEFAULT_BRANDING: Branding = {
  companyDisplayName: 'US Tow AI-Connect',
  logoUrl: '',
  faviconUrl: '',
  primaryColor: '#3b82f6',
  secondaryColor: '#1e293b',
  accentColor: '#facc15',
  fontFamily: 'Inter',
  emailSignatureHtml: '',
  smsSignature: '',
  supportPhone: '',
  supportEmail: '',
  customDomain: null,
  hidePoweredBy: false,
};

const BrandingContext = createContext<{
  branding: Branding;
  setBranding: (b: Partial<Branding>) => void;
}>({ branding: DEFAULT_BRANDING, setBranding: () => {} });

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

const FONT_STACK: Record<string, string> = {
  Inter: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  Roboto: "'Roboto', system-ui, sans-serif",
  'Open Sans': "'Open Sans', system-ui, sans-serif",
  'Source Sans 3': "'Source Sans 3', system-ui, sans-serif",
  Lato: "'Lato', system-ui, sans-serif",
  Montserrat: "'Montserrat', system-ui, sans-serif",
  'System UI': 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
};

export function applyBrandingCssVars(b: Branding) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--brand-primary', b.primaryColor);
  root.style.setProperty('--brand-secondary', b.secondaryColor);
  root.style.setProperty('--brand-accent', b.accentColor);
  root.style.setProperty('--brand-font', FONT_STACK[b.fontFamily] ?? FONT_STACK.Inter);
  // Favicon override
  if (b.faviconUrl) {
    let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = b.faviconUrl;
  }
}

interface ProviderProps {
  initial?: Partial<Branding> | null;
  tenantId?: string | null;
  source?: 'admin' | 'public';
  children: React.ReactNode;
}

/**
 * Hydrates from `initial` synchronously (so SSR HTML is themed), then
 * lazily fetches the latest branding via the API when a tenantId is
 * provided. Set source='public' to use /branding/public/:id (no auth);
 * source='admin' will fall back to a no-op if the request 401s, which is
 * fine for the initial page paint.
 */
export function BrandingProvider({ initial, tenantId, source = 'admin', children }: ProviderProps) {
  const [branding, setBrandingState] = useState<Branding>({
    ...DEFAULT_BRANDING,
    ...(initial ?? {}),
  });

  function setBranding(patch: Partial<Branding>) {
    setBrandingState((prev) => {
      const next = { ...prev, ...patch };
      applyBrandingCssVars(next);
      return next;
    });
  }

  useEffect(() => {
    applyBrandingCssVars(branding);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!tenantId) return;
    const url =
      source === 'public'
        ? `${API_BASE}/branding/public/${tenantId}`
        : `${API_BASE}/v1/admin/branding`;
    const opts: RequestInit =
      source === 'public'
        ? {}
        : { credentials: 'include', headers: { 'x-tenant-id': tenantId } };
    fetch(url, opts)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setBranding(data);
      })
      .catch(() => {
        /* ignore — branding is non-critical */
      });
  }, [tenantId, source]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BrandingContext.Provider value={{ branding, setBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
