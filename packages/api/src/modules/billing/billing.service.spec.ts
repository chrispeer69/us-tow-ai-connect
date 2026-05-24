import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BillingService } from './billing.service';
import { billingEvents, tenantBilling, tenants } from '../../db/schema';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const CUSTOMER_ID = 'cus_test_1';

/**
 * Minimal in-memory fake of the drizzle calls BillingService makes. Patch
 * values that are drizzle `sql` fragments (objects, not Date) are skipped when
 * applied — tests assert on scalar columns and drive credit math via the
 * `nextBalance` knob the service reads back from `.returning()`.
 */
function makeDb(initial: {
  billing?: Record<string, any> | null;
  tenant?: Record<string, any> | null;
}) {
  const store = {
    billing: initial.billing ?? null,
    tenant: initial.tenant ?? null,
    events: new Set<string>(),
    nextBalance: 0,
  };

  const applyPatch = (target: Record<string, any> | null, patch: Record<string, any>) => {
    if (!target) return;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (v !== null && typeof v === 'object' && !(v instanceof Date)) continue; // sql fragment
      target[k] = v;
    }
  };

  const db: any = {
    store,
    query: {
      tenants: { findFirst: vi.fn(async () => store.tenant ?? undefined) },
      tenantBilling: { findFirst: vi.fn(async () => store.billing ?? undefined) },
    },
    insert(table: unknown) {
      return {
        values(v: Record<string, any>) {
          return {
            onConflictDoNothing() {
              return {
                returning() {
                  if (table === billingEvents) {
                    if (store.events.has(v.stripeEventId)) return Promise.resolve([]);
                    store.events.add(v.stripeEventId);
                    return Promise.resolve([{ id: 'evt-row' }]);
                  }
                  return Promise.resolve([v]);
                },
              };
            },
            returning() {
              if (table === tenantBilling) store.billing = { ...v };
              return Promise.resolve([store.billing ?? v]);
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(patch: Record<string, any>) {
          return {
            where() {
              const target = table === tenants ? store.tenant : store.billing;
              applyPatch(target, patch);
              return {
                returning() {
                  return Promise.resolve([{ creditBalance: store.nextBalance }]);
                },
                then(resolve: (v: undefined) => void) {
                  resolve(undefined);
                  return Promise.resolve();
                },
              };
            },
          };
        },
      };
    },
  };
  return db;
}

function billingRow(over: Record<string, any> = {}) {
  return {
    tenantId: TENANT_ID,
    plan: 'TRIAL',
    status: 'ACTIVE',
    currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
    stripeCustomerId: CUSTOMER_ID,
    stripeSubscriptionId: null,
    creditBalance: 0,
    perJobBilling: false,
    cancelAtPeriodEnd: false,
    ...over,
  };
}

describe('BillingService.deductCreditForJob', () => {
  it('is a no-op for tenants not on per-job billing', async () => {
    const db = makeDb({ billing: billingRow({ perJobBilling: false, creditBalance: 5 }) });
    const svc = new BillingService(db as never, null);
    const result = await svc.deductCreditForJob(TENANT_ID);
    expect(result.deducted).toBe(false);
    expect(result.reason).toBe('not_per_job');
  });

  it('decrements the balance for per-job tenants', async () => {
    const db = makeDb({ billing: billingRow({ perJobBilling: true, creditBalance: 3 }) });
    db.store.nextBalance = 2;
    const svc = new BillingService(db as never, null);
    const result = await svc.deductCreditForJob(TENANT_ID);
    expect(result.deducted).toBe(true);
    expect(result.creditBalance).toBe(2);
    expect(result.blocked).toBe(false);
  });

  it('raises billing_blocked when the balance hits zero', async () => {
    const db = makeDb({
      billing: billingRow({ perJobBilling: true, creditBalance: 1 }),
      tenant: { id: TENANT_ID, billingBlocked: false },
    });
    db.store.nextBalance = 0;
    const svc = new BillingService(db as never, null);
    const result = await svc.deductCreditForJob(TENANT_ID);
    expect(result.blocked).toBe(true);
    expect(db.store.tenant.billingBlocked).toBe(true);
  });
});

describe('BillingService.applyWebhookEvent — idempotency', () => {
  function subEvent(id: string) {
    return {
      id,
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          customer: CUSTOMER_ID,
          status: 'active',
          cancel_at_period_end: false,
          current_period_start: 1735689600,
          current_period_end: 1738368000,
          items: { data: [{ price: { id: 'price_pro' } }] },
        },
      },
    } as never;
  }

  beforeEach(() => {
    process.env.STRIPE_PRICE_PRO = 'price_pro';
  });
  afterEach(() => {
    delete process.env.STRIPE_PRICE_PRO;
  });

  it('applies an event once and skips redelivery of the same event id', async () => {
    const db = makeDb({ billing: billingRow() });
    const svc = new BillingService(db as never, null);

    const first = await svc.applyWebhookEvent(subEvent('evt_dupe'));
    expect(first.applied).toBe(true);

    const second = await svc.applyWebhookEvent(subEvent('evt_dupe'));
    expect(second.applied).toBe(false);
    expect(second.reason).toBe('duplicate');
  });

  it('transitions the plan + status on customer.subscription.updated', async () => {
    const db = makeDb({ billing: billingRow() });
    const svc = new BillingService(db as never, null);
    await svc.applyWebhookEvent(subEvent('evt_sub_1'));
    expect(db.store.billing.plan).toBe('PRO');
    expect(db.store.billing.status).toBe('ACTIVE');
    expect(db.store.billing.stripeSubscriptionId).toBe('sub_1');
    expect(db.store.billing.perJobBilling).toBe(false);
  });

  it('credits a per-job pack + clears the block on checkout.session.completed', async () => {
    const db = makeDb({
      billing: billingRow({ creditBalance: 0 }),
      tenant: { id: TENANT_ID, billingBlocked: true },
    });
    const svc = new BillingService(db as never, null);
    const event = {
      id: 'evt_pack_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          customer: CUSTOMER_ID,
          client_reference_id: TENANT_ID,
          metadata: { tenantId: TENANT_ID, kind: 'credit_pack', credits: '100' },
        },
      },
    } as never;
    const result = await svc.applyWebhookEvent(event);
    expect(result.applied).toBe(true);
    expect(db.store.billing.perJobBilling).toBe(true);
    expect(db.store.tenant.billingBlocked).toBe(false);
  });
});
