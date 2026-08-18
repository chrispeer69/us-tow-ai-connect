import React from 'react';
import type { Metadata, Viewport } from 'next';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

/**
 * Session 77 — the phone shell.
 *
 * Deliberately NOT nested under /admin. The admin layout carries a TopBar, a
 * UtilityBar and a Sidebar, which is the right chrome for a desk and the wrong
 * chrome for a phone held one-handed on the sofa at 9pm. This shell is the
 * auth check and nothing else, so the page gets the whole screen.
 *
 * Auth still comes from the same place — ProtectedRoute reads the same token
 * the admin app stores — so signing in on the phone once is enough and there is
 * no second credential to manage.
 */
export const metadata: Metadata = {
  title: 'Flip Activity',
  // A monitoring screen has no business in search results.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#050a18',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  // Do NOT lock zoom. Pinching to read a shop name is a reasonable thing to
  // want to do, and maximumScale:1 is an accessibility failure, not a polish
  // detail.
  viewportFit: 'cover',
};

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-[var(--surface-bg)] text-[var(--text-main)] antialiased">
        {children}
      </div>
    </ProtectedRoute>
  );
}
