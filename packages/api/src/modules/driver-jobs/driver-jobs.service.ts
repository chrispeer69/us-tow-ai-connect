import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { driverJobEvents, unifiedJobs } from '../../db/schema';
import { DriverPingsService } from '../driver-pings/driver-pings.service';

const ACTIVE_STATUSES = ['assigned', 'en_route', 'on_scene', 'in_tow'] as const;
const QUEUE_STATUSES = ['new', 'pending', 'flagged', 'auto_accepted'] as const;
const COMPLETED_STATUSES = ['completed', 'closed', 'cancelled', 'cancel'] as const;

const EVENT_TO_JOB_STATUS: Record<string, string | null> = {
  accept: 'assigned',
  decline: 'unassigned',
  en_route: 'en_route',
  on_scene: 'on_scene',
  in_tow: 'in_tow',
  completed: 'completed',
  cancel: 'cancelled',
};

export interface DriverJobRow {
  job_id: string | null;
  source: string | null;
  status: string | null;
  caller_name: string | null;
  caller_phone: string | null;
  vehicle: { year?: string; make?: string; model?: string; color?: string } | null;
  pickup_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_address: string | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  service_type: string | null;
  priority: string | null;
  eta_minutes: number | null;
  payout_estimate: number | null;
  assigned_at: Date | null;
  completed_at: Date | null;
}

export interface DriverJobStatusUpdate {
  status: string;
  notes?: string;
  lat?: number;
  lng?: number;
}

/**
 * Driver-facing read view over the Command Center's `unified_jobs` table.
 *
 * Two important invariants:
 *   - This module never blocks on `unified_jobs` being present. If the
 *     parallel session migrating it is behind, every read returns empty
 *     and `updateStatus` still writes the audit event — the missing-table
 *     condition is logged to BLOCKERS.md (idempotent append).
 *   - Driver lookup is by E.164 phone, never by uuid. The Command Center
 *     correlates these at write time via `drivers.phone`.
 */
@Injectable()
export class DriverJobsService {
  private readonly logger = new Logger(DriverJobsService.name);
  private unifiedJobsAvailable: boolean | null = null;

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  private async hasUnifiedJobs(): Promise<boolean> {
    if (this.unifiedJobsAvailable !== null) return this.unifiedJobsAvailable;
    try {
      await this.db.execute(sql`SELECT 1 FROM unified_jobs LIMIT 1`);
      this.unifiedJobsAvailable = true;
    } catch (err) {
      this.logger.warn(
        `unified_jobs table not reachable — driver-jobs running in degraded mode: ${(err as Error).message}`,
      );
      this.appendBlocker(
        'unified_jobs table not present when driver-jobs first queried — driver app served empty job list',
      );
      this.unifiedJobsAvailable = false;
    }
    return this.unifiedJobsAvailable;
  }

  private appendBlocker(message: string): void {
    try {
      const blockersPath = path.resolve(process.cwd(), 'docs', 'BLOCKERS.md');
      if (!fs.existsSync(blockersPath)) return;
      const existing = fs.readFileSync(blockersPath, 'utf8');
      const tag = `[driver-jobs:${message.slice(0, 60)}]`;
      if (existing.includes(tag)) return;
      const stamp = new Date().toISOString();
      fs.appendFileSync(
        blockersPath,
        `\n\n### driver-jobs runtime (${stamp})\n\n- ${message}\n- Tag: ${tag}\n`,
      );
    } catch {
      /* best-effort logger, never throws */
    }
  }

  /**
   * Single active job for a driver, or null. Ordering by `dispatchedAt DESC`
   * picks the most recently assigned job if (somehow) two are active —
   * shouldn't happen, but the driver UI only renders one.
   */
  async getActive(tenantId: string, driverPhoneRaw: string): Promise<DriverJobRow | null> {
    const phone = DriverPingsService.normalizePhone(driverPhoneRaw);
    if (!phone) return null;
    if (!(await this.hasUnifiedJobs())) return null;
    const rows = await this.db.execute(sql`
      SELECT uj.id, uj.source, uj.status, uj.caller_phone, uj.caller_name,
             uj.vehicle_year, uj.vehicle_make, uj.vehicle_model, uj.vehicle_color,
             uj.pickup_address, uj.pickup_lat::float8 AS pickup_lat, uj.pickup_lng::float8 AS pickup_lng,
             uj.dropoff_address, uj.dropoff_lat::float8 AS dropoff_lat, uj.dropoff_lng::float8 AS dropoff_lng,
             uj.service_type, uj.priority, uj.eta_minutes,
             (uj.source_payload->>'estimated_payout')::float8 AS payout_estimate,
             uj.dispatched_at, uj.completed_at, uj.updated_at, uj.created_at
      FROM unified_jobs uj
      LEFT JOIN drivers d ON d.id = uj.assigned_driver_id
      WHERE uj.tenant_id = ${tenantId}
        AND d.phone = ${phone}
        AND status = ANY(${[...ACTIVE_STATUSES]})
      ORDER BY dispatched_at DESC NULLS LAST, updated_at DESC
      LIMIT 1
    `);
    const row = rows.rows[0];
    return row ? this.mapJobRow(row) : null;
  }

  async getQueue(tenantId: string, driverPhoneRaw: string): Promise<DriverJobRow[]> {
    const phone = DriverPingsService.normalizePhone(driverPhoneRaw);
    if (!phone) return [];
    if (!(await this.hasUnifiedJobs())) return [];
    const rows = await this.db.execute(sql`
      SELECT uj.id, uj.source, uj.status, uj.caller_phone, uj.caller_name,
             uj.vehicle_year, uj.vehicle_make, uj.vehicle_model, uj.vehicle_color,
             uj.pickup_address, uj.pickup_lat::float8 AS pickup_lat, uj.pickup_lng::float8 AS pickup_lng,
             uj.dropoff_address, uj.dropoff_lat::float8 AS dropoff_lat, uj.dropoff_lng::float8 AS dropoff_lng,
             uj.service_type, uj.priority, uj.eta_minutes,
             (uj.source_payload->>'estimated_payout')::float8 AS payout_estimate,
             uj.dispatched_at, uj.completed_at, uj.updated_at, uj.created_at
      FROM unified_jobs uj
      LEFT JOIN drivers d ON d.id = uj.assigned_driver_id
      WHERE uj.tenant_id = ${tenantId}
        AND d.phone = ${phone}
        AND status = ANY(${[...QUEUE_STATUSES]})
      ORDER BY priority DESC, created_at ASC
      LIMIT 50
    `);
    return rows.rows.map((r) => this.mapJobRow(r));
  }

  /**
   * Completed jobs in the trailing window. Includes cancelled to give the
   * driver visibility on what got pulled. `limit` is clamped 1–200.
   */
  async getHistory(
    tenantId: string,
    driverPhoneRaw: string,
    opts: { limit?: number; days?: number } = {},
  ): Promise<DriverJobRow[]> {
    const phone = DriverPingsService.normalizePhone(driverPhoneRaw);
    if (!phone) return [];
    if (!(await this.hasUnifiedJobs())) return [];
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 200);
    const days = Math.min(Math.max(opts.days ?? 30, 1), 180);
    const rows = await this.db.execute(sql`
      SELECT uj.id, uj.source, uj.status, uj.caller_phone, uj.caller_name,
             uj.vehicle_year, uj.vehicle_make, uj.vehicle_model, uj.vehicle_color,
             uj.pickup_address, uj.pickup_lat::float8 AS pickup_lat, uj.pickup_lng::float8 AS pickup_lng,
             uj.dropoff_address, uj.dropoff_lat::float8 AS dropoff_lat, uj.dropoff_lng::float8 AS dropoff_lng,
             uj.service_type, uj.priority, uj.eta_minutes,
             (uj.source_payload->>'estimated_payout')::float8 AS payout_estimate,
             uj.dispatched_at, uj.completed_at, uj.updated_at, uj.created_at
      FROM unified_jobs uj
      LEFT JOIN drivers d ON d.id = uj.assigned_driver_id
      WHERE uj.tenant_id = ${tenantId}
        AND d.phone = ${phone}
        AND status = ANY(${[...COMPLETED_STATUSES]})
        AND completed_at > now() - (${days} || ' days')::interval
      ORDER BY completed_at DESC
      LIMIT ${limit}
    `);
    return rows.rows.map((r) => this.mapJobRow(r));
  }

  /**
   * Records the driver-side event, then *attempts* to update unified_jobs
   * status. The audit write is always durable; the unified_jobs update is
   * best-effort so a missing table or stale job id never loses the event.
   */
  async updateStatus(
    tenantId: string,
    driverPhoneRaw: string,
    jobId: string,
    body: DriverJobStatusUpdate,
  ): Promise<{ event_id: string; unified_jobs_updated: boolean }> {
    const phone = DriverPingsService.normalizePhone(driverPhoneRaw);
    if (!phone) throw new Error('Invalid driver_phone — must be 10–15 digits');
    const event = await this.db
      .insert(driverJobEvents)
      .values({
        tenantId,
        driverPhone: phone,
        jobId,
        eventType: body.status,
        notes: body.notes ?? null,
        lat: body.lat != null ? body.lat.toString() : null,
        lng: body.lng != null ? body.lng.toString() : null,
      })
      .returning();

    let unifiedUpdated = false;
    const targetStatus = EVENT_TO_JOB_STATUS[body.status];
    if (targetStatus && (await this.hasUnifiedJobs())) {
      try {
        const patch: Record<string, unknown> = {
          status: targetStatus,
          updatedAt: new Date(),
        };
        if (body.status === 'en_route') patch.dispatchedAt = new Date();
        if (body.status === 'on_scene') patch.arrivedAt = new Date();
        if (body.status === 'completed') patch.completedAt = new Date();
        if (body.status === 'accept') patch.acceptedAt = new Date();
        const result = await this.db
          .update(unifiedJobs)
          .set(patch)
          .where(and(eq(unifiedJobs.tenantId, tenantId), eq(unifiedJobs.id, jobId)))
          .returning({ id: unifiedJobs.id });
        unifiedUpdated = result.length > 0;
      } catch (err) {
        this.logger.warn(
          `unified_jobs status update failed (${(err as Error).message}) — audit event still recorded`,
        );
        this.appendBlocker(
          `unified_jobs update failed for job ${jobId} (status=${body.status}): ${(err as Error).message}`,
        );
      }
    }

    return { event_id: event[0].id, unified_jobs_updated: unifiedUpdated };
  }

  /**
   * Recent driver-side events for a phone — used by the admin "driver history"
   * side panel on the live map. Bounded by tenant + limit.
   */
  async listEvents(
    tenantId: string,
    driverPhoneRaw: string,
    limit = 50,
  ): Promise<typeof driverJobEvents.$inferSelect[]> {
    const phone = DriverPingsService.normalizePhone(driverPhoneRaw);
    if (!phone) return [];
    return this.db
      .select()
      .from(driverJobEvents)
      .where(
        and(eq(driverJobEvents.tenantId, tenantId), eq(driverJobEvents.driverPhone, phone)),
      )
      .orderBy(desc(driverJobEvents.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200));
  }

  private mapJobRow(r: Record<string, unknown>): DriverJobRow {
    const vehicleParts = {
      year: (r.vehicle_year as string | null) ?? undefined,
      make: (r.vehicle_make as string | null) ?? undefined,
      model: (r.vehicle_model as string | null) ?? undefined,
      color: (r.vehicle_color as string | null) ?? undefined,
    };
    const vehicle = Object.values(vehicleParts).some(Boolean) ? vehicleParts : null;
    return {
      job_id: (r.id as string) ?? null,
      source: (r.source as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      caller_name: (r.caller_name as string | null) ?? null,
      caller_phone: (r.caller_phone as string | null) ?? null,
      vehicle,
      pickup_address: (r.pickup_address as string | null) ?? null,
      pickup_lat: (r.pickup_lat as number | null) ?? null,
      pickup_lng: (r.pickup_lng as number | null) ?? null,
      dropoff_address: (r.dropoff_address as string | null) ?? null,
      dropoff_lat: (r.dropoff_lat as number | null) ?? null,
      dropoff_lng: (r.dropoff_lng as number | null) ?? null,
      service_type: (r.service_type as string | null) ?? null,
      priority: (r.priority as string | null) ?? null,
      eta_minutes: (r.eta_minutes as number | null) ?? null,
      payout_estimate: (r.payout_estimate as number | null) ?? null,
      assigned_at: r.dispatched_at ? new Date(r.dispatched_at as string) : null,
      completed_at: r.completed_at ? new Date(r.completed_at as string) : null,
    };
  }
}
