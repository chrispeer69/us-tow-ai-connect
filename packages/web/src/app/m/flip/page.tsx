import type { Metadata } from 'next';
import FlipBoard from './FlipBoard';

/**
 * Server component wrapper, and it exists for one reason: the manifest.
 *
 * The site manifest has `start_url: '/'`, so an Android home-screen icon opens
 * the MARKETING page no matter which page it was added from — exactly what
 * happened on 2026-08-18 ("hitting the ai connect web app icon it takes me
 * www.ustowaiconnect.com"). The board needs its own manifest with
 * `start_url: '/m/flip'`.
 *
 * Declaring that on the /m layout did NOT work — the root layout's `manifest`
 * won and the built HTML still carried `/manifest.webmanifest`. It has to be
 * declared on the page, and a page can only export metadata if it is a server
 * component, which is why the board itself moved to FlipBoard.tsx.
 */
export const metadata: Metadata = {
  title: 'Flip Activity',
  robots: { index: false, follow: false },
  manifest: '/flip-manifest.json',
  // iOS ignores the manifest for standalone mode and reads these instead.
  // Without them the icon opens inside Safari with the address bar and tab
  // chrome, which costs about a fifth of the viewport on a monitoring screen.
  appleWebApp: {
    capable: true,
    title: 'Flips',
    statusBarStyle: 'black-translucent',
  },
};

export default function MobileFlipActivityPage() {
  return <FlipBoard />;
}
