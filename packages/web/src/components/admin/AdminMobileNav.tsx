'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icons';
import { useBranding } from '@/components/branding/BrandingProvider';
import { NAV_GROUPS, isActiveHref } from './nav-config';
import { SidebarFooter } from './Sidebar';

/**
 * Mobile admin navigation (Session 47). A hamburger button (shown below `lg`,
 * where the desktop Sidebar is hidden) opens a left slide-in drawer with the
 * same grouped nav. Closes on route change, backdrop click, or Escape. Shares
 * nav-config + SidebarFooter with the desktop Sidebar.
 */
export function AdminMobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { branding } = useBranding();

  // Close on navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock scroll + Escape-to-close while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border-color)] bg-[var(--surface-card)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-low)] hover:text-[var(--text-main)]"
      >
        <Icon name="menu" size={20} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* backdrop */}
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          {/* drawer */}
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col border-r border-[var(--border-color)] bg-[var(--surface-card)] shadow-[var(--shadow-md)]">
            <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-3">
              <span className="font-display text-sm font-extrabold text-[var(--text-main)]">
                {branding.companyDisplayName || 'US Tow AI-Connect'}
              </span>
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-low)] hover:text-[var(--text-main)]"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
              {NAV_GROUPS.map((group) => (
                <div key={group.title} className="flex flex-col gap-1">
                  <div className="px-3 pb-1 font-label text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {group.title}
                  </div>
                  {group.items.map((item) => {
                    const active = isActiveHref(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-[10px] border-l-2 px-3 py-2 text-sm transition-colors',
                          active
                            ? 'border-[var(--alliance-blue)] bg-[var(--surface)] font-semibold text-[var(--alliance-blue)]'
                            : 'border-transparent font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-low)] hover:text-[var(--text-main)]',
                        )}
                      >
                        <Icon name={item.icon} size={18} className={cn('shrink-0', active ? 'opacity-100' : 'opacity-70')} />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              ))}
              <SidebarFooter tenantName={branding.companyDisplayName} />
            </nav>
          </aside>
        </div>
      )}
    </div>
  );
}
