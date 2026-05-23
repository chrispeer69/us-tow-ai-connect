'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GoogleMap, LoadScript, Marker } from '@react-google-maps/api';
import { api } from '@/lib/utils';

interface LatestDriver {
  driverPhone: string;
  driverName: string | null;
  lat: number;
  lng: number;
  heading: number | null;
  speedMph: number | null;
  accuracyM: number | null;
  batteryPct: number | null;
  recordedAt: string;
  ageSeconds: number;
}

interface DriversResp {
  status: string;
  data: { drivers: LatestDriver[]; count: number };
}

interface HistoryRow {
  id: string;
  driverPhone: string;
  lat: string | null;
  lng: string | null;
  recordedAt: string;
}

interface HistoryResp {
  status: string;
  data: { pings: HistoryRow[]; count: number };
}

type AgeFilter = 'any' | '60' | '300' | '1200';
type JobFilter = 'any' | 'assigned' | 'unassigned';

const MAP_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

/**
 * Live driver map for ops. Split-screen layout: a sortable table on the
 * left, an auto-refreshing map on the right. Selecting a driver row pops a
 * side-panel with that driver's recent ping history.
 *
 * Note: this page intentionally does NOT add itself to the admin sidebar
 * — see docs/ASSUMPTIONS.md (Session 25). It is reachable by direct URL.
 */
export default function DriversLivePage() {
  const [drivers, setDrivers] = useState<LatestDriver[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [ageFilter, setAgeFilter] = useState<AgeFilter>('any');
  const [jobFilter, setJobFilter] = useState<JobFilter>('any');

  const refresh = useCallback(async () => {
    try {
      const max = ageFilter === 'any' ? '' : `?max_age_seconds=${ageFilter}`;
      const resp = await api<DriversResp>(`/v1/admin/driver-pings/latest${max}`);
      setDrivers(resp.data?.drivers ?? []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [ageFilter]);

  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!selected) {
      setHistory([]);
      return;
    }
    api<HistoryResp>(`/v1/admin/driver-pings/${encodeURIComponent(selected)}/history?limit=20`)
      .then((r) => setHistory(r.data?.pings ?? []))
      .catch(() => setHistory([]));
  }, [selected]);

  // Job-assignment filter is best-effort — currently the latest-ping endpoint
  // doesn't return job state, so this filter is a no-op until the Command
  // Center exposes joined job data. The select stays so the UI surface is
  // complete and we don't have to re-render the layout when it lands.
  const filtered = useMemo(() => {
    if (jobFilter === 'any') return drivers;
    return drivers; // TODO: re-evaluate once admin endpoint exposes assignment.
  }, [drivers, jobFilter]);

  const center = useMemo(() => {
    if (filtered.length === 0) return { lat: 40.0, lng: -82.5 };
    const sum = filtered.reduce(
      (acc, d) => ({ lat: acc.lat + d.lat, lng: acc.lng + d.lng }),
      { lat: 0, lng: 0 },
    );
    return { lat: sum.lat / filtered.length, lng: sum.lng / filtered.length };
  }, [filtered]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <header className="px-6 py-4 border-b border-zinc-800 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Live Drivers</h1>
          <p className="text-xs text-zinc-500">
            Auto-refresh every 10 s · {filtered.length} drivers
            {error && <span className="text-red-300 ml-2">· {error}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <label className="text-xs text-zinc-400 flex items-center gap-1">
            Ping age
            <select
              value={ageFilter}
              onChange={(e) => setAgeFilter(e.target.value as AgeFilter)}
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
              data-testid="age-filter"
            >
              <option value="any">Any</option>
              <option value="60">Last 1 min</option>
              <option value="300">Last 5 min</option>
              <option value="1200">Last 20 min</option>
            </select>
          </label>
          <label className="text-xs text-zinc-400 flex items-center gap-1">
            Jobs
            <select
              value={jobFilter}
              onChange={(e) => setJobFilter(e.target.value as JobFilter)}
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
              data-testid="job-filter"
            >
              <option value="any">Any</option>
              <option value="assigned">Assigned</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </label>
        </div>
      </header>

      <div className="grid grid-cols-12 h-[calc(100vh-72px)]">
        <section
          className="col-span-5 border-r border-zinc-800 overflow-auto"
          data-testid="drivers-table"
        >
          <table className="w-full text-sm">
            <thead className="text-xs text-zinc-500 sticky top-0 bg-zinc-950">
              <tr>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-right">Age</th>
                <th className="px-3 py-2 text-right">±m</th>
                <th className="px-3 py-2 text-right">Batt</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                    No drivers reporting.
                  </td>
                </tr>
              )}
              {filtered.map((d) => {
                const ageColor =
                  d.ageSeconds <= 60
                    ? 'text-emerald-400'
                    : d.ageSeconds <= 600
                      ? 'text-amber-400'
                      : 'text-zinc-500';
                return (
                  <tr
                    key={d.driverPhone}
                    onClick={() => setSelected(d.driverPhone)}
                    className={
                      'cursor-pointer border-t border-zinc-900 ' +
                      (selected === d.driverPhone ? 'bg-zinc-800' : 'hover:bg-zinc-900')
                    }
                    data-testid={`driver-row-${d.driverPhone}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{d.driverPhone}</td>
                    <td className="px-3 py-2">{d.driverName ?? '—'}</td>
                    <td className={'px-3 py-2 text-right text-xs ' + ageColor}>
                      {d.ageSeconds}s
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-zinc-400">
                      {d.accuracyM != null ? Math.round(d.accuracyM) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-zinc-400">
                      {d.batteryPct != null ? `${d.batteryPct}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="col-span-5 relative" data-testid="drivers-map">
          {!MAP_KEY && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900 text-zinc-500 text-sm p-6 text-center">
              <p>
                Set <code className="bg-zinc-800 px-1 rounded">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>{' '}
                to load the live map.
              </p>
            </div>
          )}
          {MAP_KEY && (
            <LoadScript googleMapsApiKey={MAP_KEY}>
              <GoogleMap
                mapContainerStyle={{ width: '100%', height: '100%' }}
                center={center}
                zoom={11}
                options={{
                  disableDefaultUI: true,
                  zoomControl: true,
                  styles: [
                    { elementType: 'geometry', stylers: [{ color: '#1f2937' }] },
                    { elementType: 'labels.text.fill', stylers: [{ color: '#e5e7eb' }] },
                    { elementType: 'labels.text.stroke', stylers: [{ color: '#111827' }] },
                  ],
                }}
              >
                {filtered.map((d) => (
                  <Marker
                    key={d.driverPhone}
                    position={{ lat: d.lat, lng: d.lng }}
                    onClick={() => setSelected(d.driverPhone)}
                    title={`${d.driverName ?? d.driverPhone} · ${d.ageSeconds}s`}
                    label={{
                      text: (d.driverName ?? d.driverPhone).slice(0, 2),
                      color: 'white',
                      fontSize: '11px',
                    }}
                  />
                ))}
              </GoogleMap>
            </LoadScript>
          )}
        </section>

        <aside
          className="col-span-2 border-l border-zinc-800 overflow-auto"
          data-testid="driver-side-panel"
        >
          {!selected && (
            <p className="p-4 text-sm text-zinc-500">
              Click a driver row to see recent history.
            </p>
          )}
          {selected && (
            <div className="p-3 space-y-3 text-sm">
              <div>
                <p className="font-mono text-xs text-zinc-400">{selected}</p>
                <p className="text-xs text-zinc-500 mt-1">
                  Last 20 pings, newest first
                </p>
              </div>
              <ul className="space-y-1">
                {history.length === 0 && (
                  <li className="text-xs text-zinc-500">No history available.</li>
                )}
                {history.map((p) => (
                  <li
                    key={p.id}
                    className="text-xs border border-zinc-800 rounded px-2 py-1 bg-zinc-900"
                  >
                    <p className="text-zinc-300">
                      {p.lat ?? '—'}, {p.lng ?? '—'}
                    </p>
                    <p className="text-zinc-500">
                      {new Date(p.recordedAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
