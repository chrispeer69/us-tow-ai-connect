'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GoogleMap, LoadScript, Marker, Polyline } from '@react-google-maps/api';
import { BottomNav } from '../_components/BottomNav';
import { Geolocator, type GeoSample } from '../_components/Geolocator';
import { TopBar } from '../_components/TopBar';
import { driverApi, loadProfile, type DriverJob } from '../_lib/driver-api';

interface ActiveResp {
  status: string;
  data: { job: DriverJob | null };
}

const MAP_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

/**
 * Full-screen driver map. Marker for the driver's last GPS sample plus the
 * active job's pickup; if both lat/lng are known a straight-line polyline
 * is drawn (server-side routing isn't worth a Distance Matrix call here —
 * Google Maps directions live a tap away on the job card).
 */
export default function DriverMapPage() {
  const profile = loadProfile();
  const [active, setActive] = useState<DriverJob | null>(null);
  const [sample, setSample] = useState<GeoSample | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);

  const refresh = useCallback(async () => {
    if (!profile.driver_phone) return;
    try {
      const a = await driverApi<ActiveResp>(
        `/jobs/active?driver_phone=${encodeURIComponent(profile.driver_phone)}`,
      );
      setActive(a.data.job);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [profile.driver_phone]);

  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const center = useMemo(() => {
    if (sample) return { lat: sample.lat, lng: sample.lng };
    if (active?.pickup_lat != null && active?.pickup_lng != null) {
      return { lat: active.pickup_lat, lng: active.pickup_lng };
    }
    return { lat: 40.0, lng: -82.5 }; // Roadside HQ vicinity fallback.
  }, [sample, active]);

  const polylinePath = useMemo(() => {
    if (!sample) return null;
    if (active?.pickup_lat == null || active?.pickup_lng == null) return null;
    return [
      { lat: sample.lat, lng: sample.lng },
      { lat: active.pickup_lat, lng: active.pickup_lng },
    ];
  }, [sample, active]);

  return (
    <>
      <TopBar
        driverName={profile.driver_name}
        onShift={true}
        batteryPct={sample?.battery_pct ?? null}
        onToggleShift={() => {}}
      />

      <main className="flex-1 relative" data-testid="driver-map">
        {!MAP_KEY && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-zinc-900 text-zinc-400 text-sm p-6 text-center"
            data-testid="map-missing-key"
          >
            <p>
              Set <code className="bg-zinc-800 px-1 rounded">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>{' '}
              to load the live map. Last ping{' '}
              {sample ? `${Math.round((Date.now() - sample.at) / 1000)}s` : 'pending'} ago.
            </p>
          </div>
        )}

        {MAP_KEY && (
          <LoadScript googleMapsApiKey={MAP_KEY}>
            <GoogleMap
              mapContainerStyle={{ width: '100%', height: '100%' }}
              center={center}
              zoom={13}
              options={{
                disableDefaultUI: true,
                zoomControl: true,
                gestureHandling: 'greedy',
                styles: [
                  // Dark mode for night driving — light style burns out at night.
                  { elementType: 'geometry', stylers: [{ color: '#1f2937' }] },
                  { elementType: 'labels.text.fill', stylers: [{ color: '#e5e7eb' }] },
                  { elementType: 'labels.text.stroke', stylers: [{ color: '#111827' }] },
                  { featureType: 'road', stylers: [{ color: '#374151' }] },
                  { featureType: 'water', stylers: [{ color: '#0f172a' }] },
                ],
              }}
            >
              {sample && (
                <Marker
                  position={{ lat: sample.lat, lng: sample.lng }}
                  title="You"
                  label={{ text: '🚛', fontSize: '18px' }}
                />
              )}
              {active?.pickup_lat != null && active?.pickup_lng != null && (
                <Marker
                  position={{ lat: active.pickup_lat, lng: active.pickup_lng }}
                  title="Pickup"
                  label={{ text: 'P', color: 'white' }}
                />
              )}
              {active?.dropoff_lat != null && active?.dropoff_lng != null && (
                <Marker
                  position={{ lat: active.dropoff_lat, lng: active.dropoff_lng }}
                  title="Dropoff"
                  label={{ text: 'D', color: 'white' }}
                />
              )}
              {polylinePath && (
                <Polyline
                  path={polylinePath}
                  options={{ strokeColor: '#10b981', strokeWeight: 4, strokeOpacity: 0.8 }}
                />
              )}
            </GoogleMap>
          </LoadScript>
        )}

        {/* Bottom sheet — collapsible job summary. */}
        <div
          className={
            'absolute left-0 right-0 bottom-0 bg-zinc-900 border-t border-zinc-800 transition-transform ' +
            (sheetOpen ? 'translate-y-0' : 'translate-y-[calc(100%-40px)]')
          }
          data-testid="map-sheet"
        >
          <button
            type="button"
            onClick={() => setSheetOpen((v) => !v)}
            className="w-full h-10 text-sm text-zinc-300 flex items-center justify-center"
          >
            {sheetOpen ? '▾ Hide details' : '▴ Show details'}
          </button>
          {sheetOpen && (
            <div className="px-4 pb-4 text-sm">
              {active ? (
                <div className="space-y-1">
                  <p className="font-semibold">{active.caller_name ?? 'Unknown caller'}</p>
                  <p className="text-xs text-zinc-400">{active.pickup_address ?? 'No address'}</p>
                  <p className="text-xs text-zinc-500 capitalize">
                    {active.status?.replace(/_/g, ' ') ?? '—'} · {active.service_type ?? 'tow'}
                  </p>
                  {error && <p className="text-xs text-red-300">{error}</p>}
                </div>
              ) : (
                <p className="text-zinc-500 text-sm">No active job.</p>
              )}
            </div>
          )}
        </div>
      </main>

      <BottomNav />
      <Geolocator
        enabled={!!profile.driver_phone}
        intervalSec={profile.ping_interval_sec}
        highAccuracy={profile.high_accuracy_gps}
        onSample={setSample}
        onError={(m) => setError(m)}
      />
    </>
  );
}
