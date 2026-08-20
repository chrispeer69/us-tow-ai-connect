'use client';

import { useEffect, useState } from 'react';
import { api } from './utils';
import { getActiveTenantId } from './active-tenant';
import type { ConsoleProfile } from '@/components/admin/nav-config';

const CACHE_KEY = 'console_profile';

/**
 * Which console the current tenant should see.
 *
 * Session 79. Returns 'full' immediately and only ever narrows the nav once the
 * server has confirmed the tenant is a campaign one. That ordering is
 * deliberate: an optimistic 'campaign' guess would blank half the sidebar of a
 * towing operator for a few hundred milliseconds on every page load, and a nav
 * that flickers items away looks like a bug even when it settles correctly.
 *
 * Cached in localStorage so the narrowing happens on the first paint after a
 * switch rather than after a round trip. The cache is keyed by tenant, so a
 * switch cannot leave the previous tenant's console behind.
 */
export function useConsoleProfile(): ConsoleProfile {
  const [profile, setProfile] = useState<ConsoleProfile>('full');

  useEffect(() => {
    const tenantId = getActiveTenantId();

    // Serve the cache first so the sidebar is right on the first paint.
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as { tenantId: string; profile: ConsoleProfile };
        if (cached.tenantId === tenantId) setProfile(cached.profile);
      }
    } catch {
      // A corrupt cache is not worth handling — the fetch below replaces it.
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await api<{
          tenants: Array<{ id: string; consoleProfile?: ConsoleProfile }>;
        }>('/v1/auth/my-tenants');
        const mine = res.tenants?.find((t) => t.id === tenantId);
        const next: ConsoleProfile = mine?.consoleProfile === 'campaign' ? 'campaign' : 'full';
        if (cancelled) return;
        setProfile(next);
        window.localStorage.setItem(CACHE_KEY, JSON.stringify({ tenantId, profile: next }));
      } catch {
        // Unreachable API, expired token, anything — stay on the full console.
        // Showing every page is a strictly safer failure than hiding pages
        // somebody needs, and this hook must never be able to lock a towing
        // operator out of their dispatch board.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return profile;
}
