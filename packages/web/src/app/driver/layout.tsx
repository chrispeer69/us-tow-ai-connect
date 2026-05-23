import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Roadside Driver',
  description: 'On-the-road driver app for US Tow AI-Connect',
  manifest: '/driver-manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Roadside Driver',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0f172a',
};

/**
 * Driver-app shell. Deliberately separate from `/admin/**`:
 * - Mobile-first viewport, no sidebar chrome.
 * - Centered to 480px on desktop for thumbnail / kiosk previews.
 * - PWA manifest + iOS standalone meta wired here.
 */
export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <div className="mx-auto w-full max-w-[480px] min-h-screen flex flex-col bg-zinc-900 shadow-2xl">
        {children}
      </div>
      {/* PWA registration runs once; failure is non-fatal (e.g. in dev). */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            if ('serviceWorker' in navigator && location.protocol === 'https:') {
              window.addEventListener('load', function () {
                navigator.serviceWorker.register('/driver-sw.js').catch(function () {});
              });
            }
          `,
        }}
      />
    </div>
  );
}
