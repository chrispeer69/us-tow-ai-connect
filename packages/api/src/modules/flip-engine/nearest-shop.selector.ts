/**
 * Session 49b — Nearest-shop selector.
 *
 * Given a list of partner shops and a reference pickup point, returns
 * the closest shop of the requested type using haversine distance.
 *
 * Reference point: the tow's PICKUP address (per spec — shortest detour
 * for the driver).
 *
 * Distance unit: miles.
 */

export interface ShopForSelection {
  id: string;
  name: string;
  shopType: 'REPAIR' | 'BODY';
  lat: number | null;
  lng: number | null;
  active: boolean;
}

export interface NearestShopInput {
  pickupLat: number;
  pickupLng: number;
  shopType: 'REPAIR' | 'BODY';
  shops: ShopForSelection[];
}

export interface NearestShopResult {
  shop: ShopForSelection | null;
  distanceMiles: number | null;
  consideredCount: number;
}

const EARTH_RADIUS_MILES = 3958.7613;

export function selectNearestShop(input: NearestShopInput): NearestShopResult {
  const candidates = input.shops.filter(
    (s) => s.active && s.shopType === input.shopType && s.lat != null && s.lng != null,
  );
  if (candidates.length === 0) {
    return { shop: null, distanceMiles: null, consideredCount: 0 };
  }
  let best: ShopForSelection | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const shop of candidates) {
    const d = haversineMiles(input.pickupLat, input.pickupLng, shop.lat!, shop.lng!);
    if (d < bestDistance) {
      bestDistance = d;
      best = shop;
    }
  }
  return {
    shop: best,
    distanceMiles: best ? round1(bestDistance) : null,
    consideredCount: candidates.length,
  };
}

/**
 * Session 75 — the ranked list, not just the winner.
 *
 * The script only ever carried ONE shop name, so when a customer said "that's
 * too far, is there anywhere closer?" the agent had nothing in context and
 * answered that we have no other partner shops. We have nine. A test call on
 * 2026-08-14 hit exactly this and it reads as either a lie or an empty network.
 *
 * Returns every candidate of the requested type sorted nearest-first, so the
 * caller can hand the script a short list of fallbacks.
 */
export function selectNearestShops(
  input: NearestShopInput,
  limit = 3,
): Array<{ shop: ShopForSelection; distanceMiles: number }> {
  return input.shops
    .filter(
      (s) => s.active && s.shopType === input.shopType && s.lat != null && s.lng != null,
    )
    .map((shop) => ({
      shop,
      distanceMiles: round1(
        haversineMiles(input.pickupLat, input.pickupLng, shop.lat!, shop.lng!),
      ),
    }))
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, limit);
}

export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
