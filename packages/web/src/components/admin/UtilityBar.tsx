'use client';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/icons';
import { useBranding } from '@/components/branding/BrandingProvider';
import { api } from '@/lib/utils';
import { getActiveTenantId, getActiveTenantName, setActiveTenant } from '@/lib/active-tenant';
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

interface SwitchableTenant {
  id: string;
  companyName: string;
  role: string;
  isMember: boolean;
}

/**
 * Session 79 — a real tenant switcher.
 *
 * Was a "coming soon" stub since Session 47: a chevron with no onClick. Chris
 * runs four businesses through one login, so flipping between them was the
 * whole point of building this multi-tenant in the first place.
 *
 * On switch we take a NEW token from the API and store it together with the
 * tenant id, then hard-reload. The reload is deliberate rather than lazy —
 * every admin page holds fetched state for the old tenant, and re-rendering in
 * place would leave one tenant's jobs on screen under another's name until
 * each page happened to refetch.
 */
function TenantSwitcher() {
  const { branding } = useBranding();
  const [open, setOpen] = useState(false);
  const [tenants, setTenants] = useState<SwitchableTenant[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveId(getActiveTenantId());
  }, []);

  // Close on an outside click or Escape — a menu that only closes by
  // re-clicking the trigger feels broken.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const load = useCallback(async () => {
    try {
      const res = await api<{ tenants: SwitchableTenant[] }>('/v1/auth/my-tenants');
      setTenants(res.tenants ?? []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
      setTenants([]);
    }
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && tenants === null) void load();
  };

  const switchTo = async (tenant: SwitchableTenant) => {
    if (tenant.id === activeId) {
      setOpen(false);
      return;
    }
    setBusy(tenant.id);
    setError(null);
    try {
      const res = await api<{ access_token: string; tenant: { id: string; companyName: string } }>(
        '/v1/auth/switch-tenant',
        { method: 'POST', json: { tenantId: tenant.id } },
      );
      setActiveTenant(res.tenant.id, res.tenant.companyName, res.access_token);
      // Full reload, not a router push — see the note above.
      window.location.href = '/admin/command-center';
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  const label = getActiveTenantName() || branding.companyDisplayName || 'US Tow AI-Connect';

  return (
    <div className="relative hidden md:block" ref={boxRef}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Current account: ${label}. Switch account.`}
        className="flex items-center gap-2 rounded-[10px] border border-[var(--border-color)] bg-[var(--surface-card)] px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-low)] hover:text-[var(--text-main)]"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-[var(--alliance-navy)] font-display text-[10px] font-bold text-white">
          {label[0]?.toUpperCase()}
        </span>
        <span className="max-w-[10rem] truncate">{label}</span>
        <Icon name="chevron-down" size={14} className="text-[var(--text-muted)]" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-[10px] border border-[var(--border-color)] bg-[var(--surface-card)] shadow-lg"
        >
          <div className="border-b border-[var(--border-color)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Switch account
          </div>

          {tenants === null && (
            <div className="px-3 py-3 text-sm text-[var(--text-muted)]">Loading…</div>
          )}

          {tenants !== null && tenants.length === 0 && !error && (
            <div className="px-3 py-3 text-sm text-[var(--text-muted)]">
              No other accounts available.
            </div>
          )}

          {tenants?.map((t) => {
            const isActive = t.id === activeId;
            return (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                disabled={busy !== null}
                onClick={() => void switchTo(t)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors disabled:opacity-50 ${
                  isActive
                    ? 'bg-[var(--surface-low)] text-[var(--text-main)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-low)] hover:text-[var(--text-main)]'
                }`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[var(--alliance-navy)] font-display text-[10px] font-bold text-white">
                  {t.companyName[0]?.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">{t.companyName}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  {busy === t.id ? 'switching…' : isActive ? 'current' : t.role}
                </span>
              </button>
            );
          })}

          {error && (
            <div className="border-t border-[var(--border-color)] px-3 py-2 text-xs text-[var(--danger,#e11d48)]">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
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
