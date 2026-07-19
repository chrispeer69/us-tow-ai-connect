import type { Metadata } from "next";

// demo/page.tsx is a client component and can't export metadata itself,
// so this server layout supplies it.
export const metadata: Metadata = {
  title: "Interactive Demo · US Tow AI-Connect",
  description:
    "Explore US Tow AI-Connect live: the AI command center, inbound call handling, and the outbound flip engine that refers repair shops and grows revenue.",
  alternates: { canonical: "/demo" },
  openGraph: {
    title: "Interactive Demo · US Tow AI-Connect",
    description:
      "Explore US Tow AI-Connect live: the AI command center, inbound call handling, and the outbound flip engine that refers repair shops and grows revenue.",
    url: "https://www.ustowaiconnect.com/demo",
    type: "website",
  },
};

export default function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
