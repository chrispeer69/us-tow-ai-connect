import { describe, it, expect } from 'vitest';
import { TrackingService } from './tracking.service';

describe('TrackingService.generateToken', () => {
  it('emits 12-character URL-safe tokens', () => {
    const svc = new TrackingService({} as never, {} as never);
    const tokens = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = svc.generateToken();
      expect(t).toMatch(/^[A-Za-z0-9]{12}$/);
      tokens.add(t);
    }
    // Random collisions over 200 draws from a 56^12 space should be astronomically rare.
    expect(tokens.size).toBe(200);
  });

  it('never includes ambiguous characters (0/O/1/l/I)', () => {
    const svc = new TrackingService({} as never, {} as never);
    for (let i = 0; i < 100; i++) {
      const t = svc.generateToken();
      expect(t).not.toMatch(/[0OIl1]/);
    }
  });
});
