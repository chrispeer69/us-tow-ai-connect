import { describe, expect, it } from 'vitest';
import { isDealerDestination } from './dealer-destination';

describe('isDealerDestination (script 3.12)', () => {
  it('trusts the car_dealer place type', () => {
    expect(isDealerDestination(['car_dealer', 'store'], null)).toBe(true);
    expect(isDealerDestination(['car_repair'], 'Complete Brake Service')).toBe(false);
  });

  it('recognises franchise brands and Columbus dealer groups by name', () => {
    for (const n of [
      'Germain Cadillac of Easton',
      'Coughlin Chevrolet',
      'Roush Honda Parts Store',
      'Byers Subaru Dublin',
      'Bob-Boyd Lincoln, Inc. Service',
      'Mark Wahlberg Chevy Columbus Service Center',
      'Mercedes-Benz of Dublin Parts',
      'Great Lakes Hyundai of Dublin Parts Center',
    ]) {
      expect(isDealerDestination(null, n), n).toBe(true);
    }
  });

  it('does not flag independent shops, parts chains or streets that contain "ford"', () => {
    for (const n of [
      "Wayne's Auto Repair",
      'Advance Auto Parts',
      'AutoZone Auto Parts',
      'Oxford Automotive Tire & Repair',
      'Hilliard Auto Repair',
      '1234 Bedford Ave, Columbus',
      'NTB-National Tire & Battery',
      '',
      null,
    ]) {
      expect(isDealerDestination(['car_repair'], n), String(n)).toBe(false);
    }
  });

  it('checks every name it is given', () => {
    expect(isDealerDestination(null, 'Service Center', 'Ricart Ford')).toBe(true);
  });
});
