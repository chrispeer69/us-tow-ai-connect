import type { Metadata } from 'next';
import AlphaFlipsBoard from './AlphaFlipsBoard';

/**
 * Server component wrapper, same reason as /m/flip/page.tsx: the root
 * layout's manifest has `start_url: '/'`, so this page needs its own
 * manifest declared here (a page can only export metadata as a server
 * component) or a home-screen icon added from here would reopen the
 * marketing site instead.
 */
export const metadata: Metadata = {
  title: 'Alpha Crash Leads',
  robots: { index: false, follow: false },
  manifest: '/alpha-flips-manifest.json',
  icons: {
    icon: [{ url: '/alpha-flips-icon.svg', type: 'image/svg+xml' }],
    apple: '/alpha-flips-icon.svg',
  },
  // iOS ignores the manifest for standalone/home-screen mode and reads these
  // instead — without them the icon opens inside Safari with browser chrome.
  appleWebApp: {
    capable: true,
    title: 'Crash Leads',
    statusBarStyle: 'black-translucent',
  },
};

export default function AlphaFlipsPage() {
  return <AlphaFlipsBoard />;
}
