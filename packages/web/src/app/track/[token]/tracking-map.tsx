'use client';

import { GoogleMap, Marker, Polyline, useJsApiLoader } from '@react-google-maps/api';
import { useMemo } from 'react';

const containerStyle = { width: '100%', height: '100%' };
const DEFAULT_CENTER = { lat: 40.0, lng: -83.0 };

interface Props {
  pickupLat: number | null;
  pickupLng: number | null;
  driverLat: number | null;
  driverLng: number | null;
}

export function TrackingMap({ pickupLat, pickupLng, driverLat, driverLng }: Props) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: apiKey ?? '',
    id: 'tracking-map',
  });

  const center = useMemo(() => {
    if (driverLat != null && driverLng != null) return { lat: driverLat, lng: driverLng };
    if (pickupLat != null && pickupLng != null) return { lat: pickupLat, lng: pickupLng };
    return DEFAULT_CENTER;
  }, [pickupLat, pickupLng, driverLat, driverLng]);

  if (!apiKey) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-800/60 text-xs text-zinc-400">
        <span className="px-4 text-center">
          Map preview unavailable — Google Maps key not configured. Your tracking still updates
          below.
        </span>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-800/60 text-xs text-zinc-400">
        Loading map…
      </div>
    );
  }

  return (
    <GoogleMap
      mapContainerStyle={containerStyle}
      center={center}
      zoom={12}
      options={{
        disableDefaultUI: true,
        zoomControl: false,
        clickableIcons: false,
      }}
    >
      {pickupLat != null && pickupLng != null && (
        <Marker
          position={{ lat: pickupLat, lng: pickupLng }}
          label={{ text: 'Pickup', fontSize: '11px', color: '#fff' }}
        />
      )}
      {driverLat != null && driverLng != null && (
        <Marker
          position={{ lat: driverLat, lng: driverLng }}
          icon={
            typeof google !== 'undefined' && google.maps
              ? {
                  path: 'M -6 0 L 0 -10 L 6 0 L 0 4 z',
                  fillColor: '#10b981',
                  fillOpacity: 1,
                  strokeColor: '#064e3b',
                  strokeWeight: 1.5,
                  scale: 1.6,
                }
              : undefined
          }
        />
      )}
      {pickupLat != null && pickupLng != null && driverLat != null && driverLng != null && (
        <Polyline
          path={[
            { lat: driverLat, lng: driverLng },
            { lat: pickupLat, lng: pickupLng },
          ]}
          options={{ strokeColor: '#10b981', strokeWeight: 4, strokeOpacity: 0.85 }}
        />
      )}
    </GoogleMap>
  );
}
