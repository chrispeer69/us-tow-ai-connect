import { describe, expect, it } from 'vitest';
import { DigitalDispatchService } from './digital-dispatch.service';

/**
 * Chainable drizzle stub: each `.select()` returns a builder that ignores the
 * query shape and resolves (it's thenable) to the next queued result.
 */
function mockDb(queue: unknown[]) {
  let i = 0;
  const builder = (result: unknown) => {
    const p = Promise.resolve(result);
    const b: Record<string, unknown> = {};
    for (const m of ['from', 'leftJoin', 'innerJoin', 'where', 'orderBy', 'limit', 'offset', 'groupBy']) {
      b[m] = () => b;
    }
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => p.then(res, rej);
    return b;
  };
  return { select: () => builder(queue[i++]) } as never;
}

describe('DigitalDispatchService.listDecisions', () => {
  // Contract test: empty data yields a well-formed empty page. (Note: this
  // passes against the pre-fix code too — innerJoin on empty returns []. It
  // guards the contract, not the 500.)
  it('returns an empty result set when the tenant has no decisions', async () => {
    const db = mockDb([[], [{ count: 0 }]]);
    const svc = new DigitalDispatchService(db, {} as never);
    const res = await svc.listDecisions('tenant-zero', {});
    expect(res).toEqual({ items: [], total: 0, limit: 50, offset: 0 });
  });

  // Regression test for the S42 smoke finding: a throwing query must NOT bubble
  // a 500 — it degrades to an empty result and logs. This is what actually
  // guards the fix.
  it('degrades to an empty result (no throw) when the underlying query fails', async () => {
    const db = {
      select: () => {
        throw new Error('column "evaluated_conditions" does not exist');
      },
    } as never;
    const svc = new DigitalDispatchService(db, {} as never);
    const res = await svc.listDecisions('tenant-zero', {});
    expect(res).toEqual({ items: [], total: 0, limit: 50, offset: 0 });
  });

  it('clamps limit/offset and preserves them in the empty response', async () => {
    const db = mockDb([[], [{ count: 0 }]]);
    const svc = new DigitalDispatchService(db, {} as never);
    const res = await svc.listDecisions('tenant-zero', { limit: 9999, offset: 5 });
    expect(res).toEqual({ items: [], total: 0, limit: 200, offset: 5 });
  });
});
