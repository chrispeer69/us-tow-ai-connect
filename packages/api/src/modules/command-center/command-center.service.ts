import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import {
  drivers,
  jobEvents,
  trucks,
  unifiedJobs,
  type DriverRow,
  type TruckRow,
  type UnifiedJobRow,
} from '../../db/schema';
import { CommandCenterGateway } from './command-center.gateway';
import { GeocoderService } from './geocoder.service';
import { BillingService } from '../billing/billing.service';
import type { UnifiedJobInput, UnifiedJobStatus } from './normalizers/types';

type EnrichedJob = UnifiedJobRow & {
  driver?: DriverRow | null;
  truck?: TruckRow | null;
};

const TERMINAL: ReadonlySet<UnifiedJobStatus> = new Set(['completed', 'canceled', 'declined']);

export interface JobsListQuery {
  status?: string;
  source?: string;
  driverId?: string;
  priority?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ManualJobInput {
  callerName: string;
  callerPhone?: string | null;
  vehicleYear?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleColor?: string | null;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  serviceType?: string | null;
  priority?: 'low' | 'normal' | 'urgent';
  notes?: string | null;
}

export interface UpsertResult {
  job: UnifiedJobRow;
  created: boolean;
  statusChanged: boolean;
}

@Injectable()
export class CommandCenterService {
  private readonly logger = new Logger(CommandCenterService.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly geocoder: GeocoderService,
    private readonly gateway: CommandCenterGateway,
    // Optional: present only when BillingModule is wired (it always is in the
    // running app). Optional injection keeps unit tests that construct the
    // service directly from breaking. Session 28.
    @Optional() private readonly billing?: BillingService,
  ) {}

  async listJobs(tenantId: string, query: JobsListQuery) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);

    const filters = [eq(unifiedJobs.tenantId, tenantId)];
    if (query.status) {
      const list = query.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length) filters.push(inArray(unifiedJobs.status, list));
    }
    if (query.source) {
      const list = query.source.split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length) filters.push(inArray(unifiedJobs.source, list));
    }
    if (query.driverId) {
      filters.push(eq(unifiedJobs.assignedDriverId, query.driverId));
    }
    if (query.priority) {
      filters.push(eq(unifiedJobs.priority, query.priority));
    }
    if (query.search) {
      const term = `%${query.search}%`;
      filters.push(
        or(
          ilike(unifiedJobs.callerName, term),
          ilike(unifiedJobs.callerPhone, term),
          ilike(unifiedJobs.pickupAddress, term),
          ilike(unifiedJobs.dropoffAddress, term),
          ilike(unifiedJobs.sourceJobId, term),
        ) as ReturnType<typeof eq>,
      );
    }

    const where = and(...filters);
    const [rows, totalRow] = await Promise.all([
      this.db.query.unifiedJobs.findMany({
        where,
        orderBy: [desc(unifiedJobs.updatedAt)],
        limit,
        offset,
        with: { driver: true, truck: true },
      }),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(unifiedJobs)
        .where(where),
    ]);

    return {
      items: rows,
      total: totalRow[0]?.count ?? 0,
      limit,
      offset,
    };
  }

  async getJob(tenantId: string, jobId: string) {
    const row = await this.db.query.unifiedJobs.findFirst({
      where: and(eq(unifiedJobs.id, jobId), eq(unifiedJobs.tenantId, tenantId)),
      with: { driver: true, truck: true, events: true },
    });
    if (!row) throw new NotFoundException({ status: 'error', code: 'JOB_NOT_FOUND' });
    const eventRows = await this.db
      .select()
      .from(jobEvents)
      .where(eq(jobEvents.jobId, jobId))
      .orderBy(desc(jobEvents.createdAt));
    return { ...row, events: eventRows };
  }

  async assignJob(tenantId: string, jobId: string, driverId: string | null, truckId: string | null) {
    const existing = await this.requireJob(tenantId, jobId);

    const patch: Partial<UnifiedJobRow> = {
      assignedDriverId: driverId,
      assignedTruckId: truckId,
      updatedAt: new Date(),
    };
    if (driverId && existing.status === 'new') {
      patch.status = 'assigned';
    }

    const [updated] = await this.db
      .update(unifiedJobs)
      .set(patch)
      .where(and(eq(unifiedJobs.id, jobId), eq(unifiedJobs.tenantId, tenantId)))
      .returning();

    await this.writeEvent(jobId, 'assigned', { driverId, truckId, prevDriverId: existing.assignedDriverId });
    this.broadcast(tenantId, 'job.updated', updated);
    return updated;
  }

  async transitionStatus(
    tenantId: string,
    jobId: string,
    nextStatus: UnifiedJobStatus,
    notes?: string,
  ) {
    const existing = await this.requireJob(tenantId, jobId);
    if (existing.status === nextStatus) return existing;

    const now = new Date();
    const patch: Partial<UnifiedJobRow> = { status: nextStatus, updatedAt: now };
    if (nextStatus === 'assigned') patch.acceptedAt = patch.acceptedAt ?? now;
    if (nextStatus === 'en_route') patch.dispatchedAt = patch.dispatchedAt ?? now;
    if (nextStatus === 'on_scene') patch.arrivedAt = patch.arrivedAt ?? now;
    if (TERMINAL.has(nextStatus)) patch.completedAt = patch.completedAt ?? now;

    const [updated] = await this.db
      .update(unifiedJobs)
      .set(patch)
      .where(and(eq(unifiedJobs.id, jobId), eq(unifiedJobs.tenantId, tenantId)))
      .returning();

    await this.writeEvent(jobId, 'status_changed', {
      from: existing.status,
      to: nextStatus,
      notes: notes ?? null,
    });
    this.broadcast(tenantId, 'job.updated', updated);
    return updated;
  }

  async createManualJob(tenantId: string, input: ManualJobInput) {
    const sourceJobId = `manual:${randomUUID()}`;
    const result = await this.upsertJob({
      tenantId,
      source: 'manual',
      sourceJobId,
      sourcePayload: { ...input },
      status: 'new',
      callerPhone: input.callerPhone ?? null,
      callerName: input.callerName,
      vehicleYear: input.vehicleYear ?? null,
      vehicleMake: input.vehicleMake ?? null,
      vehicleModel: input.vehicleModel ?? null,
      vehicleColor: input.vehicleColor ?? null,
      pickupAddress: input.pickupAddress ?? null,
      dropoffAddress: input.dropoffAddress ?? null,
      serviceType: input.serviceType ?? null,
      priority: input.priority ?? 'normal',
      etaMinutes: null,
    });
    return result.job;
  }

  async listDrivers(tenantId: string) {
    return this.db.query.drivers.findMany({
      where: eq(drivers.tenantId, tenantId),
      orderBy: [drivers.name],
    });
  }

  async createDriver(
    tenantId: string,
    input: { name: string; phone?: string | null; status?: 'available' | 'on_job' | 'off_duty' },
  ) {
    const [row] = await this.db
      .insert(drivers)
      .values({
        tenantId,
        name: input.name,
        phone: input.phone ?? null,
        status: input.status ?? 'off_duty',
      })
      .returning();
    this.broadcast(tenantId, 'driver.updated', row);
    return row;
  }

  async updateDriver(
    tenantId: string,
    driverId: string,
    patch: Partial<{
      name: string;
      phone: string | null;
      status: 'available' | 'on_job' | 'off_duty';
      currentLat: number | null;
      currentLng: number | null;
    }>,
  ) {
    const set: Partial<DriverRow> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.phone !== undefined) set.phone = patch.phone;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.currentLat !== undefined) {
      set.currentLat = patch.currentLat === null ? null : String(patch.currentLat);
      set.lastPingAt = new Date();
    }
    if (patch.currentLng !== undefined) {
      set.currentLng = patch.currentLng === null ? null : String(patch.currentLng);
      set.lastPingAt = new Date();
    }

    const [row] = await this.db
      .update(drivers)
      .set(set)
      .where(and(eq(drivers.id, driverId), eq(drivers.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException({ status: 'error', code: 'DRIVER_NOT_FOUND' });
    this.broadcast(tenantId, 'driver.updated', row);
    return row;
  }

  async listTrucks(tenantId: string) {
    return this.db.query.trucks.findMany({
      where: eq(trucks.tenantId, tenantId),
      orderBy: [trucks.name],
    });
  }

  async createTruck(
    tenantId: string,
    input: {
      name: string;
      type?: 'light' | 'medium' | 'heavy' | 'flatbed';
      status?: 'available' | 'in_use' | 'out_of_service';
      assignedDriverId?: string | null;
    },
  ) {
    const [row] = await this.db
      .insert(trucks)
      .values({
        tenantId,
        name: input.name,
        type: input.type ?? 'medium',
        status: input.status ?? 'available',
        assignedDriverId: input.assignedDriverId ?? null,
      })
      .returning();
    return row;
  }

  async updateTruck(
    tenantId: string,
    truckId: string,
    patch: Partial<{
      name: string;
      type: 'light' | 'medium' | 'heavy' | 'flatbed';
      status: 'available' | 'in_use' | 'out_of_service';
      assignedDriverId: string | null;
    }>,
  ) {
    const [row] = await this.db
      .update(trucks)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(trucks.id, truckId), eq(trucks.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException({ status: 'error', code: 'TRUCK_NOT_FOUND' });
    return row;
  }

  async stats(tenantId: string) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [byStatus, bySource, etaRow, totals] = await Promise.all([
      this.db
        .select({ status: unifiedJobs.status, count: sql<number>`count(*)::int` })
        .from(unifiedJobs)
        .where(eq(unifiedJobs.tenantId, tenantId))
        .groupBy(unifiedJobs.status),
      this.db
        .select({ source: unifiedJobs.source, count: sql<number>`count(*)::int` })
        .from(unifiedJobs)
        .where(eq(unifiedJobs.tenantId, tenantId))
        .groupBy(unifiedJobs.source),
      this.db
        .select({ avg: sql<number | null>`avg(eta_minutes)::float` })
        .from(unifiedJobs)
        .where(
          and(
            eq(unifiedJobs.tenantId, tenantId),
            inArray(unifiedJobs.status, ['assigned', 'en_route', 'on_scene', 'in_tow']),
          ),
        ),
      this.db
        .select({
          total24: sql<number>`count(*) filter (where created_at >= ${since})::int`,
          active: sql<number>`count(*) filter (where status not in ('completed','canceled','declined'))::int`,
        })
        .from(unifiedJobs)
        .where(eq(unifiedJobs.tenantId, tenantId)),
    ]);

    const total24 = totals[0]?.total24 ?? 0;
    return {
      activeJobs: totals[0]?.active ?? 0,
      jobsLast24h: total24,
      jobsPerHour: Number((total24 / 24).toFixed(2)),
      avgEtaMinutes: etaRow[0]?.avg ?? null,
      byStatus,
      bySource,
    };
  }

  /**
   * Upsert keyed on (tenantId, source, sourceJobId). Used by the poller and
   * the manual-job endpoint. Geocodes pickup and dropoff on first insert (or
   * when the address text changes), writes job_events, and broadcasts.
   */
  async upsertJob(input: UnifiedJobInput): Promise<UpsertResult> {
    const existing = await this.db.query.unifiedJobs.findFirst({
      where: and(
        eq(unifiedJobs.tenantId, input.tenantId),
        eq(unifiedJobs.source, input.source),
        eq(unifiedJobs.sourceJobId, input.sourceJobId),
      ),
    });

    // Only geocode if the address text is new or has changed.
    const pickupChanged = !existing || existing.pickupAddress !== input.pickupAddress;
    const dropoffChanged = !existing || existing.dropoffAddress !== input.dropoffAddress;

    let pickupLat = existing?.pickupLat ?? null;
    let pickupLng = existing?.pickupLng ?? null;
    if (pickupChanged && input.pickupAddress) {
      const r = await this.geocoder.geocode(input.pickupAddress);
      pickupLat = r ? String(r.lat) : null;
      pickupLng = r ? String(r.lng) : null;
    }
    let dropoffLat = existing?.dropoffLat ?? null;
    let dropoffLng = existing?.dropoffLng ?? null;
    if (dropoffChanged && input.dropoffAddress) {
      const r = await this.geocoder.geocode(input.dropoffAddress);
      dropoffLat = r ? String(r.lat) : null;
      dropoffLng = r ? String(r.lng) : null;
    }

    const valuesBase = {
      tenantId: input.tenantId,
      source: input.source,
      sourceJobId: input.sourceJobId,
      sourcePayload: input.sourcePayload,
      status: input.status,
      callerPhone: input.callerPhone,
      callerName: input.callerName,
      vehicleYear: input.vehicleYear,
      vehicleMake: input.vehicleMake,
      vehicleModel: input.vehicleModel,
      vehicleColor: input.vehicleColor,
      pickupAddress: input.pickupAddress,
      pickupLat,
      pickupLng,
      dropoffAddress: input.dropoffAddress,
      dropoffLat,
      dropoffLng,
      serviceType: input.serviceType,
      priority: input.priority,
      etaMinutes: input.etaMinutes,
      updatedAt: new Date(),
    };

    const [row] = await this.db
      .insert(unifiedJobs)
      .values(valuesBase)
      .onConflictDoUpdate({
        target: [unifiedJobs.tenantId, unifiedJobs.source, unifiedJobs.sourceJobId],
        set: {
          sourcePayload: valuesBase.sourcePayload,
          status: valuesBase.status,
          callerPhone: valuesBase.callerPhone,
          callerName: valuesBase.callerName,
          vehicleYear: valuesBase.vehicleYear,
          vehicleMake: valuesBase.vehicleMake,
          vehicleModel: valuesBase.vehicleModel,
          vehicleColor: valuesBase.vehicleColor,
          pickupAddress: valuesBase.pickupAddress,
          pickupLat: valuesBase.pickupLat,
          pickupLng: valuesBase.pickupLng,
          dropoffAddress: valuesBase.dropoffAddress,
          dropoffLat: valuesBase.dropoffLat,
          dropoffLng: valuesBase.dropoffLng,
          serviceType: valuesBase.serviceType,
          priority: valuesBase.priority,
          etaMinutes: valuesBase.etaMinutes,
          updatedAt: valuesBase.updatedAt,
        },
      })
      .returning();

    const created = !existing;
    const statusChanged = !!existing && existing.status !== input.status;

    if (created) {
      await this.writeEvent(row.id, 'created', { source: input.source });
      this.broadcast(input.tenantId, 'job.created', row);
      await this.chargeJobCredit(input.tenantId, row.id);
    } else if (statusChanged) {
      await this.writeEvent(row.id, 'status_changed', {
        from: existing!.status,
        to: input.status,
        source: 'adapter',
      });
      this.broadcast(input.tenantId, 'job.updated', row);
    } else {
      this.broadcast(input.tenantId, 'job.updated', row);
    }

    return { job: row, created, statusChanged };
  }

  /**
   * Apply an engine decision to a job: records decision metadata on the row
   * and fires an event. Used by DispatchRulesEngineService.
   */
  async recordAutoDecision(
    tenantId: string,
    jobId: string,
    decision: 'accepted' | 'declined' | 'flagged',
    reason: string,
  ): Promise<UnifiedJobRow> {
    const now = new Date();
    const patch: Partial<UnifiedJobRow> = {
      autoDecision: decision,
      autoDecisionReason: reason,
      autoDecidedAt: now,
      updatedAt: now,
    };
    if (decision === 'accepted') {
      patch.status = 'assigned';
      patch.acceptedAt = now;
    } else if (decision === 'declined') {
      patch.status = 'declined';
      patch.completedAt = now;
    }

    const [row] = await this.db
      .update(unifiedJobs)
      .set(patch)
      .where(and(eq(unifiedJobs.id, jobId), eq(unifiedJobs.tenantId, tenantId)))
      .returning();

    await this.writeEvent(jobId, `auto_${decision}`, { reason });
    this.broadcast(tenantId, 'job.updated', row);
    return row;
  }

  private async requireJob(tenantId: string, jobId: string): Promise<UnifiedJobRow> {
    const row = await this.db.query.unifiedJobs.findFirst({
      where: and(eq(unifiedJobs.id, jobId), eq(unifiedJobs.tenantId, tenantId)),
    });
    if (!row) throw new NotFoundException({ status: 'error', code: 'JOB_NOT_FOUND' });
    return row;
  }

  private async writeEvent(jobId: string, type: string, payload: Record<string, unknown>) {
    try {
      await this.db.insert(jobEvents).values({
        jobId,
        eventType: type,
        payload,
        actor: null,
      });
    } catch (err) {
      this.logger.warn(`writeEvent(${type}) failed: ${(err as Error).message}`);
    }
  }

  private broadcast(tenantId: string, event: string, payload: unknown) {
    try {
      this.gateway.broadcast(tenantId, event, payload);
    } catch (err) {
      this.logger.debug(`broadcast ${event} failed: ${(err as Error).message}`);
    }
  }

  /**
   * Deduct one per-job credit when a new job lands (Session 28). No-op for
   * tenants not on per-job billing. When the balance hits zero the tenant is
   * hard-gated and we emit a billing.blocked alert over the socket. Best
   * effort — a billing failure must never drop a tow job.
   */
  private async chargeJobCredit(tenantId: string, jobId: string) {
    if (!this.billing) return;
    try {
      const result = await this.billing.deductCreditForJob(tenantId);
      if (result.blocked) {
        this.broadcast(tenantId, 'billing.blocked', {
          tenantId,
          jobId,
          creditBalance: result.creditBalance,
        });
        this.logger.warn(`Tenant ${tenantId} out of job credits (job ${jobId}) — billing blocked`);
      }
    } catch (err) {
      this.logger.warn(`chargeJobCredit failed for tenant ${tenantId}: ${(err as Error).message}`);
    }
  }
}

export type { EnrichedJob };
