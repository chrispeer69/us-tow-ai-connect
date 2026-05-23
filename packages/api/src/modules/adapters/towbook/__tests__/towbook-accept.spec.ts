import { describe, it, expect, vi } from 'vitest';

// Towbook accept/decline never touch a browser (dispatch-out, no intake
// surface), but the adapter imports `chromium` at module load — stub it.
vi.mock('playwright', () => ({ chromium: { launch: vi.fn() } }));

import { TowbookAdapter } from '../towbook.adapter';

function makeRedis() {
  return { get: vi.fn(), set: vi.fn(), del: vi.fn() } as any;
}

describe('TowbookAdapter accept/decline', () => {
  it('acceptJob returns a structured not-applicable result (never throws)', async () => {
    const adapter = new TowbookAdapter(makeRedis());
    const result = await adapter.acceptJob('tenant-1', 'call-123');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not-applicable/i);
  });

  it('declineJob returns a structured not-applicable result (never throws)', async () => {
    const adapter = new TowbookAdapter(makeRedis());
    const result = await adapter.declineJob('tenant-1', 'call-123', 'too far');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not-applicable/i);
  });
});
