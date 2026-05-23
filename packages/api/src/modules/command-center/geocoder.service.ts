import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module';

const CACHE_TTL = 60 * 60 * 24 * 30; // 30 days

export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress?: string;
}

@Injectable()
export class GeocoderService {
  private readonly logger = new Logger(GeocoderService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async geocode(address: string): Promise<GeocodeResult | null> {
    const key = process.env.GOOGLE_PLACES_API_KEY;
    if (!key) {
      this.logger.debug('GOOGLE_PLACES_API_KEY unset — skipping geocode');
      return null;
    }
    const cleaned = address.trim();
    if (!cleaned) return null;

    const cacheKey = `geocode:${cleaned.toLowerCase()}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as GeocodeResult;
      }
    } catch (err) {
      this.logger.warn(`Geocode cache read failed: ${(err as Error).message}`);
    }

    try {
      const url =
        'https://maps.googleapis.com/maps/api/geocode/json' +
        `?address=${encodeURIComponent(cleaned)}&key=${encodeURIComponent(key)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) {
        this.logger.warn(`Geocode HTTP ${res.status} for "${cleaned}"`);
        return null;
      }
      const body = (await res.json()) as {
        status: string;
        results: Array<{
          geometry: { location: { lat: number; lng: number } };
          formatted_address?: string;
        }>;
      };
      if (body.status !== 'OK' || !body.results?.length) {
        return null;
      }
      const top = body.results[0];
      const result: GeocodeResult = {
        lat: top.geometry.location.lat,
        lng: top.geometry.location.lng,
        formattedAddress: top.formatted_address,
      };
      await this.redis
        .set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL)
        .catch((err) => this.logger.warn(`Geocode cache write failed: ${(err as Error).message}`));
      return result;
    } catch (err) {
      this.logger.warn(`Geocode lookup failed for "${cleaned}": ${(err as Error).message}`);
      return null;
    }
  }
}
