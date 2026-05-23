import { describe, it, expect, vi } from 'vitest';
import { DriverPingsService } from './driver-pings.service';
import { GoogleDistanceMatrixService } from './google-distance-matrix.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

describe('DriverPingsService.normalizePhone', () => {
  it('coerces a 10-digit US number to E.164', () => {
    expect(DriverPingsService.normalizePhone('7408129489')).toBe('+17408129489');
  });

  it('strips formatting characters', () => {
    expect(DriverPingsService.normalizePhone('+1 (740) 812-9489')).toBe('+17408129489');
  });

  it('keeps the country code when already 11+ digits', () => {
    expect(DriverPingsService.normalizePhone('17408129489')).toBe('+17408129489');
  });

  it('returns null for fewer than 10 digits', () => {
    expect(DriverPingsService.normalizePhone('123')).toBeNull();
  });
});

describe('DriverPingsService.record', () => {
  it('persists a ping with normalized phone + numeric coordinates', async () => {
    const inserts: Array<{ values: Record<string, unknown> }> = [];
    const db = {
      insert() {
        return {
          values(v: Record<string, unknown>) {
            inserts.push({ values: v });
            return { returning: () => Promise.resolve([{ id: 'p-1', ...v }]) };
          },
        };
      },
    };
    const svc = new DriverPingsService(db as never);
    const row = await svc.record(TENANT_ID, {
      driver_phone: '(740) 812-9489',
      driver_name: 'Sam',
      lat: 39.97,
      lng: -82.99,
      heading: 180,
      speed_mph: 35,
      battery_pct: 80,
    });
    expect(inserts[0].values.driverPhone).toBe('+17408129489');
    expect(inserts[0].values.lat).toBe('39.97');
    expect(inserts[0].values.lng).toBe('-82.99');
    expect(inserts[0].values.batteryPct).toBe(80);
    expect(row.id).toBe('p-1');
  });

  it('rejects a bogus phone with a helpful error', async () => {
    const svc = new DriverPingsService({} as never);
    await expect(
      svc.record(TENANT_ID, { driver_phone: '12', lat: 0, lng: 0 }),
    ).rejects.toThrow(/Invalid driver_phone/);
  });
});

describe('GoogleDistanceMatrixService', () => {
  it('haversineMiles returns ~0 for identical points', () => {
    const d = GoogleDistanceMatrixService.haversineMiles(
      { lat: 40.0, lng: -82.0 },
      { lat: 40.0, lng: -82.0 },
    );
    expect(d).toBeCloseTo(0, 5);
  });

  it('haversineMiles returns ~69 miles for one degree of latitude', () => {
    const d = GoogleDistanceMatrixService.haversineMiles(
      { lat: 39.0, lng: -82.0 },
      { lat: 40.0, lng: -82.0 },
    );
    // 1° latitude ≈ 69 miles anywhere on Earth
    expect(d).toBeGreaterThan(68);
    expect(d).toBeLessThan(70);
  });

  it('returns [] when GOOGLE_PLACES_API_KEY is unset', async () => {
    const prev = process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;
    try {
      const svc = new GoogleDistanceMatrixService();
      const r = await svc.durationToPoint(
        [{ lat: 39.97, lng: -82.99 }],
        { lat: 39.96, lng: -82.99 },
      );
      expect(r).toEqual([]);
    } finally {
      if (prev !== undefined) process.env.GOOGLE_PLACES_API_KEY = prev;
    }
  });

  it('parses a Distance Matrix OK response', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: 'OK',
          rows: [
            {
              elements: [
                {
                  status: 'OK',
                  duration: { value: 600, text: '10 mins' },
                  duration_in_traffic: { value: 720, text: '12 mins' },
                  distance: { value: 8047, text: '5 mi' },
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    ) as never;
    try {
      const svc = new GoogleDistanceMatrixService();
      const r = await svc.durationToPoint(
        [{ lat: 39.97, lng: -82.99 }],
        { lat: 39.96, lng: -82.99 },
      );
      expect(r).toHaveLength(1);
      // Prefers duration_in_traffic when present
      expect(r[0].durationSeconds).toBe(720);
      expect(r[0].distanceMeters).toBe(8047);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.GOOGLE_PLACES_API_KEY;
    }
  });
});
