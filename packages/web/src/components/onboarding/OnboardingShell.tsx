'use client';
import * as React from 'react';
import { BrandingProvider } from '@/components/branding/BrandingProvider';
import { PoweredByFooter } from '@/components/branding/PoweredByFooter';

/**
 * Public onboarding shell. Mirrors the admin shell's alliance treatment —
 * light surface, glass brand bar, "Powered by Blue Collar AI" footer —
 * but runs pre-tenant (no tenantId), so BrandingProvider just supplies the
 * default alliance branding and CSS vars without a network fetch.
 */
export function OnboardingShell({ children }: { children: React.ReactNode }) {
  return (
    <BrandingProvider source="public">
      <div className="onboarding-shell flex min-h-screen flex-col bg-[var(--surface-bg)] text-[var(--text-main)]">
        <header className="alliance-navbar sticky top-0 z-10 border-b border-[var(--border-color)]">
          <div className="mx-auto flex h-[var(--header-h)] w-full max-w-3xl items-center px-5 sm:px-8">
            <span className="flex items-center gap-2 font-display text-base font-extrabold tracking-tight text-[var(--alliance-navy)]">
              <span
                aria-hidden
                className="flex h-7 w-7 items-center justify-center rounded-[8px] text-xs font-extrabold text-white"
                style={{ background: 'var(--hero-gradient)' }}
              >
                US
              </span>
              US Tow AI-Connect
            </span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8 sm:px-8 sm:py-10">
          {children}
        </main>

        <div className="mx-auto w-full max-w-3xl px-5 pb-8 sm:px-8">
          <PoweredByFooter />
        </div>
      </div>
    </BrandingProvider>
  );
}
