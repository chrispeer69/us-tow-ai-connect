import { describe, expect, it } from 'vitest';
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
});
