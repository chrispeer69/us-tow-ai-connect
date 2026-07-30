'use client';
import { GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api';
import { useMemo } from 'react';
import {
  STATUS_COLOR,
  type Driver,
  type UnifiedJob,
} from '@/lib/command-center-types';

const containerStyle = { width: '100%', height: '100%' };
const DEFAULT_CENTER = { lat: 40.0, lng: -83.0 }; // Central Ohio fallback.

function toLatLng(lat: string | null, lng: string | null): { lat: number; lng: number } | null {
  if (!lat || !lng) return null;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { lat: a, lng: b };
}

// Inline SVG so we don't depend on Google's icon library; uses status color.
function jobIcon(status: UnifiedJob['status']): google.maps.Symbol | undefined {
  const palette: Record<string, string> = {
    new: '#71717a',
    assigned: '#3b82f6',
    en_route: '#6366f1',
    on_scene: '#f59e0b',
    in_tow: '#a855f7',
    completed: '#10b981',
    canceled: '#3f3f46',
    declined: '#dc2626',
  };
  if (typeof google === 'undefined' || !google.maps) return undefined;
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: palette[status] ?? '#71717a',
    fillOpacity: 1,
    strokeColor: '#fff',
    strokeWeight: 2,
    scale: 8,
  };
}

function driverIcon(): google.maps.Symbol | undefined {
  if (typeof google === 'undefined' || !google.maps) return undefined;
  return {
    path: 'M -6 0 L 0 -10 L 6 0 L 0 4 z',
    fillColor: '#22d3ee',
    fillOpacity: 1,
    strokeColor: '#0e7490',
    strokeWeight: 1.5,
    scale: 1.2,
    rotation: 0,
  };
}

export function MapPanel({
  jobs,
  drivers,
  selectedJobId,
  onSelectJob,
}: {
  jobs: UnifiedJob[];
  drivers: Driver[];
  selectedJobId: string | null;
  onSelectJob: (id: string) => void;
}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: apiKey ?? '',
    id: 'google-map-script',
    libraries: ['places'] as ('places')[],
  });

  const center = useMemo(() => {
    const first = jobs.find((j) => j.pickupLat && j.pickupLng);
    if (first) return toLatLng(first.pickupLat, first.pickupLng) ?? DEFAULT_CENTER;
    return DEFAULT_CENTER;
  }, [jobs]);

  if (!apiKey) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-sm text-zinc-500 shadow-sm">
        <div className="max-w-md p-6 text-center">
          <p className="font-medium text-zinc-900">Google Maps not configured</p>
          <p className="mt-2 text-zinc-600">
            Set <code className="rounded bg-zinc-200 px-1.5 py-0.5 text-zinc-800">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> to render the live map.
            The job table below still updates in real time without it.
          </p>
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-sm text-zinc-500 shadow-sm">
        Loading map…
      </div>
    );
  }

  return (
    <GoogleMap
      mapContainerStyle={containerStyle}
      center={center}
      zoom={11}
      options={{
        disableDefaultUI: true,
        zoomControl: true,
      }}
    >
      {jobs.map((j) => {
        const pos = toLatLng(j.pickupLat, j.pickupLng);
        if (!pos) return null;
        return (
          <Marker
            key={`job-${j.id}`}
            position={pos}
            icon={jobIcon(j.status)}
            zIndex={j.id === selectedJobId ? 999 : 1}
            onClick={() => onSelectJob(j.id)}
          />
        );
      })}
      {drivers.map((d) => {
        const pos = toLatLng(d.currentLat, d.currentLng);
        if (!pos) return null;
        return <Marker key={`driver-${d.id}`} position={pos} icon={driverIcon()} title={d.name} />;
      })}
    </GoogleMap>
  );
}



// Surface for callers that need to know which status maps to which color
// (e.g., the legend).
export const MAP_LEGEND_COLORS = STATUS_COLOR;
