import { describe, expect, it } from 'vitest';
import { AaaNormalizer } from './aaa.normalizer';

describe('AaaNormalizer', () => {
  it('preserves pickup and destination direction', () => {
    const result = new AaaNormalizer().normalize('tenant-1', {
      jobId: '16026698',
      customerName: 'Customer One',
      customerPhone: '6145550101',
      vehicle: '',
      status: 'Tow Loaded',
      driverName: '',
      eta: 'Unknown',
      pickup: '100 Main St',
      destination: '200 Broad St',
      lastUpdated: '2026-09-21T00:00:00.000Z',
    });

    expect(result.sourceJobId).toBe('16026698');
    expect(result.status).toBe('in_tow');
    expect(result.pickupAddress).toBe('100 Main St');
    expect(result.dropoffAddress).toBe('200 Broad St');
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
    expect(normalizer.normalize('tenant-1', { ...base, status: 'Cleared' }).status).toBe('completed');
    expect(normalizer.normalize('tenant-1', { ...base, status: 'Cancelled' }).status).toBe('new');
    expect(normalizer.normalize('tenant-1', { ...base, status: 'Completed' }).status).toBe('new');
  });
});
