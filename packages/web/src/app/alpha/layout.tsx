import React from 'react';
import type { Viewport } from 'next';

/**
 * Dark shell for the Alpha crash-lead boards, same reason as /m/layout.tsx.
 *
 * Nothing under /alpha set `.dark` / `data-theme="dark"`, so the body fell
 * back to design-tokens.css's `:root` surface (#faf8ff, lavender-white) in
 * some browsers. Every card in AlphaFlipsBoard / LastWeekBoard is written for
 * a dark surface with translucent fills — on white, the "interested" card
 * became a pale pink box with white text on it and the name was unreadable
 * (reported 2026-09-16). Force the surface here so the boards never depend
 * on which theme the rest of the site happens to be in.
 */
export const viewport: Viewport = {
  themeColor: '#1c1917',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function AlphaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="dark min-h-screen bg-[#1c1917] text-white antialiased"
      data-theme="dark"
      style={{ colorScheme: 'dark' }}
    >
      {children}
    </div>
  );
}
