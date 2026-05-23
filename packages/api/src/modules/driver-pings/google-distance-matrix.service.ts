import { Injectable, Logger } from '@nestjs/common';

export interface DistanceMatrixOrigin {
  lat: number;
  lng: number;
  label?: string;
}

export interface DistanceMatrixResult {
  durationSeconds: number;
  distanceMeters: number;
  origin: DistanceMatrixOrigin;
}

/**
 * Thin wrapper over Google's legacy Distance Matrix REST API. We deliberately
 * use the v1 endpoint (not Routes API) because the existing
 * `GOOGLE_PLACES_API_KEY` is already authorized for Places + Distance Matrix
 * on the same Google Cloud project per the build sessions doc.
 *
 * Returns one row per origin against the single destination, in input order.
 * Failures degrade gracefully: a missing API key returns an empty array so
 * callers can fall back to the configured static ETA instead of 500ing.
 */
@Injectable()
export class GoogleDistanceMatrixService {
  private readonly logger = new Logger(GoogleDistanceMatrixService.name);

  isConfigured(): boolean {
    const key = process.env.GOOGLE_PLACES_API_KEY;
    return !!key && !key.startsWith('REPLACE_ME');
  }

  async durationToPoint(
    origins: DistanceMatrixOrigin[],
    destination: { lat: number; lng: number } | string,
  ): Promise<DistanceMatrixResult[]> {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey || apiKey.startsWith('REPLACE_ME')) {
      this.logger.warn('GOOGLE_PLACES_API_KEY not configured — skipping Distance Matrix');
      return [];
    }
    if (origins.length === 0) return [];

    const originsParam = origins.map((o) => `${o.lat},${o.lng}`).join('|');
    const destinationParam =
      typeof destination === 'string'
        ? destination
        : `${destination.lat},${destination.lng}`;

    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${encodeURIComponent(originsParam)}` +
      `&destinations=${encodeURIComponent(destinationParam)}` +
      `&mode=driving` +
      `&departure_time=now` +
      `&units=imperial` +
      `&key=${encodeURIComponent(apiKey)}`;

    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      this.logger.warn(`Distance Matrix fetch failed: ${(err as Error).message}`);
      return [];
    }
    if (!res.ok) {
      this.logger.warn(`Distance Matrix HTTP ${res.status}`);
      return [];
    }

    const data = (await res.json()) as {
      status?: string;
      error_message?: string;
      rows?: Array<{
        elements?: Array<{
          status?: string;
          duration?: { value: number; text: string };
          duration_in_traffic?: { value: number; text: string };
          distance?: { value: number; text: string };
        }>;
      }>;
    };

    if (data.status && data.status !== 'OK') {
      this.logger.warn(
        `Distance Matrix status=${data.status} ${data.error_message ?? ''}`,
      );
      return [];
    }

    const results: DistanceMatrixResult[] = [];
    for (let i = 0; i < origins.length; i += 1) {
      const elem = data.rows?.[i]?.elements?.[0];
      if (!elem || elem.status !== 'OK') continue;
      // Prefer traffic-adjusted duration when present (requires departure_time).
      const durationSeconds = elem.duration_in_traffic?.value ?? elem.duration?.value ?? 0;
      const distanceMeters = elem.distance?.value ?? 0;
      results.push({ durationSeconds, distanceMeters, origin: origins[i] });
    }
    return results;
  }

  /**
   * Haversine fallback when the Distance Matrix API can't be reached. Returns
   * straight-line distance in miles; useful for ranking origins by proximity
   * even without driving directions.
   */
  static haversineMiles(
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
  ): number {
    const R = 3958.8; // Earth radius in miles
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
}
