import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { CheckoutSessionBody, SubscriptionPlanType } from '@ustow/shared';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { billingEvents, tenantBilling, tenants } from '../../db/schema';
import {
  STRIPE_CLIENT,
  type StripeClient,
  type StripeEvent,
  type StripeInstance,
} from './stripe.provider';

/** How many per-job credits one credit-pack purchase grants. */
const CREDIT_PACK_SIZE = Number(process.env.STRIPE_CREDIT_PACK_SIZE ?? 100);

/** Stripe price id env var, keyed by subscription plan. */
const PLAN_PRICE_ENV: Record<SubscriptionPlanType, string> = {
  STARTER: 'STRIPE_PRICE_STARTER',
  PRO: 'STRIPE_PRICE_PRO',
  ENTERPRISE: 'STRIPE_PRICE_ENTERPRISE',
};

// ── Structural views of the Stripe event objects we read. Kept minimal and
//    version-independent (see S28_DECISIONS D9/B3). ─────────────────────────
type CustomerRef = string | { id?: string } | null;
interface SubObject {
  id: string;
  customer: CustomerRef;
  status: string;
  cancel_at_period_end?: boolean;
  current_period_start?: number;
  current_period_end?: number;
  items?: {
    data?: Array<{
      price?: { id?: string };
      current_period_start?: number;
      current_period_end?: number;
    }>;
  };
}
interface InvoiceObject {
  customer: CustomerRef;
}
interface SessionObject {
  id: string;
  customer?: CustomerRef;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
}

export interface BillingStatus {
  plan: string;
  status: string;
  perJobBilling: boolean;
  creditBalance: number;
  billingBlocked: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  recentInvoices: BillingInvoice[];
}

export interface BillingInvoice {
  id: string;
  number: string | null;
  amountPaidCents: number;
  currency: string;
  status: string | null;
  createdAt: string;
  hostedInvoiceUrl: string | null;
  pdfUrl: string | null;
}

export interface ApplyEventResult {
  applied: boolean;
  reason?: string;
  type?: string;
}

export interface DeductResult {
  deducted: boolean;
  creditBalance: number;
  blocked: boolean;
  reason?: string;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    @Inject(STRIPE_CLIENT) private readonly stripe: StripeClient,
  ) {}

  // ── public surface ───────────────────────────────────────────────────

  async getStatus(tenantId: string): Promise<BillingStatus> {
    const billing = await this.ensureBilling(tenantId);
    const tenant = await this.db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });

    let recentInvoices: BillingInvoice[] = [];
    if (this.stripe && billing.stripeCustomerId) {
      recentInvoices = await this.fetchRecentInvoices(billing.stripeCustomerId);
    }

    return {
      plan: billing.plan,
      status: billing.status,
      perJobBilling: billing.perJobBilling,
      creditBalance: billing.creditBalance,
      billingBlocked: tenant?.billingBlocked ?? false,
      stripeCustomerId: billing.stripeCustomerId,
      stripeSubscriptionId: billing.stripeSubscriptionId,
      currentPeriodStart: billing.currentPeriodStart,
      currentPeriodEnd: billing.currentPeriodEnd,
      cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
      recentInvoices,
    };
  }

  async createCheckoutSession(
    tenantId: string,
    body: CheckoutSessionBody,
  ): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    const customerId = await this.ensureCustomer(tenantId);
    const baseUrl = this.webBaseUrl();
    const success = `${baseUrl}/admin/billing?checkout=success`;
    const cancel = `${baseUrl}/admin/billing?checkout=cancel`;

    let session: { url: string | null };
    if (body.kind === 'subscription') {
      const price = this.priceForPlan(body.plan);
      session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price, quantity: 1 }],
        success_url: success,
        cancel_url: cancel,
        client_reference_id: tenantId,
        subscription_data: { metadata: { tenantId, plan: body.plan } },
        metadata: { tenantId, kind: 'subscription', plan: body.plan },
      });
    } else {
      const price = this.requireEnv('STRIPE_PRICE_CREDIT_PACK');
      const quantity = body.quantity ?? 1;
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer: customerId,
        line_items: [{ price, quantity }],
        success_url: success,
        cancel_url: cancel,
        client_reference_id: tenantId,
        payment_intent_data: { metadata: { tenantId, kind: 'credit_pack' } },
        metadata: {
          tenantId,
          kind: 'credit_pack',
          credits: String(CREDIT_PACK_SIZE * quantity),
        },
      });
    }

    if (!session.url) {
      throw new ServiceUnavailableException('Stripe did not return a checkout URL');
    }
    return { url: session.url };
  }

  async getPortalUrl(tenantId: string): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    const customerId = await this.ensureCustomer(tenantId);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${this.webBaseUrl()}/admin/billing`,
    });
    return { url: session.url };
  }

  /**
   * Idempotently apply a verified Stripe event. The unique insert into
   * billing_events is the idempotency gate: a redelivered event collides and
   * the dispatch is skipped, so no event is ever applied twice.
   */
  async applyWebhookEvent(event: StripeEvent): Promise<ApplyEventResult> {
    const tenantId = await this.resolveTenantFromEvent(event);

    const inserted = await this.db
      .insert(billingEvents)
      .values({
        tenantId: tenantId ?? null,
        stripeEventId: event.id,
        type: event.type,
        payload: event as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: billingEvents.stripeEventId })
      .returning({ id: billingEvents.id });

    if (inserted.length === 0) {
      this.logger.log(`Stripe event ${event.id} (${event.type}) already processed — skipping`);
      return { applied: false, reason: 'duplicate', type: event.type };
    }

    await this.dispatch(event);
    this.logger.log(`Applied Stripe event ${event.id} (${event.type}) tenant=${tenantId ?? 'unmapped'}`);
    return { applied: true, type: event.type };
  }

  /**
   * Deduct one per-job credit for a tenant. No-op for tenants not on per-job
   * billing. When the balance reaches zero the tenant is hard-gated
   * (tenants.billing_blocked = true) and the caller should emit an alert.
   */
  async deductCreditForJob(tenantId: string): Promise<DeductResult> {
    const billing = await this.ensureBilling(tenantId);
    if (!billing.perJobBilling) {
      return { deducted: false, creditBalance: billing.creditBalance, blocked: false, reason: 'not_per_job' };
    }

    // Atomic decrement, floored at 0, in a single statement to avoid races
    // between concurrent job ingests.
    const [updated] = await this.db
      .update(tenantBilling)
      .set({
        creditBalance: sql`GREATEST(${tenantBilling.creditBalance} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(tenantBilling.tenantId, tenantId))
      .returning({ creditBalance: tenantBilling.creditBalance });

    const newBalance = updated?.creditBalance ?? 0;
    const blocked = newBalance <= 0;
    if (blocked) {
      await this.db
        .update(tenants)
        .set({ billingBlocked: true, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId));
      this.logger.warn(`Tenant ${tenantId} credit balance exhausted — billing_blocked raised`);
    }
    return { deducted: true, creditBalance: newBalance, blocked };
  }

  // ── webhook dispatch ─────────────────────────────────────────────────

  private async dispatch(event: StripeEvent): Promise<void> {
    const obj = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutCompleted(obj as SessionObject);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.onSubscriptionChange(obj as SubObject);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(obj as SubObject);
        break;
      case 'invoice.paid':
        await this.onInvoicePaid(obj as InvoiceObject);
        break;
      default:
        this.logger.debug(`No handler for Stripe event type ${event.type}`);
    }
  }

  private async onCheckoutCompleted(session: SessionObject): Promise<void> {
    const meta = session.metadata ?? {};
    const tenantId = meta.tenantId ?? session.client_reference_id ?? null;
    if (!tenantId) {
      this.logger.warn(`checkout.session.completed ${session.id} has no tenantId — skipping`);
      return;
    }
    await this.ensureBilling(tenantId);

    if (meta.kind === 'credit_pack') {
      const credits = Number(meta.credits ?? CREDIT_PACK_SIZE);
      await this.db
        .update(tenantBilling)
        .set({
          creditBalance: sql`${tenantBilling.creditBalance} + ${credits}`,
          perJobBilling: true,
          updatedAt: new Date(),
        })
        .where(eq(tenantBilling.tenantId, tenantId));
      // A successful top-up clears any prior hard gate.
      await this.db
        .update(tenants)
        .set({ billingBlocked: false, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId));
      this.logger.log(`Credited ${credits} job credits to tenant ${tenantId}`);
    }
    // Subscription checkouts are reconciled via customer.subscription.created.
  }

  private async onSubscriptionChange(sub: SubObject): Promise<void> {
    const tenantId = await this.tenantForCustomer(sub.customer);
    if (!tenantId) return;
    const plan = this.planForPriceId(sub.items?.data?.[0]?.price?.id);
    const period = readPeriod(sub);
    await this.ensureBilling(tenantId);
    await this.db
      .update(tenantBilling)
      .set({
        plan: plan ?? undefined,
        status: mapSubStatus(sub.status),
        stripeSubscriptionId: sub.id,
        perJobBilling: false,
        cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
        ...(period.start ? { currentPeriodStart: period.start } : {}),
        ...(period.end ? { currentPeriodEnd: period.end } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tenantBilling.tenantId, tenantId));
  }

  private async onSubscriptionDeleted(sub: SubObject): Promise<void> {
    const tenantId = await this.tenantForCustomer(sub.customer);
    if (!tenantId) return;
    await this.db
      .update(tenantBilling)
      .set({
        status: 'CANCELED',
        stripeSubscriptionId: null,
        cancelAtPeriodEnd: false,
        updatedAt: new Date(),
      })
      .where(eq(tenantBilling.tenantId, tenantId));
  }

  private async onInvoicePaid(invoice: InvoiceObject): Promise<void> {
    const tenantId = await this.tenantForCustomer(invoice.customer);
    if (!tenantId) return;
    await this.db
      .update(tenantBilling)
      .set({ status: 'ACTIVE', updatedAt: new Date() })
      .where(eq(tenantBilling.tenantId, tenantId));
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private async ensureCustomer(tenantId: string): Promise<string> {
    const stripe = this.requireStripe();
    const billing = await this.ensureBilling(tenantId);
    if (billing.stripeCustomerId) return billing.stripeCustomerId;

    const tenant = await this.db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });
    const customer = await stripe.customers.create({
      email: tenant?.ownerEmail,
      name: tenant?.companyName,
      metadata: { tenantId },
    });
    await this.db
      .update(tenantBilling)
      .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
      .where(eq(tenantBilling.tenantId, tenantId));
    return customer.id;
  }

  private async fetchRecentInvoices(customerId: string): Promise<BillingInvoice[]> {
    if (!this.stripe) return [];
    try {
      const list = await this.stripe.invoices.list({ customer: customerId, limit: 10 });
      return list.data.map((inv) => ({
        id: inv.id ?? '',
        number: inv.number ?? null,
        amountPaidCents: inv.amount_paid ?? 0,
        currency: inv.currency ?? 'usd',
        status: inv.status ?? null,
        createdAt: new Date((inv.created ?? 0) * 1000).toISOString(),
        hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
        pdfUrl: inv.invoice_pdf ?? null,
      }));
    } catch (err) {
      this.logger.warn(`Failed to list Stripe invoices for ${customerId}: ${(err as Error).message}`);
      return [];
    }
  }

  private async resolveTenantFromEvent(event: StripeEvent): Promise<string | null> {
    const obj = event.data.object as Record<string, unknown>;
    const meta = (obj.metadata as Record<string, string> | undefined) ?? undefined;
    if (meta?.tenantId) return meta.tenantId;
    if (typeof obj.client_reference_id === 'string') return obj.client_reference_id;
    if (obj.customer) return this.tenantForCustomer(obj.customer as CustomerRef);
    return null;
  }

  private async tenantForCustomer(customer: CustomerRef): Promise<string | null> {
    const customerId = typeof customer === 'string' ? customer : customer?.id;
    if (!customerId) return null;
    const row = await this.db.query.tenantBilling.findFirst({
      where: eq(tenantBilling.stripeCustomerId, customerId),
    });
    return row?.tenantId ?? null;
  }

  private planForPriceId(priceId: string | undefined): SubscriptionPlanType | null {
    if (!priceId) return null;
    for (const [plan, envName] of Object.entries(PLAN_PRICE_ENV) as [SubscriptionPlanType, string][]) {
      if (process.env[envName] && process.env[envName] === priceId) return plan;
    }
    return null;
  }

  private priceForPlan(plan: SubscriptionPlanType): string {
    return this.requireEnv(PLAN_PRICE_ENV[plan]);
  }

  private requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new ServiceUnavailableException(`${name} is not configured`);
    }
    return value;
  }

  private requireStripe(): StripeInstance {
    if (!this.stripe) {
      throw new ServiceUnavailableException(
        'Billing is not configured (STRIPE_SECRET_KEY unset)',
      );
    }
    return this.stripe;
  }

  private webBaseUrl(): string {
    return process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000';
  }

  /** Get-or-create the single tenant_billing row, mirroring AdminService. */
  private async ensureBilling(tenantId: string) {
    const existing = await this.db.query.tenantBilling.findFirst({
      where: eq(tenantBilling.tenantId, tenantId),
    });
    if (existing) return existing;
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    const [inserted] = await this.db
      .insert(tenantBilling)
      .values({
        tenantId,
        plan: 'TRIAL',
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      })
      .returning();
    return inserted;
  }
}

function mapSubStatus(status: string): string {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'ACTIVE';
    case 'past_due':
    case 'unpaid':
      return 'PAST_DUE';
    case 'canceled':
    case 'incomplete_expired':
      return 'CANCELED';
    default:
      return status.toUpperCase();
  }
}

/**
 * Stripe moved current_period_start/end onto subscription items in newer API
 * versions while keeping them on the subscription for older ones. Read
 * defensively from either location so plan transitions record a period
 * regardless of the account's pinned API version.
 */
function readPeriod(sub: SubObject): { start: Date | null; end: Date | null } {
  const item = sub.items?.data?.[0];
  const startUnix = sub.current_period_start ?? item?.current_period_start;
  const endUnix = sub.current_period_end ?? item?.current_period_end;
  return {
    start: startUnix ? new Date(startUnix * 1000) : null,
    end: endUnix ? new Date(endUnix * 1000) : null,
  };
}
