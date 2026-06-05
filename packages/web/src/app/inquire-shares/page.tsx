import Link from 'next/link';
import { Phone } from 'lucide-react';
import { InquireSharesClient } from './InquireSharesClient';

export const metadata = {
  title: 'Inquire About Purchasing Shares · US Tow AI-Connect',
  description:
    'Tell us about your towing business and your interest in becoming a US Tow AI-Connect shareholder. A note from Chris Peer, founder of Blue Collar AI and the US Tow Alliance.',
};

export default function InquireSharesPage() {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <header className="border-b border-border sticky top-0 z-30 bg-background/70 backdrop-blur-xl">
        <div className="container flex items-center justify-between h-16 lg:h-20">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Phone className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-bold text-base leading-tight tracking-tight">
                US Tow AI-Connect
              </div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-blue-400 font-medium">
                By Blue Collar AI
              </div>
            </div>
          </Link>
          <Link
            href="/"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to home
          </Link>
        </div>
      </header>

      <main className="relative py-16 lg:py-24 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-background to-blue-500/10"></div>
          <div className="absolute inset-0 bg-grid opacity-15"></div>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-cyan-500/15 rounded-full blur-3xl"></div>
        </div>
        <div className="container relative z-10">
          <InquireSharesClient />
        </div>
      </main>
    </div>
  );
}
