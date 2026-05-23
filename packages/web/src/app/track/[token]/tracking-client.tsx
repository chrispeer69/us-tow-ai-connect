'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { TrackingMap } from './tracking-map';

interface TrackingView {
  caller_name: string | null;
  status: string;
  assigned_driver_name: string | null;
  last_eta_minutes: number | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  driver_lat: number | null;
  driver_lng: number | null;
  expires_at: string;
  expired: boolean;
  caller_phone_last4: string | null;
}

const REFRESH_MS = 10_000;
const DISPATCH_PHONE = '+17408129489';

const STATUS_LABEL: Record<string, string> = {
  created: 'Request received',
  driver_assigned: 'Driver assigned',
  en_route: 'Driver en route',
  on_scene: 'On scene',
  completed: 'Completed',
  expired: 'Link expired',
};

const STATUS_COLOR: Record<string, string> = {
  created: 'bg-slate-500',
  driver_assigned: 'bg-blue-500',
  en_route: 'bg-indigo-500',
  on_scene: 'bg-amber-500',
  completed: 'bg-emerald-500',
  expired: 'bg-zinc-600',
};

export function TrackingClient({ token }: { token: string }) {
  const [view, setView] = useState<TrackingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/v1/tracking/${token}`, { cache: 'no-store' });
      if (res.status === 404) {
        setError('not_found');
        setView(null);
        return;
      }
      if (!res.ok) {
        setError('fetch_failed');
        return;
      }
      const json = (await res.json()) as { status: string; data?: TrackingView };
      if (json.data) {
        setView(json.data);
        setError(null);
      }
    } catch {
      setError('network');
    } finally {
      setLoading(false);
    }
  }, [apiBase, token]);

  useEffect(() => {
    fetchOnce();
    const id = setInterval(fetchOnce, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchOnce]);

  const statusKey = view?.status ?? 'created';
  const label = STATUS_LABEL[statusKey] ?? statusKey;
  const color = STATUS_COLOR[statusKey] ?? 'bg-slate-500';

  const expired = view?.expired || statusKey === 'expired';

  const greeting = useMemo(() => {
    if (!view?.caller_name) return 'Your tow';
    const first = view.caller_name.split(' ')[0];
    return `Hi ${first}`;
  }, [view?.caller_name]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 p-6">
        <p className="text-sm text-zinc-400">Loading your tracking page…</p>
      </main>
    );
  }

  if (error === 'not_found') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 p-6">
        <div className="max-w-sm text-center">
          <p className="text-2xl font-semibold">Tracking link not found</p>
          <p className="mt-3 text-sm text-zinc-400">
            This link may have expired or never existed. Call dispatch for an update.
          </p>
          <a
            href={`tel:${DISPATCH_PHONE}`}
            className="mt-6 inline-flex items-center justify-center rounded-full bg-emerald-500 px-6 py-3 font-semibold text-emerald-950"
          >
            Call dispatch
          </a>
        </div>
      </main>
    );
  }

  if (expired) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-zinc-950 text-zinc-100 p-6">
        <div className="max-w-sm text-center">
          <p className="text-2xl font-semibold">Link expired</p>
          <p className="mt-3 text-sm text-zinc-400">
            This tracking page is no longer active. If you still need help, please call dispatch.
          </p>
          <a
            href={`tel:${DISPATCH_PHONE}`}
            className="mt-6 inline-flex items-center justify-center rounded-full bg-emerald-500 px-6 py-3 font-semibold text-emerald-950"
          >
            Call dispatch
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 pt-6 pb-32">
        <header className="flex flex-col items-start gap-2">
          <p className="text-xs uppercase tracking-widest text-zinc-500">Roadside Towing</p>
          <h1 className="text-2xl font-semibold">{greeting}, your tow is in progress.</h1>
        </header>

        <section
          className={`rounded-2xl p-5 text-white ${color}`}
          aria-label="Current status"
        >
          <p className="text-xs uppercase tracking-widest opacity-80">Status</p>
          <p className="mt-1 text-2xl font-semibold">{label}</p>
          {view?.last_eta_minutes != null && (
            <p className="mt-3 text-sm opacity-90">
              ETA: <span className="font-semibold">{view.last_eta_minutes} min</span>
            </p>
          )}
        </section>

        <section className="rounded-2xl bg-zinc-900/80 ring-1 ring-zinc-800 overflow-hidden">
          <div className="h-72 w-full">
            <TrackingMap
              pickupLat={view?.pickup_lat ?? null}
              pickupLng={view?.pickup_lng ?? null}
              driverLat={view?.driver_lat ?? null}
              driverLng={view?.driver_lng ?? null}
            />
          </div>
          <div className="p-4 flex items-center gap-3 text-sm">
            <div className="h-10 w-10 rounded-full bg-zinc-700 flex items-center justify-center font-semibold">
              {view?.assigned_driver_name
                ? view.assigned_driver_name
                    .split(' ')
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()
                : '—'}
            </div>
            <div>
              <p className="font-medium">
                {view?.assigned_driver_name ?? 'Assigning a driver…'}
              </p>
              <p className="text-xs text-zinc-400">
                {view?.driver_lat != null && view?.driver_lng != null
                  ? 'Live location updating'
                  : 'Driver location will appear here once en route'}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-zinc-900/60 ring-1 ring-zinc-800 p-4 text-xs text-zinc-400">
          <p>
            This page refreshes every 10 seconds. If something looks off, reply STOP to the SMS to
            opt out, or call dispatch.
          </p>
        </section>
      </div>

      <a
        href={`tel:${DISPATCH_PHONE}`}
        className="fixed inset-x-0 bottom-0 z-10 bg-emerald-500 px-4 py-4 text-center font-semibold text-emerald-950"
      >
        Call dispatch · {DISPATCH_PHONE.replace('+1', '')}
      </a>
    </main>
  );
}
