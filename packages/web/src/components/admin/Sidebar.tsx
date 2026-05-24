'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icons';
import { useBranding } from '@/components/branding/BrandingProvider';
import { NAV_GROUPS, isActiveHref } from './nav-config';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'v0.1.0';

/**
 * Desktop admin sidebar (Session 47 polish). Grouped nav with per-item icons,
 * a left-border accent + bold weight on the active route, subtle hover bg, and
 * a footer crediting Blue Collar AI with the build version + tenant name. The
 * mobile equivalent is AdminMobileNav (drawer), sharing nav-config so the two
 * never drift.
 */
export function Sidebar() {
  const pathname = usePathname();
  const { branding } = useBranding();
  return (
    <aside className="hidden w-64 shrink-0 border-r border-[var(--border-color)] bg-[var(--surface-card)] lg:flex lg:flex-col">
      <nav className="sticky top-[70px] flex max-h-[calc(100vh-70px)] flex-col gap-6 overflow-y-auto p-5">
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
                  <Icon
                    name={item.icon}
                    size={18}
                    className={cn('shrink-0', active ? 'opacity-100' : 'opacity-70')}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}

        <SidebarFooter tenantName={branding.companyDisplayName} />
      </nav>
    </aside>
  );
}

export function SidebarFooter({ tenantName }: { tenantName?: string | null }) {
  return (
    <div className="mt-auto flex flex-col gap-1 border-t border-[var(--border-color)] px-3 pt-4 pb-1">
      <span className="font-label text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
        Powered by Blue Collar AI
      </span>
      <span className="text-[11px] text-[var(--text-secondary)]">
        {tenantName ? `${tenantName} · ` : ''}
        {APP_VERSION}
      </span>
    </div>
  );
}
