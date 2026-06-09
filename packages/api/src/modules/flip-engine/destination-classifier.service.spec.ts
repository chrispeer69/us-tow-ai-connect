import { afterEach, describe, expect, it, vi } from 'vitest';
import { DestinationClassifierService, mapPlaceTypesToTag } from './destination-classifier.service';

describe('mapPlaceTypesToTag', () => {
  it('classifies automotive places as competitor repair', () => {
    expect(mapPlaceTypesToTag(['car_repair', 'point_of_interest', 'establishment'])).toBe(
      'competitor_repair',
    );
    expect(mapPlaceTypesToTag(['car_dealer', 'store', 'establishment'])).toBe(
      'competitor_repair',
    );
    expect(mapPlaceTypesToTag(['auto_parts', 'store', 'establishment'])).toBe(
      'competitor_repair',
    );
  });

  it('does not classify generic map/address hits as residential', () => {
    expect(mapPlaceTypesToTag(['street_address'])).toBe('unknown');
    expect(mapPlaceTypesToTag(['premise'])).toBe('unknown');
    expect(mapPlaceTypesToTag(['subpremise'])).toBe('unknown');
    expect(mapPlaceTypesToTag(['neighborhood'])).toBe('unknown');
    expect(mapPlaceTypesToTag(['locality'])).toBe('unknown');
  });

  it('does not classify stores or points of interest as residential', () => {
    expect(mapPlaceTypesToTag(['store', 'point_of_interest', 'establishment'])).toBe('unknown');
    expect(mapPlaceTypesToTag(['home_goods_store', 'store', 'point_of_interest'])).toBe(
      'unknown',
    );
  });

  it('keeps clear non-repair stay/camp destinations out of the flip path', () => {
    expect(mapPlaceTypesToTag(['lodging', 'point_of_interest', 'establishment'])).toBe(
      'residence',
    );
    expect(mapPlaceTypesToTag(['campground', 'point_of_interest'])).toBe('residence');
    expect(mapPlaceTypesToTag(['rv_park', 'point_of_interest'])).toBe('residence');
  });
});

describe('DestinationClassifierService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GOOGLE_PLACES_API_KEY;
  });

  it('falls back to unknown for address-only destinations instead of residence', async () => {
    const previousKey = process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;
    const result = await new DestinationClassifierService().classify({
      source: 'TOWBOOK',
      destinationAddress: '123 Main St, Columbus, OH',
    });
    if (previousKey === undefined) {
      delete process.env.GOOGLE_PLACES_API_KEY;
    } else {
      process.env.GOOGLE_PLACES_API_KEY = previousKey;
    }

    expect(result.tag).toBe('unknown');
    expect(result.reason).toBe('regex_address_no_business_name');
  });

  it('still detects our own shop before map lookup', async () => {
    const result = await new DestinationClassifierService().classify({
      source: 'TOWBOOK',
      destinationName: 'Wayne Auto Repair - Westerville',
      destinationAddress: '10 Example Rd',
      ourShopNames: ['wayne auto repair'],
    });

    expect(result.tag).toBe('our_shop');
    expect(result.reason).toBe('self_detect_partner_shop');
  });

  it('uses a nearby repair search when Google resolves only a generic premise', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            name: '123 Main St',
            place_id: 'premise-1',
            formatted_address: '123 Main St, Columbus, OH',
            types: ['premise'],
            geometry: { location: { lat: 40, lng: -83 } },
          },
        ],
      }),
    ).mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            name: 'Main Street Auto Repair',
            place_id: 'repair-1',
            vicinity: '125 Main St',
            types: ['car_repair', 'point_of_interest', 'establishment'],
            geometry: { location: { lat: 40.0002, lng: -83.0002 } },
          },
        ],
      }),
    );

    const result = await new DestinationClassifierService().classify({
      source: 'TOWBOOK',
      destinationAddress: '123 Main St, Columbus, OH',
    });

    expect(result.tag).toBe('competitor_repair');
    expect(result.reason).toBe('places_nearby_repair:repair-1');
    expect(result.resolvedName).toBe('Main Street Auto Repair');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a generic premise unknown when no nearby repair shop is found', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            name: '123 Main St',
            place_id: 'premise-1',
            formatted_address: '123 Main St, Columbus, OH',
            types: ['premise'],
            geometry: { location: { lat: 40, lng: -83 } },
          },
        ],
      }),
    ).mockResolvedValueOnce(
      jsonResponse({
        results: [],
      }),
    );

    const result = await new DestinationClassifierService().classify({
      source: 'TOWBOOK',
      destinationAddress: '123 Main St, Columbus, OH',
    });

    expect(result.tag).toBe('unknown');
    expect(result.reason).toBe('places:premise');
  });
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}
