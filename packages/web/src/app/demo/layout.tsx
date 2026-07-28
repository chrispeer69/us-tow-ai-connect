import type { Metadata } from "next";

// demo/page.tsx is a client component and can't export metadata itself,
// so this server layout supplies it.
//
// openGraph/twitter are declared in full here rather than inherited: Next
// replaces (does not deep-merge) these objects when a child route defines
// them, so omitting `images` would leave the shared /demo link previewing
// without a card image on LinkedIn, X and most email clients.
const SITE_URL = "https://www.ustowaiconnect.com";
const OG_IMAGE =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663488671835/dJzLf9wtAEeniEd3UAXpws/hero-tow-truck-macBb8UmfLLz7b6LWEeMd3.webp";

const TITLE = "Interactive Demo · US Tow AI-Connect";
const DESCRIPTION =
  "Take the 3-minute guided tour of the AI command center: how jobs are pulled out of your dispatch software, how the AI call redirects a tow to your own repair shop, and the guardrails that decide when it stays quiet.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/demo" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/demo`,
    siteName: "US Tow AI-Connect",
    type: "website",
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "US Tow AI-Connect interactive demo — the AI dispatch command center",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
