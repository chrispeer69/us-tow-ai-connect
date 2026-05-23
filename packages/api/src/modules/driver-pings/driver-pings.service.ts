import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { DriverPingCreate } from '@ustow/shared';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { driverPings, type DriverPingRow } from '../../db/schema';

export interface LatestDriverPing {
  driverPhone: string;
  driverName: string | null;
  lat: number;
  lng: number;
  heading: number | null;
  speedMph: number | null;
  accuracyM: number | null;
  batteryPct: number | null;
  recordedAt: Date;
  ageSeconds: number;
}

@Injectable()
export class DriverPingsService {
  private readonly logger = new Logger(DriverPingsService.name);

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  /**
   * Normalize a free-form phone string to E.164. Accepts `+1 (740) 812-9489`,
   * `7408129489`, `17408129489` etc. and returns `+17408129489`.
   * Anything that can't be coerced to 10–15 digits returns null.
   */
  static normalizePhone(raw: string): string | null {
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) return null;
    if (digits.length === 10) return `+1${digits}`;
    return `+${digits}`;
  }

  async record(tenantId: string, dto: DriverPingCreate): Promise<DriverPingRow> {
    const phone = DriverPingsService.normalizePhone(dto.driver_phone);
    if (!phone) {
      throw new Error('Invalid driver_phone — must be 10–15 digits');
    }
    const recordedAt = dto.recorded_at ? new Date(dto.recorded_at) : new Date();
    const inserted = await this.db
      .insert(driverPings)
      .values({
        tenantId,
        driverPhone: phone,
        driverName: dto.driver_name ?? null,
        lat: dto.lat.toString(),
        lng: dto.lng.toString(),
        heading: dto.heading != null ? dto.heading.toString() : null,
        speedMph: dto.speed_mph != null ? dto.speed_mph.toString() : null,
        accuracyM: dto.accuracy_m != null ? dto.accuracy_m.toString() : null,
        batteryPct: dto.battery_pct ?? null,
        source: dto.source ?? 'manual',
        recordedAt,
      })
      .returning();
    return inserted[0];
  }

  /**
   * Returns the most recent ping per driver_phone for this tenant. Uses a
   * Postgres DISTINCT ON to fold the ping history down to one row per driver
   * in a single query — cheaper than N "latest per driver" sub-selects when
   * the tenant has many drivers.
   */
  async listLatestPerDriver(
    tenantId: string,
    opts: { maxAgeSeconds?: number } = {},
  ): Promise<LatestDriverPing[]> {
    const maxAge = opts.maxAgeSeconds ?? null;
    const rows = await this.db.execute(sql`
      SELECT DISTINCT ON (driver_phone)
        driver_phone,
        driver_name,
        lat::float8 AS lat,
        lng::float8 AS lng,
        heading::float8 AS heading,
        speed_mph::float8 AS speed_mph,
        accuracy_m::float8 AS accuracy_m,
        battery_pct,
        recorded_at
      FROM driver_pings
      WHERE tenant_id = ${tenantId}
        ${maxAge != null ? sql`AND recorded_at > now() - (${maxAge} || ' seconds')::interval` : sql``}
      ORDER BY driver_phone, recorded_at DESC
    `);
    const now = Date.now();
    return (rows.rows as Array<Record<string, unknown>>).map((r) => {
      const recordedAt = new Date(r.recorded_at as string);
      return {
        driverPhone: r.driver_phone as string,
        driverName: (r.driver_name as string | null) ?? null,
        lat: r.lat as number,
        lng: r.lng as number,
        heading: (r.heading as number | null) ?? null,
        speedMph: (r.speed_mph as number | null) ?? null,
        accuracyM: (r.accuracy_m as number | null) ?? null,
        batteryPct: (r.battery_pct as number | null) ?? null,
        recordedAt,
        ageSeconds: Math.floor((now - recordedAt.getTime()) / 1000),
      };
    });
  }

  async listHistoryForDriver(
    tenantId: string,
    driverPhoneRaw: string,
    limit = 50,
  ): Promise<DriverPingRow[]> {
    const phone = DriverPingsService.normalizePhone(driverPhoneRaw);
    if (!phone) return [];
    return this.db
      .select()
      .from(driverPings)
      .where(and(eq(driverPings.tenantId, tenantId), eq(driverPings.driverPhone, phone)))
      .orderBy(desc(driverPings.recordedAt))
      .limit(Math.min(Math.max(limit, 1), 500));
  }
}
