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
 *      If Google only resolves a generic address/premise with lat/lng, run a
 *      tight nearby repair-shop search to catch customer pins dropped close to
 *      a real repair facility.
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
    // 1. Blocklist guardrail — applies to ALL jobs, universally blocking specified patterns.
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

    // 2. Self-detect: is the destination one of our partner shops?
    const lowerName = (input.destinationName ?? '').toLowerCase().trim();
    const ours = input.ourShopNames ?? [];
    if (matchOurShopName(input.destinationName, ours)) {
      return {
        tag: 'our_shop',
        reason: 'self_detect_partner_shop',
        resolvedName: input.destinationName,
        resolvedAddress: input.destinationAddress ?? null,
      };
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

      // Session 75 — re-run the partner-shop check against the name GOOGLE
      // returns, not just the raw Towbook field.
      //
      // On 2026-08-14 a customer already booked into Wayne's Auto Repair — one
      // of our own partner shops — was pitched a flip to a different partner
      // shop. Towbook had put the business name inside the ADDRESS string and
      // left the name field empty, so the gate-2 check above saw nothing and
      // was skipped. Places then resolved it perfectly, returning the literal
      // name "Wayne's Auto Repair", and we tagged it competitor_repair anyway.
      //
      // The same job placed with the name field populated (a second customer,
      // same shop, 90 minutes later) classified correctly as our_shop. Whether
      // we poach our own partner should not depend on which Towbook field the
      // motor club happened to fill in.
      const placesName = top.name ?? null;
      const ourShopMatch = matchOurShopName(placesName, input.ourShopNames ?? []);
      if (ourShopMatch) {
        return {
          tag: 'our_shop',
          reason: `places_self_detect_partner_shop:${ourShopMatch}`,
          placeTypes: top.types ?? [],
          placeId: top.place_id ?? null,
          resolvedName: placesName,
          resolvedAddress: top.formatted_address ?? input.destinationAddress ?? null,
          resolvedLat: top.geometry?.location?.lat ?? null,
          resolvedLng: top.geometry?.location?.lng ?? null,
        };
      }

      const tag = mapPlaceTypesToTag(top.types ?? []);
      if (
        tag === 'unknown' &&
        isGenericAddressLikePlace(top.types ?? []) &&
        top.geometry?.location?.lat != null &&
        top.geometry?.location?.lng != null
      ) {
        const nearby = await this.tryNearbyRepairLookup({
          apiKey,
          lat: top.geometry.location.lat,
          lng: top.geometry.location.lng,
          input,
        });
        if (nearby) return nearby;
      }
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

  private async tryNearbyRepairLookup(input: {
    apiKey: string;
    lat: number;
    lng: number;
    input: ClassifyDestinationInput;
  }): Promise<ClassifyDestinationResult | null> {
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
      url.searchParams.set('location', `${input.lat},${input.lng}`);
      url.searchParams.set('radius', String(NEARBY_REPAIR_RADIUS_METERS));
      url.searchParams.set('type', 'car_repair');
      url.searchParams.set('key', input.apiKey);

      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        this.logger.warn(`[flip-engine] nearby repair lookup returned ${res.status}`);
        return null;
      }

      const json = (await res.json()) as PlacesResponse;
      const candidates = (json.results ?? [])
        .filter((place) => isRepairLikePlace(place))
        .filter((place) => {
          const loc = place.geometry?.location;
          if (!loc) return false;
          return distanceMeters(input.lat, input.lng, loc.lat, loc.lng) <= NEARBY_REPAIR_RADIUS_METERS;
        })
        .sort((a, b) => {
          const aLoc = a.geometry?.location;
          const bLoc = b.geometry?.location;
          if (!aLoc || !bLoc) return 0;
          return distanceMeters(input.lat, input.lng, aLoc.lat, aLoc.lng) -
            distanceMeters(input.lat, input.lng, bLoc.lat, bLoc.lng);
        });
      const top = candidates[0];
      if (!top) return null;

      const nearbyName = top.name ?? '';
      {
        const nearbyMatch = matchOurShopName(nearbyName, input.input.ourShopNames ?? []);
        if (nearbyMatch) {
          return {
            tag: 'our_shop',
            reason: `places_nearby_repair:self_shop:${top.place_id ?? 'unknown'}`,
            placeTypes: top.types ?? [],
            placeId: top.place_id ?? null,
            resolvedName: top.name ?? null,
            resolvedAddress: top.formatted_address ?? top.vicinity ?? input.input.destinationAddress ?? null,
            resolvedLat: top.geometry?.location?.lat ?? input.lat,
            resolvedLng: top.geometry?.location?.lng ?? input.lng,
          };
        }
      }

      const tag = isBodyShopName(nearbyName) ? 'auto_body' : 'competitor_repair';
      return {
        tag,
        reason: `places_nearby_repair:${top.place_id ?? 'unknown'}`,
        placeTypes: top.types ?? [],
        placeId: top.place_id ?? null,
        resolvedName: top.name ?? null,
        resolvedAddress: top.formatted_address ?? top.vicinity ?? input.input.destinationAddress ?? null,
        resolvedLat: top.geometry?.location?.lat ?? input.lat,
        resolvedLng: top.geometry?.location?.lng ?? input.lng,
      };
    } catch (err) {
      this.logger.warn(`[flip-engine] nearby repair lookup threw: ${(err as Error).message}`);
      return null;
    }
  }

  private unconfiguredLogged = false;
}

/**
 * Does `name` refer to one of our own partner shops?
 *
 * Matched as a substring in BOTH directions, because the two sides are named
 * inconsistently: our records carry a city suffix ("Wayne's Auto Repair —
 * Westerville") while a motor club or Google will just say "Wayne's Auto
 * Repair". Neither string contains the other in a fixed direction.
 *
 * `ourShopNames` are expected pre-lowercased and trimmed by the caller.
 * Returns the matched partner name so callers can log WHICH shop matched.
 */
export function matchOurShopName(
  name: string | null | undefined,
  ourShopNames: string[],
): string | null {
  const lower = (name ?? '').toLowerCase().trim();
  // Two characters is not a shop name, and a bare-substring test on one would
  // match almost every partner record.
  if (lower.length < 3) return null;
  for (const ourName of ourShopNames) {
    if (!ourName || ourName.length < 3) continue;
    if (lower.includes(ourName) || ourName.includes(lower)) return ourName;
  }
  return null;
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

function isGenericAddressLikePlace(types: string[]): boolean {
  const set = new Set(types);
  return (
    set.has('street_address') ||
    set.has('premise') ||
    set.has('subpremise') ||
    set.has('neighborhood') ||
    set.has('locality')
  );
}

function isRepairLikePlace(place: PlaceResult): boolean {
  const types = new Set(place.types ?? []);
  if (types.has('car_repair') || types.has('car_dealer') || types.has('auto_parts')) return true;
  const name = (place.name ?? '').toLowerCase();
  return /\b(auto|automotive|mechanic|repair|service center|garage|collision|body shop|tire|brake|transmission)\b/.test(name);
}

function isBodyShopName(name: string): boolean {
  return /\b(body shop|collision|autobody|auto body|paint|caliber|crash|dent)\b/i.test(name);
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const radiusMeters = 6_371_000;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const NEARBY_REPAIR_RADIUS_METERS = 300;

interface PlacesResponse {
  results?: PlaceResult[];
}

interface PlaceResult {
  name?: string;
  place_id?: string;
  formatted_address?: string;
  vicinity?: string;
  types?: string[];
  geometry?: {
    location?: {
      lat: number;
      lng: number;
    };
  };
}
