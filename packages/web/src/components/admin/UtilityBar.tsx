'use client';
import { Fragment, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/icons';
import { useBranding } from '@/components/branding/BrandingProvider';
import { AdminMobileNav } from './AdminMobileNav';
import { NAV_LABELS } from './nav-config';

/**
 * Admin contextual utility bar (Session 47). Sits under the global TopBar
 * (which is additive-only / not owned by this session) and carries the task-4
 * features: breadcrumbs, a Cmd+K search affordance, a notifications bell, and a
 * tenant-switcher — plus the mobile hamburger that opens AdminMobileNav. The
 * search / bell / switcher are wired placeholders (no backend yet); each is
 * labelled so it reads as intentional, not broken.
 */
function titleize(segment: string): string {
  return segment.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Breadcrumbs() {
  const pathname = usePathname() ?? '/admin';
  const segments = pathname.split('/').filter(Boolean); // ['admin', 'calls', ...]
  const crumbs = segments.map((seg, i) => {
    const href = '/' + segments.slice(0, i + 1).join('/');
    const label = seg === 'admin' ? 'Admin' : (NAV_LABELS[href] ?? titleize(seg));
    return { href, label, last: i === segments.length - 1 };
  });

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      {crumbs.map((c) => (
        <Fragment key={c.href}>
          {c.last ? (
            <span className="truncate font-semibold text-[var(--text-main)]" aria-current="page">
              {c.label}
            </span>
          ) : (
            <>
              <Link
                href={c.href}
                className="truncate text-[var(--text-secondary)] transition-colors hover:text-[var(--text-main)]"
              >
                {c.label}
              </Link>
              <Icon name="chevron-right" size={14} className="shrink-0 text-[var(--text-muted)]" />
            </>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

function CommandSearch() {
  const ref = useRef<HTMLButtonElement>(null);
  // Cmd/Ctrl+K focuses the affordance. Full palette is a follow-up (placeholder).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <button
      ref={ref}
      type="button"
      aria-label="Search (Command-K) — coming soon"
      title="Search — coming soon"
      className="hidden items-center gap-2 rounded-[10px] border border-[var(--border-color)] bg-[var(--surface-bg)] px-3 py-1.5 text-sm text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)] sm:flex"
    >
      <Icon name="search" size={15} />
      <span>Search…</span>
      <kbd className="ml-2 rounded border border-[var(--border-color)] px-1.5 py-0.5 font-label text-[10px] font-semibold tracking-wide text-[var(--text-muted)]">
        ⌘K
      </kbd>
    </button>
  );
}

function NotificationsBell() {
  return (
    <button
      type="button"
      aria-label="Notifications — coming soon"
      title="Notifications — coming soon"
      className="relative flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border-color)] bg-[var(--surface-card)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-low)] hover:text-[var(--text-main)]"
    >
      <Icon name="bell" size={18} />
      <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[var(--alliance-amber)]" aria-hidden />
    </button>
  );
}

function TenantSwitcher() {
  const { branding } = useBranding();
  return (
    <button
      type="button"
      aria-label="Switch tenant — coming soon"
      title="Tenant switcher — coming soon"
      className="hidden items-center gap-2 rounded-[10px] border border-[var(--border-color)] bg-[var(--surface-card)] px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-low)] hover:text-[var(--text-main)] md:flex"
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-[var(--alliance-navy)] font-display text-[10px] font-bold text-white">
        {(branding.companyDisplayName || 'US')[0]?.toUpperCase()}
      </span>
      <span className="max-w-[10rem] truncate">{branding.companyDisplayName || 'US Tow AI-Connect'}</span>
      <Icon name="chevron-down" size={14} className="text-[var(--text-muted)]" />
    </button>
  );
}

export function UtilityBar() {
  return (
    <div className="border-b border-[var(--border-color)] bg-[var(--surface-card)]/60">
      <div className="mx-auto flex w-full max-w-container items-center justify-between gap-3 px-5 py-2.5 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <AdminMobileNav />
          <Breadcrumbs />
        </div>
        <div className="flex items-center gap-2">
          <CommandSearch />
          <TenantSwitcher />
          <NotificationsBell />
        </div>
      </div>
    </div>
  );
}
