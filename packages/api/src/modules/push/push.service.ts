import { Inject, Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { and, eq } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { driverPushSubscriptions, drivers } from '../../db/schema';

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
}
