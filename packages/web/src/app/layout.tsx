import type { Metadata, Viewport } from "next";
import { Inter, Manrope, Work_Sans } from "next/font/google";
import { AuthProvider } from "@/contexts/AuthContext";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-body",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const workSans = Work_Sans({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-label",
  display: "swap",
});

const SITE_URL = "https://www.ustowaiconnect.com";
const OG_IMAGE =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663488671835/dJzLf9wtAEeniEd3UAXpws/hero-tow-truck-macBb8UmfLLz7b6LWEeMd3.webp";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Plain string default (no title.template): every sub-page already
  // self-brands with "· US Tow AI-Connect", so a template here would
  // double-brand them ("Privacy · US Tow AI-Connect | US Tow AI-Connect").
  title: "US Tow AI-Connect | 24/7 AI Dispatcher for Towing Companies",
  description:
    "AI-Connect answers every inbound towing call 24/7 and makes outbound sales calls that confirm jobs, refer repair shops, and grow your dispatch revenue.",
  applicationName: "US Tow AI-Connect",
  keywords: [
    "AI dispatcher",
    "towing software",
    "AI phone answering",
    "tow dispatch automation",
    "TowPilot alternative",
    "roadside assistance AI",
  ],
  authors: [{ name: "Blue Collar AI" }],
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "US Tow AI-Connect",
    title: "US Tow AI-Connect | 24/7 AI Dispatcher for Towing Companies",
    description:
      "AI-Connect answers every inbound towing call 24/7 and makes outbound sales calls that confirm jobs, refer repair shops, and grow your dispatch revenue.",
    locale: "en_US",
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "US Tow AI-Connect — the 24/7 AI dispatcher for towing companies",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "US Tow AI-Connect | 24/7 AI Dispatcher for Towing Companies",
    description:
      "AI-Connect answers every inbound towing call 24/7 and makes outbound sales calls that confirm jobs, refer repair shops, and grow your dispatch revenue.",
    images: [OG_IMAGE],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0a0e1a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${manrope.variable} ${workSans.variable}`}
    >
      <body className="antialiased">
        {/* Accessibility: keyboard/screen-reader users can jump past the nav */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
        >
          Skip to main content
        </a>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
