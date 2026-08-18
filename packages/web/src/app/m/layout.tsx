import React from 'react';
import type { Metadata, Viewport } from 'next';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

/**
 * Session 77 — the phone shell.
 *
 * Deliberately NOT nested under /admin. That layout carries a TopBar, a
 * UtilityBar and a Sidebar, which is the right chrome for a desk and the wrong
 * chrome for a phone held one-handed on the sofa at 9pm. This shell is the auth
 * check and nothing else, so the page gets the whole screen.
 *
 * THEME: the dark palette lives in `.dark { }` (globals.css) and
 * `[data-theme='dark'] { }` (design-tokens.css), and nothing in the tree sets
 * either on this route — so the first build rendered on a white background with
 * every colour washed out, because the page was written for a dark surface.
 *
 * Both hooks are set here explicitly, AND the page itself uses literal colours
 * rather than theme variables. Belt and braces on purpose: this screen is
 * checked in the dark at a glance, and "it renders, but you cannot read it" is a
 * failure that looks like success in a screenshot.
 */
export const metadata: Metadata = {
  title: 'Flip Activity',
  robots: { index: false, follow: false },
  // manifest + appleWebApp live on the PAGE, not here: a nested layout's
  // `manifest` loses to the root layout's and never reaches the HTML. See
  // m/flip/page.tsx.
};

export const viewport: Viewport = {
  themeColor: '#050a18',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  // Zoom stays unlocked. Pinching to read a shop name is reasonable, and
  // maximumScale:1 is an accessibility failure rather than a polish detail.
  viewportFit: 'cover',
};

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <div
        className="dark min-h-screen bg-[#050a18] text-white antialiased"
        data-theme="dark"
        style={{ colorScheme: 'dark' }}
      >
        {children}
      </div>
    </ProtectedRoute>
  );
}
