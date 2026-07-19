import type { Metadata } from "next";
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
  title: {
    default: "US Tow AI-Connect | 24/7 AI Dispatcher for Towing Companies",
    template: "%s | US Tow AI-Connect",
  },
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
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
