import { Injectable, Logger } from '@nestjs/common';

export type DestinationType = 'AUTO_REPAIR' | 'AUTO_BODY' | 'RESIDENTIAL' | 'UNKNOWN';

export interface PlaceClassification {
  businessName: string;
  type: DestinationType;
  placeId: string;
}

@Injectable()
export class GooglePlacesService {
  private readonly logger = new Logger(GooglePlacesService.name);

  async classifyAddress(address: string): Promise<PlaceClassification> {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey || apiKey.startsWith('REPLACE_ME')) {
      this.logger.warn('GOOGLE_PLACES_API_KEY not configured — returning UNKNOWN');
      return { businessName: '', type: 'UNKNOWN', placeId: '' };
    }

    if (!address) {
      return { businessName: '', type: 'UNKNOWN', placeId: '' };
    }

    try {
      const url =
        `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
        `?input=${encodeURIComponent(address)}` +
        `&inputtype=textquery` +
        `&fields=name,types,place_id` +
        `&key=${encodeURIComponent(apiKey)}`;

      const res = await fetch(url);
      if (!res.ok) {
        this.logger.warn(`Google Places HTTP ${res.status} for "${address}"`);
        return { businessName: '', type: 'UNKNOWN', placeId: '' };
      }

      const data = (await res.json()) as {
        candidates?: Array<{ name?: string; types?: string[]; place_id?: string }>;
        status?: string;
        error_message?: string;
      };

      if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        this.logger.warn(
          `Google Places status=${data.status} ${data.error_message ?? ''} for "${address}"`,
        );
      }

      if (!data.candidates || data.candidates.length === 0) {
        return { businessName: '', type: 'UNKNOWN', placeId: '' };
      }

      const place = data.candidates[0];
      const types = place.types ?? [];

      let type: DestinationType = 'UNKNOWN';
      if (types.includes('car_repair') || types.includes('mechanic')) {
        type = 'AUTO_REPAIR';
      } else if (types.includes('auto_body_shop') || types.includes('car_body_repair')) {
        type = 'AUTO_BODY';
      } else if (
        types.includes('premise') ||
        types.includes('street_address') ||
        types.includes('subpremise')
      ) {
        type = 'RESIDENTIAL';
      }

      return {
        businessName: place.name ?? '',
        type,
        placeId: place.place_id ?? '',
      };
    } catch (err) {
      this.logger.error(`Google Places API error: ${(err as Error).message}`);
      return { businessName: '', type: 'UNKNOWN', placeId: '' };
    }
  }
}
