import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body className="antialiased bg-zinc-950 text-zinc-50">
        {children}
      </body>
    </html>
  );
}
