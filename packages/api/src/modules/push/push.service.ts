import { Inject, Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { and, eq, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { driverPushSubscriptions, drivers, pushSubscriptions } from '../../db/schema';

export interface PushSubscribeInput {
  driver_phone: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  user_agent?: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  jobId?: string;
  /**
   * What sort of alert this is, so the service worker can give a win and a
   * "nobody answered" different vibration rhythms. A win should not feel like
   * every other buzz on the phone, and an unanswered call should not
   * impersonate a win. See public/flip-sw.js.
   */
  kind?: 'win' | 'attention' | 'callback' | 'hot';
}

export interface SendResult {
  sent: number;
  removed: number;
  skipped: boolean;
}

/**
 * VAPID web-push delivery for the driver PWA (Session 29).
 *
 * Subscriptions are persisted in `driver_push_subscriptions` (shared with the
 * Session 25 scaffold) keyed by `(tenant_id, endpoint)`, so one driver can have
 * many devices. Drivers are identified by phone across this codebase;
 * `sendToDriver` accepts the `drivers.id` uuid (as stored on
 * `unified_jobs.assigned_driver_id`) and resolves it to a phone before fan-out.
 *
 * If VAPID env vars are unset, `send*` is a logged no-op so the API is safe to
 * deploy before keys are configured — subscriptions still persist.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly publicKey = process.env.VAPID_PUBLIC_KEY ?? '';
  private readonly configured: boolean;

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {
    const privateKey = process.env.VAPID_PRIVATE_KEY ?? '';
    const subject = process.env.VAPID_SUBJECT ?? 'mailto:alerts@ustowdispatch.com';
    this.configured = Boolean(this.publicKey && privateKey);
    if (this.configured) {
      webpush.setVapidDetails(subject, this.publicKey, privateKey);
      this.logger.log('VAPID configured — push delivery enabled');
    } else {
      this.logger.warn('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY unset — push delivery disabled (subscriptions still persist)');
    }
  }

  /** Public VAPID key for the web client to subscribe with ('' if unset). */
  getPublicKey(): string {
    return this.publicKey;
  }

  static normalizePhone(raw: string): string | null {
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) return null;
    if (digits.length === 10) return `+1${digits}`;
    return `+${digits}`;
  }

  /** Persist (upsert) a web-push subscription from a driver device. */
  async subscribe(tenantId: string, input: PushSubscribeInput): Promise<{ id: string; created: boolean }> {
    const phone = PushService.normalizePhone(input.driver_phone);
    if (!phone) throw new Error('Invalid driver_phone — must be 10–15 digits');

    const [row] = await this.db
      .insert(driverPushSubscriptions)
      .values({
        tenantId,
        driverPhone: phone,
        endpoint: input.endpoint,
        p256dhKey: input.keys.p256dh,
        authKey: input.keys.auth,
        userAgent: input.user_agent ?? null,
      })
      .onConflictDoUpdate({
        target: [driverPushSubscriptions.tenantId, driverPushSubscriptions.endpoint],
        set: {
          driverPhone: phone,
          p256dhKey: input.keys.p256dh,
          authKey: input.keys.auth,
          userAgent: input.user_agent ?? null,
          lastSeenAt: new Date(),
        },
      })
      .returning({ id: driverPushSubscriptions.id, createdAt: driverPushSubscriptions.createdAt });

    const created = Date.now() - new Date(row.createdAt).getTime() < 5000;
    return { id: row.id, created };
  }

  /** Remove a subscription by endpoint (device unsubscribed / logged out). */
  async unsubscribe(tenantId: string, endpoint: string): Promise<number> {
    const result = await this.db
      .delete(driverPushSubscriptions)
      .where(
        and(
          eq(driverPushSubscriptions.tenantId, tenantId),
          eq(driverPushSubscriptions.endpoint, endpoint),
        ),
      );
    return (result as { rowCount?: number }).rowCount ?? 0;
  }

  /**
   * Send a push to every device of the driver assigned to a job.
   * `driverId` is the `drivers.id` uuid (as on `unified_jobs.assigned_driver_id`).
   */
  async sendToDriver(tenantId: string, driverId: string, payload: PushPayload): Promise<SendResult> {
    const driver = await this.db.query.drivers.findFirst({
      where: and(eq(drivers.id, driverId), eq(drivers.tenantId, tenantId)),
      columns: { phone: true },
    });
    if (!driver?.phone) {
      this.logger.debug(`sendToDriver: no phone for driver ${driverId} — skipping`);
      return { sent: 0, removed: 0, skipped: true };
    }
    return this.sendToPhone(tenantId, driver.phone, payload);
  }

  /** Fan out a push to all subscriptions registered for a driver phone. */
  async sendToPhone(tenantId: string, phoneRaw: string, payload: PushPayload): Promise<SendResult> {
    const phone = PushService.normalizePhone(phoneRaw);
    if (!phone) return { sent: 0, removed: 0, skipped: true };

    if (!this.configured) {
      this.logger.warn(`Push not sent (VAPID unset): "${payload.title}" → ${phone}`);
      return { sent: 0, removed: 0, skipped: true };
    }

    const subs = await this.db
      .select()
      .from(driverPushSubscriptions)
      .where(
        and(
          eq(driverPushSubscriptions.tenantId, tenantId),
          eq(driverPushSubscriptions.driverPhone, phone),
        ),
      );

    const body = JSON.stringify(payload);
    let sent = 0;
    let removed = 0;

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dhKey, auth: sub.authKey },
            },
            body,
          );
          sent += 1;
          await this.db
            .update(driverPushSubscriptions)
            .set({ lastUsedAt: new Date() })
            .where(eq(driverPushSubscriptions.id, sub.id));
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // Subscription expired/gone — prune it.
            await this.db
              .delete(driverPushSubscriptions)
              .where(eq(driverPushSubscriptions.id, sub.id));
            removed += 1;
            this.logger.log(`Pruned dead push subscription ${sub.id} (status ${statusCode})`);
          } else {
            this.logger.error(`Push send failed for ${sub.id}: ${(err as Error).message}`);
          }
        }
      }),
    );

    return { sent, removed, skipped: false };
  }

  // ==========================================================================
  // Session 77 — manager/admin devices, for flip wins.
  //
  // Deliberately a SEPARATE table from driver_push_subscriptions rather than a
  // sentinel phone number on that one. The two are different subjects with
  // different auth: a driver device is keyed by driver phone and registers with
  // the tenant API key from the driver PWA, while a manager device is
  // tenant-wide and registers with the admin JWT from the flip board. Sharing a
  // table would mean a driver could be pushed a flip win, or a manager could be
  // pushed a job assignment, depending only on how the phone column happened to
  // be filled.
  //
  // The VAPID config, the encryption and the dead-endpoint pruning are all
  // shared, which is the part that actually matters.
  // ==========================================================================

  /** Register a manager/admin device against a tenant. Upsert on endpoint, so a
   *  browser re-subscribing replaces its row instead of adding one — otherwise a
   *  single handset buzzes once per stale row. */
  async subscribeAdminDevice(input: {
    tenantId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    label?: string | null;
    userAgent?: string | null;
  }): Promise<{ ok: true }> {
    await this.db
      .insert(pushSubscriptions)
      .values({
        tenantId: input.tenantId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        label: input.label ?? null,
        userAgent: input.userAgent ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          tenantId: input.tenantId,
          p256dh: input.p256dh,
          auth: input.auth,
          label: input.label ?? null,
          userAgent: input.userAgent ?? null,
          // A device that just re-subscribed is healthy by definition.
          failureCount: 0,
        },
      });
    return { ok: true };
  }

  async unsubscribeAdminDevice(tenantId: string, endpoint: string): Promise<number> {
    const result = await this.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.endpoint, endpoint)));
    return (result as { rowCount?: number }).rowCount ?? 0;
  }

  async listAdminDevices(tenantId: string) {
    return this.db
      .select({
        id: pushSubscriptions.id,
        label: pushSubscriptions.label,
        userAgent: pushSubscriptions.userAgent,
        failureCount: pushSubscriptions.failureCount,
        createdAt: pushSubscriptions.createdAt,
        lastUsedAt: pushSubscriptions.lastUsedAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.tenantId, tenantId));
  }

  /** Fan a payload out to every manager device on a tenant. Never throws: the
   *  caller is the flip-win path, and a dead push endpoint must not disturb the
   *  thing that recorded the win. */
  async sendToTenantAdmins(tenantId: string, payload: PushPayload): Promise<SendResult> {
    if (!this.configured) {
      this.logger.warn(`Push not sent (VAPID unset): "${payload.title}" → tenant ${tenantId}`);
      return { sent: 0, removed: 0, skipped: true };
    }

    const subs = await this.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.tenantId, tenantId));
    if (subs.length === 0) return { sent: 0, removed: 0, skipped: true };

    const body = JSON.stringify(payload);
    let sent = 0;
    let removed = 0;

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
            // urgency high: the entire point is waking a locked device rather
            // than being batched until it is next picked up.
            { TTL: 3600, urgency: 'high' },
          );
          sent += 1;
          await this.db
            .update(pushSubscriptions)
            .set({ lastUsedAt: new Date(), failureCount: 0 })
            .where(eq(pushSubscriptions.id, sub.id));
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // The browser threw the subscription away — PWA uninstalled, site
            // data cleared, permission revoked. It will never work again.
            await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
            removed += 1;
          } else {
            await this.db
              .update(pushSubscriptions)
              .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1` })
              .where(eq(pushSubscriptions.id, sub.id));
            this.logger.error(`Admin push failed for ${sub.id}: ${(err as Error).message}`);
          }
        }
      }),
    );

    // Retire endpoints failing for softer reasons than a 410, so a permanently
    // broken device is not retried on every win forever.
    await this.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.tenantId, tenantId), sql`failure_count >= 8`));

    return { sent, removed, skipped: false };
  }

  /**
   * A towing company rang the campaign number back.
   *
   * Chris, 2026-08-22: he wants these the moment they land so he can look the
   * company up and decide whether to call back himself. They are the strongest
   * signal in the whole campaign — somebody we cold-called cared enough to
   * dial us — and on 2026-08-22 eleven arrived and all eleven lasted under ten
   * seconds. A notification that reaches him while the caller is still nearby
   * is worth more than any disposition report.
   */
  async sendCampaignCallback(
    tenantId: string,
    call: { id: string; phone: string; company: string | null; seconds: number | null },
  ): Promise<void> {
    const who = call.company?.trim();
    try {
      await this.sendToTenantAdmins(tenantId, {
        title: who ? `Callback — ${who}` : 'Callback from a towing company',
        body: [call.phone, call.seconds != null ? `${call.seconds}s` : null]
          .filter(Boolean)
          .join(' · '),
        url: '/admin/campaigns',
        kind: 'callback',
        // One notification per call, so a webhook retry replaces rather than stacks.
        tag: `usta-callback-${call.id}`,
      });
    } catch (err) {
      this.logger.warn(`Callback push failed: ${(err as Error).message}`);
    }
  }

  /**
   * Somebody asked to speak to Chris. This is the loudest thing the campaign
   * can produce and it is deliberately worded differently from an ordinary
   * callback: a callback means somebody rang us, this means somebody is
   * sitting there waiting for Chris to ring them.
   */
  async sendCallbackRequest(
    tenantId: string,
    req: { id: string; company: string | null; name: string | null; phone: string; urgency: string; note: string | null },
  ): Promise<void> {
    const now = req.urgency === 'now';
    try {
      await this.sendToTenantAdmins(tenantId, {
        title: now
          ? `CALL NOW — ${req.company?.trim() || req.name?.trim() || req.phone}`
          : `Wants to talk — ${req.company?.trim() || req.name?.trim() || req.phone}`,
        body: [req.phone, req.name?.trim(), req.note?.trim()].filter(Boolean).join(' · ').slice(0, 160),
        url: '/m/usta',
        kind: 'hot',
        tag: `usta-request-${req.id}`,
      });
    } catch (err) {
      this.logger.warn(`Callback-request push failed: ${(err as Error).message}`);
    }
  }

  /** The flip-win payload, in one place so the wording cannot drift. */
  async sendFlipWin(
    tenantId: string,
    win: { id: string; customerName: string | null; shop: string | null; vehicle: string | null },
  ): Promise<void> {
    const shop = win.shop?.trim();
    try {
      await this.sendToTenantAdmins(tenantId, {
        title: shop ? `Flip win → ${shop}` : 'Flip win',
        body: [win.customerName?.trim() || 'Customer', win.vehicle?.trim()]
          .filter(Boolean)
          .join(' · '),
        url: '/m/flip',
        kind: 'win',
        // Dedupes a redelivery: a retry should replace the notification rather
        // than stack a second one for the same win.
        tag: `flip-win-${win.id}`,
      });
    } catch (err) {
      this.logger.warn(`Flip win push failed: ${(err as Error).message}`);
    }
  }
}
