import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { driverPushSubscriptions } from '../../db/schema';
import { DriverPingsService } from './driver-pings.service';

export interface PushSubscribeDto {
  driver_phone: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  user_agent?: string;
}

/**
 * Stores driver web-push subscriptions. Actual push delivery is deferred
 * until VAPID keys are configured — see docs/ASSUMPTIONS.md.
 */
@Injectable()
export class DriverPushService {
  private readonly logger = new Logger(DriverPushService.name);

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  async subscribe(
    tenantId: string,
    dto: PushSubscribeDto,
  ): Promise<{ id: string; created: boolean }> {
    const phone = DriverPingsService.normalizePhone(dto.driver_phone);
    if (!phone) throw new Error('Invalid driver_phone — must be 10–15 digits');

    const upserted = await this.db
      .insert(driverPushSubscriptions)
      .values({
        tenantId,
        driverPhone: phone,
        endpoint: dto.endpoint,
        p256dhKey: dto.keys.p256dh,
        authKey: dto.keys.auth,
        userAgent: dto.user_agent ?? null,
      })
      .onConflictDoUpdate({
        target: [driverPushSubscriptions.tenantId, driverPushSubscriptions.endpoint],
        set: {
          driverPhone: phone,
          p256dhKey: dto.keys.p256dh,
          authKey: dto.keys.auth,
          userAgent: dto.user_agent ?? null,
          lastSeenAt: new Date(),
        },
      })
      .returning({ id: driverPushSubscriptions.id, createdAt: driverPushSubscriptions.createdAt });

    const row = upserted[0];
    const created = Date.now() - new Date(row.createdAt).getTime() < 5000;
    return { id: row.id, created };
  }

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

  async listForDriver(tenantId: string, driverPhoneRaw: string) {
    const phone = DriverPingsService.normalizePhone(driverPhoneRaw);
    if (!phone) return [];
    return this.db
      .select()
      .from(driverPushSubscriptions)
      .where(
        and(
          eq(driverPushSubscriptions.tenantId, tenantId),
          eq(driverPushSubscriptions.driverPhone, phone),
        ),
      );
  }
}
