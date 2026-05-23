import type { Metadata } from "next";
import { Inter, Manrope, Work_Sans } from "next/font/google";
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

export const metadata: Metadata = {
  title: "US Tow AI-Connect Admin",
  description: "Middleware connector admin dashboard",
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
