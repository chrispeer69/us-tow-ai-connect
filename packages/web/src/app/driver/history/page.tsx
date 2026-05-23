'use client';

import { useCallback, useEffect, useState } from 'react';
import { BottomNav } from '../_components/BottomNav';
import { TopBar } from '../_components/TopBar';
import { driverApi, loadProfile, type DriverJob } from '../_lib/driver-api';

interface ApiResp {
  status: string;
  data: { jobs: DriverJob[]; count: number };
}

export default function HistoryPage() {
  const profile = loadProfile();
  const [jobs, setJobs] = useState<DriverJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile.driver_phone) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await driverApi<ApiResp>(
        `/jobs/history?driver_phone=${encodeURIComponent(profile.driver_phone)}&days=30&limit=50`,
      );
      setJobs(resp.data.jobs ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [profile.driver_phone]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <TopBar
        driverName={profile.driver_name}
        onShift={false}
        batteryPct={null}
        onToggleShift={() => {}}
      />
      <main className="flex-1 px-3 py-3" data-testid="driver-history">
        <h1 className="text-lg font-semibold mb-3 px-1">History · Last 30 days</h1>

        {loading && <p className="text-sm text-zinc-500 px-1">Loading…</p>}
        {error && (
          <p className="text-sm text-red-300 px-1" data-testid="history-error">
            {error}
          </p>
        )}

        {!loading && !error && jobs.length === 0 && (
          <div
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center text-zinc-500"
            data-testid="history-empty"
          >
            <p>No completed jobs in the last 30 days.</p>
            {!profile.driver_phone && (
              <p className="text-xs mt-2">Set your phone in Profile first.</p>
            )}
          </div>
        )}

        <ul className="space-y-2" data-testid="history-list">
          {jobs.map((j) => {
            const dt = j.completed_at ? new Date(j.completed_at) : null;
            return (
              <li
                key={j.job_id ?? Math.random()}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-3 text-sm"
              >
                <div className="flex items-baseline justify-between">
                  <p className="font-medium">{j.caller_name ?? 'Unknown caller'}</p>
                  <p className="text-xs text-zinc-500">
                    {dt ? dt.toLocaleString() : ''}
                  </p>
                </div>
                <p className="text-xs text-zinc-400 mt-1">
                  {j.pickup_address ?? '—'} → {j.dropoff_address ?? 'dropoff'}
                </p>
                <p className="text-xs text-zinc-500 mt-1 flex gap-2">
                  <span>{j.service_type ?? 'tow'}</span>
                  <span>·</span>
                  <span className="capitalize">{j.status?.replace(/_/g, ' ') ?? '—'}</span>
                  {j.payout_estimate != null && (
                    <>
                      <span>·</span>
                      <span>${j.payout_estimate.toFixed(2)}</span>
                    </>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      </main>
      <BottomNav />
    </>
  );
}
