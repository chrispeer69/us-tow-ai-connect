import { describe, expect, it } from 'vitest';
import { AaaNormalizer } from './aaa.normalizer';

describe('AaaNormalizer', () => {
  it('preserves pickup and destination direction', () => {
    const result = new AaaNormalizer().normalize('tenant-1', {
      jobId: '16026698',
      customerName: 'Customer One',
      customerPhone: '6145550101',
      vehicle: '',
      status: 'In Tow',
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

  it('keeps cleared and cancelled as different terminal outcomes', () => {
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

    expect(normalizer.normalize('tenant-1', { ...base, status: 'Cleared' }).status).toBe(
      'completed',
    );
    expect(normalizer.normalize('tenant-1', { ...base, status: 'Cancelled' }).status).toBe(
      'canceled',
    );
  });
});
