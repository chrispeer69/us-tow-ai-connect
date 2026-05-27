import { describe, it, expect } from 'vitest';
import {
  haversineMiles,
  selectNearestShop,
  type ShopForSelection,
} from './nearest-shop.selector';

const ALPHA_SHOPS: ShopForSelection[] = [
  // 9 Alpha shops with their actual coordinates from the migration seed.
  { id: 'ernies', name: "Ernie's Automotive Service", shopType: 'REPAIR', lat: 39.961370, lng: -82.864639, active: true },
  { id: 'cbs', name: 'Complete Brake Service', shopType: 'REPAIR', lat: 39.962030, lng: -83.012840, active: true },
  { id: 'hilliard', name: 'Hilliard Auto Repair', shopType: 'REPAIR', lat: 40.036970, lng: -83.150650, active: true },
  { id: 'pettys', name: "Petty's Auto & Electric Service", shopType: 'REPAIR', lat: 39.954670, lng: -82.997410, active: true },
  { id: 'wayne-col', name: "Wayne's Auto Repair — Columbus", shopType: 'REPAIR', lat: 40.099110, lng: -82.991270, active: true },
  { id: 'wayne-w', name: "Wayne's Auto Repair — Westerville", shopType: 'REPAIR', lat: 40.116170, lng: -82.928470, active: true },
  { id: 'wayne-p', name: "Wayne's Auto Repair — Powell", shopType: 'REPAIR', lat: 40.158010, lng: -83.075870, active: true },
  { id: 'excite', name: 'Excite Collision Repair', shopType: 'BODY', lat: 40.110610, lng: -82.929940, active: true },
  { id: 'tnc', name: 'T&C Body Shop', shopType: 'BODY', lat: 40.030360, lng: -82.911270, active: true },
];

describe('selectNearestShop', () => {
  it('picks the closest REPAIR shop to a Westerville pickup', () => {
    // 5995 Westerville Rd is right next to Wayne's Westerville shop.
    const r = selectNearestShop({
      pickupLat: 40.117,
      pickupLng: -82.929,
      shopType: 'REPAIR',
      shops: ALPHA_SHOPS,
    });
    expect(r.shop?.id).toBe('wayne-w');
    expect(r.distanceMiles).toBeLessThan(0.5);
  });

  it('picks the closest BODY shop to a downtown pickup', () => {
    const r = selectNearestShop({
      pickupLat: 39.961,
      pickupLng: -82.998,
      shopType: 'BODY',
      shops: ALPHA_SHOPS,
    });
    expect(r.shop?.id).toBe('tnc');
    expect(r.consideredCount).toBe(2);
  });

  it('only considers active shops of the requested type', () => {
    const shops: ShopForSelection[] = [
      { id: 'A', name: 'A', shopType: 'REPAIR', lat: 0, lng: 0, active: false },
      { id: 'B', name: 'B', shopType: 'BODY', lat: 0, lng: 0, active: true },
      { id: 'C', name: 'C', shopType: 'REPAIR', lat: 1, lng: 1, active: true },
    ];
    const r = selectNearestShop({ pickupLat: 0, pickupLng: 0, shopType: 'REPAIR', shops });
    expect(r.shop?.id).toBe('C');
    expect(r.consideredCount).toBe(1);
  });

  it('returns null when no shops of the requested type exist', () => {
    const shops: ShopForSelection[] = [
      { id: 'B', name: 'B', shopType: 'BODY', lat: 0, lng: 0, active: true },
    ];
    const r = selectNearestShop({ pickupLat: 0, pickupLng: 0, shopType: 'REPAIR', shops });
    expect(r.shop).toBeNull();
    expect(r.distanceMiles).toBeNull();
    expect(r.consideredCount).toBe(0);
  });

  it('returns null when shops have null lat/lng', () => {
    const shops: ShopForSelection[] = [
      { id: 'A', name: 'A', shopType: 'REPAIR', lat: null, lng: null, active: true },
    ];
    const r = selectNearestShop({ pickupLat: 0, pickupLng: 0, shopType: 'REPAIR', shops });
    expect(r.shop).toBeNull();
  });

  it('haversineMiles is symmetric', () => {
    const a = haversineMiles(40.0, -83.0, 39.5, -82.5);
    const b = haversineMiles(39.5, -82.5, 40.0, -83.0);
    expect(Math.abs(a - b)).toBeLessThan(1e-9);
  });

  it('haversineMiles returns 0 for identical points', () => {
    expect(haversineMiles(40, -82, 40, -82)).toBe(0);
  });
});
