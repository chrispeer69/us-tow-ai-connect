'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { TopBar } from './_components/TopBar';
import { BottomNav } from './_components/BottomNav';
import { JobCard } from './_components/JobCard';
import { Geolocator, type GeoSample } from './_components/Geolocator';
import {
  actionLabel,
  driverApi,
  loadProfile,
  type DriverJob,
  type DriverJobAction,
} from './_lib/driver-api';
import { enablePush, getPushState, type PushState } from './_lib/push-client';

interface ApiJobResp {
  status: string;
  data: { job: DriverJob | null };
}
interface ApiJobsResp {
  status: string;
  data: { jobs: DriverJob[]; count: number };
}

export default function DriverHome() {
  const [profile, setProfile] = useState(() => loadProfile());
  const [onShift, setOnShift] = useState(false);
  const [active, setActive] = useState<DriverJob | null>(null);
  const [queue, setQueue] = useState<DriverJob[]>([]);
  const [showQueue, setShowQueue] = useState(false);
  const [lastSample, setLastSample] = useState<GeoSample | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pushState, setPushState] = useState<PushState>('default');
  const [pushBusy, setPushBusy] = useState(false);

  // Re-read profile after profile-page edits.
  useEffect(() => {
    const onStorage = () => setProfile(loadProfile());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const refresh = useCallback(async () => {
    if (!profile.driver_phone) return;
    try {
      const [a, q] = await Promise.all([
        driverApi<ApiJobResp>(`/jobs/active?driver_phone=${encodeURIComponent(profile.driver_phone)}`),
        driverApi<ApiJobsResp>(`/jobs/queue?driver_phone=${encodeURIComponent(profile.driver_phone)}`),
      ]);
      setActive(a.data.job);
      setQueue(q.data.jobs ?? []);
    } catch (err) {
      setToast(`Refresh failed: ${(err as Error).message}`);
    }
  }, [profile.driver_phone]);

  // Initial + 30s poll.
  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const handleSample = useCallback(
    async (sample: GeoSample) => {
      setLastSample(sample);
      if (!profile.driver_phone) return;
      try {
        await driverApi('/pings', {
          method: 'POST',
          json: {
            driver_phone: profile.driver_phone,
            driver_name: profile.driver_name || undefined,
            lat: sample.lat,
            lng: sample.lng,
            heading: sample.heading ?? undefined,
            speed_mph: sample.speed_mph ?? undefined,
            accuracy_m: sample.accuracy_m ?? undefined,
            battery_pct: sample.battery_pct ?? undefined,
            source: 'phone_app',
          },
        });
      } catch (err) {
        setToast(`Ping failed: ${(err as Error).message}`);
      }
    },
    [profile.driver_phone, profile.driver_name],
  );

  const handleAction = useCallback(
    async (action: DriverJobAction) => {
      if (!active?.job_id || !profile.driver_phone) return;
      setBusyAction(true);
      try {
        await driverApi(
          `/jobs/${encodeURIComponent(active.job_id)}/status?driver_phone=${encodeURIComponent(profile.driver_phone)}`,
          {
            method: 'POST',
            json: {
              status: action,
              lat: lastSample?.lat,
              lng: lastSample?.lng,
            },
          },
        );
        setToast(`${actionLabel(action)} recorded`);
        await refresh();
      } catch (err) {
        setToast(`Action failed: ${(err as Error).message}`);
      } finally {
        setBusyAction(false);
      }
    },
    [active?.job_id, profile.driver_phone, lastSample, refresh],
  );

  // Reflect current push state on mount (no prompt).
  useEffect(() => {
    let alive = true;
    getPushState().then((s) => alive && setPushState(s));
    return () => {
      alive = false;
    };
  }, []);

  const handleEnablePush = useCallback(async () => {
    setPushBusy(true);
    try {
      const next = await enablePush(profile.driver_phone);
      setPushState(next);
      setToast(
        next === 'enabled'
          ? 'Push notifications enabled'
          : next === 'denied'
            ? 'Notifications blocked in browser settings'
            : 'Push not enabled',
      );
    } catch (err) {
      setToast(`Push setup failed: ${(err as Error).message}`);
    } finally {
      setPushBusy(false);
    }
  }, [profile.driver_phone]);

  const lastPingAgeSec = useMemo(() => {
    if (!lastSample) return null;
    return Math.floor((Date.now() - lastSample.at) / 1000);
  }, [lastSample]);

  const needsProfile = !profile.driver_phone || !profile.driver_name;

  return (
    <>
      <TopBar
        driverName={profile.driver_name}
        onShift={onShift}
        batteryPct={lastSample?.battery_pct ?? null}
        onToggleShift={() => setOnShift((v) => !v)}
      />

      <main className="flex-1 px-3 py-3 space-y-3" data-testid="driver-home">
        {needsProfile && (
          <div
            className="rounded-lg border border-amber-700 bg-amber-900/30 p-3 text-sm text-amber-200"
            data-testid="needs-profile"
          >
            Add your name and phone in{' '}
            <a className="underline" href="/driver/profile">
              Profile
            </a>{' '}
            to start receiving jobs.
          </div>
        )}

        {geoError && (
          <div
            className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-200"
            data-testid="geo-error"
          >
            <p className="font-medium mb-1">GPS required to receive jobs</p>
            <p className="text-xs mb-2">{geoError}</p>
            <button
              type="button"
              onClick={() => setGeoError(null)}
              className="text-xs underline"
            >
              Retry
            </button>
          </div>
        )}

        {active ? (
          <JobCard job={active} busy={busyAction} onAction={handleAction} />
        ) : (
          <div
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center text-zinc-400"
            data-testid="empty-state"
          >
            <p className="text-3xl mb-2">🚛</p>
            <p className="font-medium text-zinc-200">No active job</p>
            <p className="text-xs mt-1">
              {onShift
                ? 'Waiting for dispatch — stay parked safely.'
                : 'Toggle "On Shift" to start receiving jobs.'}
            </p>
          </div>
        )}

        <section
          className="rounded-lg border border-zinc-800 bg-zinc-900"
          data-testid="queue-section"
        >
          <button
            type="button"
            onClick={() => setShowQueue((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm"
          >
            <span className="font-medium">
              Queue · {queue.length} {queue.length === 1 ? 'job' : 'jobs'}
            </span>
            <span className="text-zinc-500">{showQueue ? '▾' : '▸'}</span>
          </button>
          {showQueue && (
            <ul className="divide-y divide-zinc-800">
              {queue.length === 0 && (
                <li className="px-4 py-3 text-xs text-zinc-500">No queued jobs.</li>
              )}
              {queue.map((j) => (
                <li key={j.job_id ?? Math.random()} className="px-4 py-3 text-sm">
                  <p className="font-medium">{j.caller_name ?? 'Unknown'}</p>
                  <p className="text-xs text-zinc-400">
                    {j.pickup_address ?? 'No address'} · {j.status ?? '—'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="text-xs text-zinc-500 px-1" data-testid="ping-status">
          {lastSample ? (
            <p>
              Last ping {lastPingAgeSec ?? 0}s ago · ±{Math.round(lastSample.accuracy_m ?? 0)}m
            </p>
          ) : (
            <p>Waiting for first GPS fix…</p>
          )}
        </section>

        {pushState !== 'unsupported' && (
          <section className="px-1" data-testid="push-status">
            {pushState === 'enabled' ? (
              <p className="text-xs text-emerald-400" data-testid="push-enabled">
                🔔 Push enabled — you&apos;ll be alerted when a job is assigned.
              </p>
            ) : pushState === 'denied' ? (
              <p className="text-xs text-zinc-500">
                Notifications are blocked. Enable them in your browser settings to get job
                alerts.
              </p>
            ) : (
              <button
                type="button"
                onClick={handleEnablePush}
                disabled={pushBusy || !profile.driver_phone}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 disabled:opacity-50"
                data-testid="push-enable-btn"
              >
                {pushBusy ? 'Enabling…' : '🔔 Enable job notifications'}
              </button>
            )}
          </section>
        )}
      </main>

      {toast && (
        <div
          className="fixed bottom-20 left-1/2 -translate-x-1/2 rounded-lg bg-zinc-100 text-zinc-900 px-4 py-2 text-sm shadow-lg z-30"
          onClick={() => setToast(null)}
          data-testid="toast"
        >
          {toast}
        </div>
      )}

      <BottomNav />

      <Geolocator
        enabled={onShift && !needsProfile}
        intervalSec={profile.ping_interval_sec}
        highAccuracy={profile.high_accuracy_gps}
        onSample={handleSample}
        onError={(m) => setGeoError(m)}
      />
    </>
  );
}
