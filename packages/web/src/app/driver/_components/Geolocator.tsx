'use client';

import { useEffect, useRef, useState } from 'react';

export interface GeoSample {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  heading: number | null;
  speed_mph: number | null;
  battery_pct: number | null;
  at: number;
}

interface Props {
  enabled: boolean;
  intervalSec: number;
  highAccuracy: boolean;
  onSample: (sample: GeoSample) => void;
  onError: (msg: string) => void;
}

/**
 * Browser geolocation poller. Reads at `intervalSec`, batches battery info
 * when the BatteryStatus API is available. Emits an `onError` if the user
 * denies permission so the UI can surface a banner. Returns nothing — the
 * parent owns the sample state.
 */
export function Geolocator({ enabled, intervalSec, highAccuracy, onSample, onError }: Props) {
  const [battery, setBattery] = useState<number | null>(null);
  const errorRaisedRef = useRef(false);

  // Battery is independent of geolocation — poll it once and listen for
  // levelchange so the indicator reflects real state.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('getBattery' in navigator)) return;
    let mounted = true;
    (navigator as unknown as { getBattery: () => Promise<{ level: number; addEventListener: (e: string, fn: () => void) => void }> })
      .getBattery()
      .then((b) => {
        if (!mounted) return;
        const tick = () => mounted && setBattery(Math.round(b.level * 100));
        tick();
        b.addEventListener('levelchange', tick);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      onError('Geolocation API unavailable in this browser');
      return;
    }

    const fire = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          errorRaisedRef.current = false;
          onSample({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy_m: pos.coords.accuracy ?? null,
            heading: pos.coords.heading ?? null,
            speed_mph:
              pos.coords.speed != null ? Number((pos.coords.speed * 2.23694).toFixed(1)) : null,
            battery_pct: battery,
            at: Date.now(),
          });
        },
        (err) => {
          if (errorRaisedRef.current) return;
          errorRaisedRef.current = true;
          onError(err.message || 'Geolocation request failed');
        },
        { enableHighAccuracy: highAccuracy, maximumAge: 15_000, timeout: 20_000 },
      );
    };

    fire();
    const timer = window.setInterval(fire, Math.max(intervalSec, 5) * 1000);
    return () => window.clearInterval(timer);
  }, [enabled, intervalSec, highAccuracy, onSample, onError, battery]);

  return null;
}
