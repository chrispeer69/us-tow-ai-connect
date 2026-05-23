'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS: Array<{ href: string; label: string; icon: string }> = [
  { href: '/driver', label: 'Home', icon: '🏠' },
  { href: '/driver/map', label: 'Map', icon: '🗺️' },
  { href: '/driver/history', label: 'History', icon: '📜' },
  { href: '/driver/profile', label: 'Profile', icon: '👤' },
];

/**
 * Fixed bottom nav — four destinations, big tap targets.
 * The home tab matches `/driver` exactly so nested routes don't keep it lit.
 */
export function BottomNav() {
  const path = usePathname();
  return (
    <nav
      className="sticky bottom-0 z-20 grid grid-cols-4 border-t border-zinc-800 bg-zinc-900"
      data-testid="bottom-nav"
    >
      {TABS.map((t) => {
        const active = t.href === '/driver' ? path === '/driver' : path?.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              'flex flex-col items-center justify-center py-2 text-xs ' +
              (active ? 'text-emerald-400' : 'text-zinc-400 hover:text-zinc-200')
            }
          >
            <span className="text-xl leading-none mb-0.5" aria-hidden>
              {t.icon}
            </span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
