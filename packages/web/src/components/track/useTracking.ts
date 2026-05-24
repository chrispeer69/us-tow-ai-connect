'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_BRANDING, mergeBranding, type TrackBranding, type TrackingView } from './types';

const REFRESH_MS = 30_000; // S43_DECISIONS.md D5 — spec cadence (was 10s).

export type TrackPhase = 'loading' | 'ready' | 'notfound' | 'error';

interface TrackState {
  view: TrackingView | null;
  branding: TrackBranding;
  phase: TrackPhase;
  /** ms since epoch of the last successful tracking fetch (drives "updated Xs ago"). */
  updatedAt: number | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

/**
 * Fetches the public tracking view on a 30s cadence and resolves tenant
 * branding once — inline (`data.branding`) if the API sends it, else via the
 * public branding endpoint when `data.tenant_id` is present, else neutral
 * defaults. Branding fetch is best-effort and never blocks the page.
 */
export function useTracking(token: string): TrackState {
  const [view, setView] = useState<TrackingView | null>(null);
  const [branding, setBranding] = useState<TrackBranding>(DEFAULT_BRANDING);
  const [phase, setPhase] = useState<TrackPhase>('loading');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // Resolve branding at most once per tenant id.
  const brandedTenant = useRef<string | null>(null);

  const resolveBranding = useCallback((data: TrackingView) => {
    if (data.branding) {
      setBranding(mergeBranding(data.branding));
      return;
    }
    const tenantId = data.tenant_id;
    if (!tenantId || brandedTenant.current === tenantId) return;
    brandedTenant.current = tenantId;
    fetch(`${API_BASE}/branding/public/${tenantId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (b) setBranding(mergeBranding(b));
      })
      .catch(() => {
        /* branding is non-critical — keep defaults */
      });
  }, []);

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/tracking/${token}`, { cache: 'no-store' });
      if (res.status === 404) {
        setPhase('notfound');
        return;
      }
      if (!res.ok) {
        // Keep last good view on transient errors; only hard-fail the first load.
        setPhase((p) => (p === 'loading' ? 'error' : p));
        return;
      }
      const json = (await res.json()) as { status: string; data?: TrackingView };
      if (json.data) {
        setView(json.data);
        setUpdatedAt(Date.now());
        setPhase('ready');
        resolveBranding(json.data);
      }
    } catch {
      setPhase((p) => (p === 'loading' ? 'error' : p));
    }
  }, [token, resolveBranding]);

  useEffect(() => {
    fetchOnce();
    const id = setInterval(fetchOnce, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchOnce]);

  return { view, branding, phase, updatedAt };
}
