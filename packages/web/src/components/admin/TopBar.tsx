'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useBranding } from '@/components/branding/BrandingProvider';

const QUICK_NAV = [
  { href: '/admin/command-center', label: 'Command Center' },
  { href: '/admin/digital-dispatch', label: 'Dispatch' },
  { href: '/admin/integrations', label: 'Integrations' },
  { href: '/admin/knowledge-pack', label: 'Knowledge' },
];

function ShieldMark() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0"
      aria-hidden
    >
      <path
        d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z"
        fill="var(--brand-primary)"
        opacity="0.16"
      />
      <path
        d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z"
        stroke="var(--brand-primary)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m8.5 12 2.2 2.3L15.5 9.5"
        stroke="var(--brand-primary)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const { branding } = useBranding();
  return (
    <header className="alliance-navbar sticky top-0 z-40 border-b border-[var(--border-color)]">
      <div className="mx-auto flex h-[70px] max-w-container items-center justify-between gap-4 px-5 sm:px-6">
        {/* logo left */}
        <Link href="/admin/command-center" className="flex items-center gap-2.5">
          <ShieldMark />
          <span className="flex flex-col leading-none">
            <span className="font-display text-[15px] font-extrabold tracking-tight text-[var(--text-main)]">
              {branding.companyDisplayName || 'US Tow AI-Connect'}
            </span>
            <span className="font-label text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-muted)]">
              Admin Console
            </span>
          </span>
        </Link>

        {/* nav middle */}
        <nav className="hidden items-center gap-1 md:flex">
          {QUICK_NAV.map((item) => {
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-[var(--surface)] text-[var(--alliance-blue)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-low)] hover:text-[var(--text-main)]',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* account right */}
        <div className="flex items-center gap-3">
          <span className="hidden font-label text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)] lg:inline">
            Powered by Blue Collar AI
          </span>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--alliance-navy)] font-display text-sm font-bold text-white">
            A
          </div>
        </div>
      </div>
    </header>
  );
}
