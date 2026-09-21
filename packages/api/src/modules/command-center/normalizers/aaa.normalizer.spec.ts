import { describe, expect, it } from 'vitest';
import { AaaNormalizer, parseAaaVehicleProfile } from './aaa.normalizer';

describe('AaaNormalizer', () => {
  it('preserves pickup and destination direction', () => {
    const result = new AaaNormalizer().normalize('tenant-1', {
      jobId: '16026698',
      customerName: 'Customer One',
      customerPhone: '6145550101',
      vehicle: 'Black 2012 Honda Accord - PS (Passenger Car/Truck)',
      status: 'Tow Loaded',
      driverName: '',
      eta: 'Unknown',
      pickup: '100 Main St',
      destination: '200 Broad St',
      lastUpdated: '2026-09-21T00:00:00.000Z',
      latitude: '39.949091',
      longitude: '-83.119570',
      serviceType: 'Passenger Car Tow',
    });

    expect(result.sourceJobId).toBe('16026698');
    expect(result.status).toBe('in_tow');
    expect(result.pickupAddress).toBe('100 Main St');
    expect(result.dropoffAddress).toBe('200 Broad St');
    expect(result.pickupLat).toBe('39.949091');
    expect(result.pickupLng).toBe('-83.119570');
    expect(result.serviceType).toBe('Passenger Car Tow');
    expect(result.vehicleYear).toBe('2012');
    expect(result.vehicleMake).toBe('Honda');
    expect(result.vehicleModel).toBe('Accord');
    expect(result.vehicleColor).toBe('Black');
  });

  it('keeps an unstructured vehicle profile without inventing fields', () => {
    expect(parseAaaVehicleProfile('Unknown vehicle')).toEqual({
      year: null,
      make: null,
      model: 'Unknown vehicle',
      color: null,
    });
  });

  it('maps the exact verified AAA lifecycle and fails closed for guesses', () => {
    const normalizer = new AaaNormalizer();
    const base = {
      jobId: 'AAA-2',
      customerName: 'AAA Customer',
      customerPhone: '6145550102',
      vehicle: '',
      driverName: '',
      eta: 'Unknown',
      pickup: '',
      destination: '',
      lastUpdated: '2026-09-21T00:00:00.000Z',
    };

    expect(normalizer.normalize('tenant-1', { ...base, status: 'En Route' }).status).toBe('en_route');
    expect(normalizer.normalize('tenant-1', { ...base, status: 'On Location' }).status).toBe('on_scene');
    expect(normalizer.normalize('tenant-1', { ...base, status: 'Tow Loaded' }).status).toBe('in_tow');
    expect(normalizer.normalize('tenant-1', { ...base, status: 'Tow Complete' }).status).toBe('completed');
    expect(
      normalizer.normalize('tenant-1', {
        ...base,
        status: 'Closed Without Tow Complete',
      }).status,
    ).toBe('canceled');
    expect(normalizer.normalize('tenant-1', { ...base, status: 'Cleared' }).status).toBe('new');
    expect(normalizer.normalize('tenant-1', { ...base, status: 'Cancelled' }).status).toBe('new');
    expect(normalizer.normalize('tenant-1', { ...base, status: 'Completed' }).status).toBe('new');
  });
});
