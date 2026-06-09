import { Injectable, Logger } from '@nestjs/common';
import { isAaaBrandedShop, type BlocklistEntry } from './aaa-branded.matcher';

export type DestinationTag =
  | 'competitor_repair'
  | 'auto_body'
  | 'our_shop'
  | 'residence'
  | 'unknown'
  | 'aaa_branded';

export interface ClassifyDestinationInput {
  destinationName?: string | null;
  destinationAddress?: string | null;
  destinationPhone?: string | null;
  source: 'TOWBOOK' | 'AAA_PORTAL' | string;
  blocklist?: BlocklistEntry[];
  /** Names of OUR partner shops, lowercased, for self-detection. */
  ourShopNames?: string[];
}

export interface ClassifyDestinationResult {
  tag: DestinationTag;
  reason: string;
  placeTypes?: string[];
  placeId?: string | null;
  resolvedName?: string | null;
  resolvedAddress?: string | null;
  resolvedLat?: number | null;
  resolvedLng?: number | null;
}

/**
 * Session 49c — Destination classifier.
 *
 * Order of checks:
 *   1. AAA-branded hard guardrail (only when source = AAA_PORTAL).
 *      Short-circuits to `aaa_branded` regardless of any other signal.
 *   2. Self-detect: destination name matches one of OUR partner shops.
 *   3. Google Places lookup → maps `place.types` to a tag.
 *   4. Fallback: street-address regex without a business name → unknown.
 *   5. Unknown.
 *
 * Google Places is called via `fetch` against the Text Search endpoint
 * with the `GOOGLE_PLACES_API_KEY` env var. If unset / network failure /
 * non-2xx, we log once and degrade to the regex fallback.
 */
@Injectable()
export class DestinationClassifierService {
  private readonly logger = new Logger(DestinationClassifierService.name);

  async classify(input: ClassifyDestinationInput): Promise<ClassifyDestinationResult> {
    // 1. AAA-branded hard guardrail — ONLY for AAA-source jobs.
    if (input.source === 'AAA_PORTAL') {
      const m = isAaaBrandedShop({
        destinationName: input.destinationName,
        destinationAddress: input.destinationAddress,
        destinationPhone: input.destinationPhone,
        blocklist: input.blocklist ?? [],
      });
      if (m.matched) {
        return {
          tag: 'aaa_branded',
          reason: `aaa_hard_guardrail:${m.rule}`,
          resolvedName: input.destinationName ?? null,
          resolvedAddress: input.destinationAddress ?? null,
        };
      }
    }

    // 2. Self-detect: is the destination one of our partner shops?
    const lowerName = (input.destinationName ?? '').toLowerCase().trim();
    const ours = input.ourShopNames ?? [];
    if (lowerName) {
      for (const ourName of ours) {
        if (lowerName.includes(ourName) || ourName.includes(lowerName)) {
          return {
            tag: 'our_shop',
            reason: 'self_detect_partner_shop',
            resolvedName: input.destinationName,
            resolvedAddress: input.destinationAddress ?? null,
          };
        }
      }
    }

    // 3. Google Places lookup.
    const places = await this.tryGooglePlacesLookup(input);
    if (places) {
      return places;
    }

    // 4. Regex fallback on address.
    const addr = (input.destinationAddress ?? '').toLowerCase();
    if (
      addr.match(/\b(\d+\s+[a-z]+\s+(st|ave|avenue|street|rd|road|ln|lane|dr|drive|ct|court|way|circle|cir|pl|place))\b/) &&
      !lowerName
    ) {
      // Used to return 'residence', but Chris wants to maximize flip opportunities.
      // If we don't have a business name, assume 'unknown' instead of giving up.
      return {
        tag: 'unknown',
        reason: 'regex_address_no_business_name',
        resolvedName: null,
        resolvedAddress: input.destinationAddress ?? null,
      };
    }

    return {
      tag: 'unknown',
      reason: 'no_signals_matched',
      resolvedName: input.destinationName ?? null,
      resolvedAddress: input.destinationAddress ?? null,
    };
  }

  // --- Google Places (best-effort) ---

  private async tryGooglePlacesLookup(
    input: ClassifyDestinationInput,
  ): Promise<ClassifyDestinationResult | null> {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
    if (!apiKey) {
      // Quiet: only log once per process.
      if (!this.unconfiguredLogged) {
        this.logger.warn(
          '[flip-engine] GOOGLE_PLACES_API_KEY not configured — classifier will use regex fallback only',
        );
        this.unconfiguredLogged = true;
      }
      return null;
    }
    const queryParts: string[] = [];
    if (input.destinationName) queryParts.push(input.destinationName);
    if (input.destinationAddress) queryParts.push(input.destinationAddress);
    const query = queryParts.join(' ').trim();
    if (!query) return null;

    try {
      const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
      url.searchParams.set('query', query);
      url.searchParams.set('key', apiKey);
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        this.logger.warn(`[flip-engine] places returned ${res.status} for "${query}"`);
        return null;
      }
      const json = (await res.json()) as PlacesResponse;
      const top = (json.results ?? [])[0];
      if (!top) return null;
      const tag = mapPlaceTypesToTag(top.types ?? []);
      return {
        tag,
        reason: `places:${(top.types ?? []).join(',')}`,
        placeTypes: top.types ?? [],
        placeId: top.place_id ?? null,
        resolvedName: top.name ?? input.destinationName ?? null,
        resolvedAddress: top.formatted_address ?? input.destinationAddress ?? null,
        resolvedLat: top.geometry?.location?.lat ?? null,
        resolvedLng: top.geometry?.location?.lng ?? null,
      };
    } catch (err) {
      this.logger.warn(`[flip-engine] places lookup threw: ${(err as Error).message}`);
      return null;
    }
  }

  private unconfiguredLogged = false;
}

/**
 * Map Google `place.types` (string[]) to our coarse destination tag.
 *
 * Reference: https://developers.google.com/maps/documentation/places/web-service/supported_types
 */
export function mapPlaceTypesToTag(types: string[]): DestinationTag {
  const set = new Set(types);

  // High-confidence automotive businesses
  if (set.has('car_repair') || set.has('car_dealer') || set.has('auto_parts')) {
    return 'competitor_repair';
  }

  // High-confidence non-repair customer destinations. These are not flip
  // candidates, but they should not catch generic street addresses or cities.
  if (set.has('lodging') || set.has('campground') || set.has('rv_park')) {
    return 'residence';
  }

  // Business-like places that are not known repair shops stay unknown. This
  // avoids treating stores, points of interest, cities, or generic map hits as
  // residential and prematurely suppressing the flip path.
  if (set.has('point_of_interest') || set.has('store') || set.has('establishment')) {
    return 'unknown';
  }

  if (
    set.has('street_address') ||
    set.has('premise') ||
    set.has('subpremise') ||
    set.has('neighborhood')
  ) {
    // We used to return 'residence' here, but that captured too many commercial
    // addresses where Towbook didn't provide a business name.
    return 'unknown';
  }

  if (set.has('locality') || set.has('home_goods_store')) {
    return 'unknown';
  }

  // Default to unknown when no type matches our taxonomy.
  return 'unknown';
}

interface PlacesResponse {
  results?: Array<{
    name?: string;
    place_id?: string;
    formatted_address?: string;
    types?: string[];
    geometry?: {
      location?: {
        lat: number;
        lng: number;
      };
    };
  }>;
}
