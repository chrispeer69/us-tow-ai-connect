import { describe, expect, it } from 'vitest';
import { TowbookNormalizer } from './towbook.normalizer';
import { mapAdapterStatus } from './status-map';
import { parseVehicleString, stripTrailingColor } from './vehicle-parse';

describe('mapAdapterStatus', () => {
  it('maps common Towbook strings to the canonical statuses', () => {
    expect(mapAdapterStatus('Enroute')).toBe('en_route');
    expect(mapAdapterStatus('On Scene')).toBe('on_scene');
    expect(mapAdapterStatus('In Tow')).toBe('in_tow');
    expect(mapAdapterStatus('Completed')).toBe('completed');
    expect(mapAdapterStatus('Cancelled')).toBe('canceled');
  });
  it('returns "new" for unknown / empty', () => {
    expect(mapAdapterStatus('')).toBe('new');
    expect(mapAdapterStatus(null)).toBe('new');
    expect(mapAdapterStatus('zzzz')).toBe('new');
  });
});

describe('parseVehicleString', () => {
  it('parses year + make + model + color', () => {
    expect(parseVehicleString('2018 Honda Civic Red')).toEqual({
      year: '2018',
      make: 'Honda',
      model: 'Civic',
      color: 'Red',
    });
  });
  it('handles missing color', () => {
    expect(parseVehicleString('2020 Ford F-150')).toMatchObject({
      year: '2020',
      make: 'Ford',
    });
  });
  it('handles missing year', () => {
    expect(parseVehicleString('Toyota Camry')).toMatchObject({
      year: null,
      make: 'Toyota',
      model: 'Camry',
    });
  });
});

describe('stripTrailingColor', () => {
  it('drops a trailing color word', () => {
    expect(stripTrailingColor('2019 Chevrolet Tahoe Black')).toBe('2019 Chevrolet Tahoe');
  });
  it('leaves a vehicle with no color unchanged', () => {
    expect(stripTrailingColor('2020 Ford F-150')).toBe('2020 Ford F-150');
  });
  it('never strips down to nothing on a single-token color-only input', () => {
    expect(stripTrailingColor('Red')).toBe('Red');
  });
  it('is case-insensitive', () => {
    expect(stripTrailingColor('2018 Honda Civic red')).toBe('2018 Honda Civic');
  });
});

describe('TowbookNormalizer', () => {
  const n = new TowbookNormalizer();
  it('produces a unified job from a typical ActiveJob row', () => {
    const out = n.normalize('tenant-x', {
      jobId: '12345',
      customerName: 'Jane Doe',
      customerPhone: '6145550000',
      vehicle: '2021 Toyota Camry Blue',
      status: 'Enroute',
      driverName: '',
      eta: '15 min',
      pickup: '123 Tow Ln, Columbus OH',
      destination: '500 Main St',
      lastUpdated: new Date().toISOString(),
    });
    expect(out.source).toBe('towbook');
    expect(out.sourceJobId).toBe('12345');
    expect(out.status).toBe('en_route');
    expect(out.callerName).toBe('Jane Doe');
    expect(out.vehicleYear).toBe('2021');
    expect(out.vehicleMake).toBe('Toyota');
    expect(out.vehicleModel).toBe('Camry');
    expect(out.vehicleColor).toBe('Blue');
    expect(out.pickupAddress).toBe('123 Tow Ln, Columbus OH');
    expect(out.dropoffAddress).toBe('500 Main St');
    expect(out.etaMinutes).toBe(15);
    expect(out.sourcePayload).toMatchObject({ status_raw: 'Enroute' });
  });

  it('leaves pickup/dropoff null when the scraper captured neither (tow-to TBD)', () => {
    const out = n.normalize('tenant-x', {
      jobId: '999',
      customerName: 'No Dest',
      customerPhone: '6145559999',
      vehicle: '2010 Ford F-150',
      status: 'Waiting',
      driverName: '',
      eta: 'Unknown',
      pickup: '',
      destination: '',
      lastUpdated: new Date().toISOString(),
    });
    expect(out.pickupAddress).toBeNull();
    expect(out.dropoffAddress).toBeNull();
  });
});
