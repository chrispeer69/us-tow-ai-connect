"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const GA_ID = "G-L1JYXLVG05";

// Public marketing pages only. Logged-in and customer pages (/m, /admin,
// /driver, /track/[token] …) show customer names and phone numbers and
// would mix staff traffic into visitor numbers, so they are never tracked.
const PUBLIC_PREFIXES = [
  "/privacy",
  "/terms",
  "/schedule-demo",
  "/demo",
  "/inquire-shares",
  "/sign-in",
  "/sign-up",
];

export function isTrackedPath(path: string): boolean {
  return path === "/" || PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

declare global {
  interface Window {
    [key: `ga-disable-${string}`]: boolean | undefined;
  }
}

export function GoogleAnalytics() {
  const pathname = usePathname() ?? "/";
  const tracked = isTrackedPath(pathname);

  // The script stays loaded across client-side navigation, and GA's
  // enhanced measurement counts those navigations as page views — so it
  // would follow a visitor into /m or /admin. GA's opt-out flag stops every
  // hit while on an untracked page.
  useEffect(() => {
    window[`ga-disable-${GA_ID}`] = !tracked;
  }, [tracked]);

  if (!tracked) return null;

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
      </Script>
    </>
  );
}
