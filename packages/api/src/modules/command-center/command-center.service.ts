import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import type { ActiveJob } from '../adapters/adapter.interface';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import {
  drivers,
  jobEvents,
  outboundCallLogs,
  outboundCalls,
  trucks,
  dispatchMessages,
  etaCheckCalls,
  inboundCallLogs,
  unifiedJobs,
  type DriverRow,
  type OutboundCallRow,
  type TruckRow,
  type UnifiedJobRow,
} from '../../db/schema';
import { CommandCenterGateway } from './command-center.gateway';
import { GeocoderService } from './geocoder.service';
import { BillingService } from '../billing/billing.service';
import { PushService } from '../push/push.service';
import { FlipOrchestratorService } from '../flip-engine/flip-orchestrator.service';
import type { UnifiedJobInput, UnifiedJobStatus } from './normalizers/types';

type EnrichedJob = UnifiedJobRow & {
  driver?: DriverRow | null;
  truck?: TruckRow | null;
  latestCall?: CommandCenterCallSummary | null;
  latestFlip?: CommandCenterFlipSummary | null;
};

export interface CommandCenterCallSummary {
  id: string;
  purpose: string;
  status: string;
  attempts: number;
  durationSeconds: number | null;
  error: string | null;
  transcript: string | null;
  analysisData: unknown;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
}

export interface CommandCenterFlipSummary {
  id: string;
  destinationType: string | null;
  flipEligible: boolean;
  nearestOurShop: string | null;
  flipOutcome: string | null;
  conviniLinkSent: boolean;
  managementNotified: boolean;
  callTime: Date;
}

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
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly geocoder: GeocoderService,
    private readonly gateway: CommandCenterGateway,
    private readonly push: PushService,
    // Optional: present only when BillingModule is wired (it always is in the
    // running app). Optional injection keeps unit tests that construct the
    // service directly from breaking. Session 28. Must be the last parameter
    // because TS does not allow required parameters after an optional one.
    @Optional() private readonly billing?: BillingService,
    // Optional: present only when FlipEngineModule is wired. Triggers the
    // welcome call on every newly-created job when outbound_voice_enabled.
    @Optional() private readonly flipOrchestrator?: FlipOrchestratorService,
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

    const items = await this.attachCallSummaries(tenantId, rows);

    return {
      items,
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
    const [enriched] = await this.attachCallSummaries(tenantId, [{ ...row, events: eventRows }]);
    return { ...enriched, events: eventRows };
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

    // Notify the driver's devices on a *new* assignment. Fire-and-forget:
    // push delivery must never block or fail the assignment write.
    if (driverId && driverId !== existing.assignedDriverId) {
      const where = updated.pickupAddress ? ` — ${updated.pickupAddress}` : '';
      const service = updated.serviceType ?? 'Service call';
      this.push
        .sendToDriver(tenantId, driverId, {
          title: 'New job assigned',
          body: `${service}${where}`,
          url: `/driver?job=${jobId}`,
          tag: `job-${jobId}`,
          jobId,
        })
        .catch((err) => this.logger.error(`push sendToDriver failed: ${(err as Error).message}`));
    }

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

  async callCustomerManually(
    tenantId: string,
    jobId: string,
    opts: {
      scriptType?: 'auto_flip' | 'eta_confirmation' | 'status_update' | 'winch_out' | 'convini_only';
    } = {},
  ) {
    if (!this.flipOrchestrator) {
      throw new BadRequestException({
        status: 'error',
        code: 'OUTBOUND_CALLS_UNAVAILABLE',
        message: 'Outbound call engine is not available.',
      });
    }
    await this.requireJob(tenantId, jobId);
    const result = await this.flipOrchestrator.callUnifiedJobManually(tenantId, jobId, opts);
    await this.writeEvent(jobId, 'manual_customer_call_requested', result);
    return result;
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
      // Fire-and-forget welcome call. The orchestrator gates on
      // tenant.outbound_voice_enabled so no-op when not opted in.
      this.flipOrchestrator
        ?.handleNewlyCreatedJob(input.tenantId, row)
        .catch((err) =>
          this.logger.warn(
            `handleNewlyCreatedJob fire-and-forget error: ${(err as Error).message}`,
          ),
        );
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
   * Archives active jobs for a tenant/source that are missing from the
   * current active scrape list. This acts as the "Cleanup Rule" to remove
   * jobs from the Tow Command dashboard that were completed/canceled in Towbook.
   */
  async archiveMissingJobs(tenantId: string, source: string, activeSourceJobIds: string[]) {
    // If the active array is empty, and we mark everything completed, that might be dangerous 
    // if the scraper simply failed to read the board. But typically if it's empty, it's empty.
    // Drizzle `notInArray` with an empty array can throw, so handle that explicitly.
    const notInClause = activeSourceJobIds.length > 0
      ? sql`${unifiedJobs.sourceJobId} NOT IN ${activeSourceJobIds}`
      : sql`1=1`; // if 0 active jobs on the board, archive ALL active jobs for this tenant/source

    const updated = await this.db
      .update(unifiedJobs)
      .set({ status: 'completed', updatedAt: new Date(), completedAt: new Date() })
      .where(
        and(
          eq(unifiedJobs.tenantId, tenantId),
          eq(unifiedJobs.source, source),
          notInArray(unifiedJobs.status, ['completed', 'canceled', 'declined']),
          notInClause
        )
      )
      .returning();

    for (const job of updated) {
      await this.writeEvent(job.id, 'status_changed', {
        from: 'active',
        to: 'completed',
        source: 'cleanup_rule',
        notes: 'Archived automatically because job disappeared from Towbook active board',
      });
      this.broadcast(tenantId, 'job.updated', job);
    }
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

  private async attachCallSummaries<T extends EnrichedJob>(
    tenantId: string,
    rows: T[],
  ): Promise<Array<T & { latestCall: CommandCenterCallSummary | null; latestFlip: CommandCenterFlipSummary | null }>> {
    if (rows.length === 0) return [];

    const jobIds = rows.map((row) => row.id);
    const phones = Array.from(new Set(rows.map((row) => row.callerPhone).filter(Boolean))) as string[];

    const callRows = await this.db
      .select()
      .from(outboundCalls)
      .where(and(eq(outboundCalls.tenantId, tenantId), inArray(outboundCalls.relatedJobId, jobIds)))
      .orderBy(desc(outboundCalls.createdAt));

    const latestCallByJob = new Map<string, typeof outboundCalls.$inferSelect>();
    for (const call of callRows) {
      if (call.relatedJobId && !latestCallByJob.has(call.relatedJobId)) {
        latestCallByJob.set(call.relatedJobId, call);
      }
    }

    const logRows = phones.length
      ? await this.db
          .select()
          .from(outboundCallLogs)
          .where(
            and(
              eq(outboundCallLogs.tenantId, tenantId),
              inArray(outboundCallLogs.customerPhone, phones),
            ),
          )
          .orderBy(desc(outboundCallLogs.callTime))
      : [];

    const latestFlipByPhone = new Map<string, typeof outboundCallLogs.$inferSelect>();
    for (const log of logRows) {
      if (!latestFlipByPhone.has(log.customerPhone)) {
        latestFlipByPhone.set(log.customerPhone, log);
      }
    }

    return rows.map((row) => {
      const latestPhoneFlip = row.callerPhone ? latestFlipByPhone.get(row.callerPhone) ?? null : null;
      const latestFlip =
        latestPhoneFlip && latestPhoneFlip.callTime >= row.createdAt ? latestPhoneFlip : null;
      return {
        ...row,
        latestCall: summarizeCall(latestCallByJob.get(row.id) ?? null),
        latestFlip: summarizeFlip(latestFlip),
      };
    });
  }

  // ─── ETA check calls ────────────────────────────────────────────────
  //
  // Customers ringing in to ask where their truck is. The office never used to
  // learn this happened at all: Emily answered, the caller hung up, and the
  // first anyone knew was the complaint.

  /**
   * Open ETA-check calls, worst first.
   *
   * Ordered by call count before recency deliberately. Somebody on their third
   * call is a bigger problem than somebody who rang thirty seconds ago, and a
   * plain reverse-chronological list buries them.
   */
  async listEtaChecks(tenantId: string, opts: { includeHandled?: boolean } = {}) {
    const rows = await this.db
      .select()
      .from(etaCheckCalls)
      .where(
        opts.includeHandled
          ? eq(etaCheckCalls.tenantId, tenantId)
          : and(eq(etaCheckCalls.tenantId, tenantId), isNull(etaCheckCalls.handledAt)),
      )
      .orderBy(desc(etaCheckCalls.calls), desc(etaCheckCalls.lastCalledAt))
      .limit(100);

    return rows.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      vehicle: r.vehicle,
      driverName: r.driverName,
      pickup: r.pickup,
      destination: r.destination,
      jobStatus: r.jobStatus,
      // Sent to the office, never to a customer. This is the lateness the
      // caller was deliberately not told about.
      etaRaw: r.etaRaw,
      calls: r.calls,
      firstCalledAt: r.firstCalledAt,
      lastCalledAt: r.lastCalledAt,
      handledAt: r.handledAt,
    }));
  }

  async handleEtaCheck(tenantId: string, id: string, handledBy: string | null) {
    const [row] = await this.db
      .update(etaCheckCalls)
      .set({ handledAt: new Date(), handledBy, updatedAt: new Date() })
      .where(and(eq(etaCheckCalls.tenantId, tenantId), eq(etaCheckCalls.id, id)))
      .returning({ id: etaCheckCalls.id });
    if (!row) throw new NotFoundException('eta check not found');
    return { ok: true };
  }

  // ─── messages for dispatch ──────────────────────────────────────────
  /**
   * Messages Emily took rather than transferring the call.
   *
   * Urgent first, then newest, because a message board that buries the
   * stranded caller under six billing questions is worse than no board.
   */
  async listDispatchMessages(tenantId: string, opts: { includeHandled?: boolean } = {}) {
    const rows = await this.db
      .select()
      .from(dispatchMessages)
      .where(
        opts.includeHandled
          ? eq(dispatchMessages.tenantId, tenantId)
          : and(eq(dispatchMessages.tenantId, tenantId), isNull(dispatchMessages.handledAt)),
      )
      .orderBy(desc(dispatchMessages.urgency), desc(dispatchMessages.createdAt))
      .limit(100);

    return Promise.all(
      rows.map(async (r) => {
        const jobRef = await this.jobRefFromPhone(tenantId, r.callerPhone);
        return {
          id: r.id,
          callerName: r.callerName,
          callerPhone: r.callerPhone,
          jobNumber: r.jobNumber,
          topic: r.topic,
          urgency: r.urgency,
          message: r.message,
          callbackRequested: r.callbackRequested,
          callbackWindow: r.callbackWindow,
          takenAt: r.createdAt,
          handledAt: r.handledAt,
          // Job-board reference only — never authoritative over what Emily
          // actually took down. Populated when the caller's number matches an
          // active Towbook/AAA job at read time.
          jobCustomerName: jobRef?.customerName ?? null,
          jobVehicle: jobRef?.vehicle ?? null,
        };
      }),
    );
  }

  async handleDispatchMessage(tenantId: string, id: string, handledBy: string | null) {
    const [row] = await this.db
      .update(dispatchMessages)
      .set({ handledAt: new Date(), handledBy, updatedAt: new Date() })
      .where(and(eq(dispatchMessages.tenantId, tenantId), eq(dispatchMessages.id, id)))
      .returning({ id: dispatchMessages.id });
    if (!row) throw new NotFoundException('message not found');
    return { ok: true };
  }

  // ─── inbound calls (Emily) ───────────────────────────────────────────
  /**
   * Every call that reached the 844 line — transcript and recording
   * included. Captured since migration 0056 but never surfaced anywhere
   * until now: `inbound_call_logs` had no reader at all.
   *
   * List view omits the transcript body (heaviest column, never needed until
   * a row is opened) — the detail method returns it.
   */
  async listInboundCalls(
    tenantId: string,
    opts: { phone?: string; branch?: string; limit?: number } = {},
  ) {
    const conditions = [eq(inboundCallLogs.tenantId, tenantId)];
    if (opts.phone) {
      // Loose match: callers read digits differently than we store them, and
      // a caller checking on a tow rarely knows the exact stored format.
      const digits = opts.phone.replace(/\D/g, '');
      if (digits) conditions.push(sql`regexp_replace(${inboundCallLogs.fromNumber}, '\\D', '', 'g') like ${'%' + digits}`);
    }
    if (opts.branch) conditions.push(eq(inboundCallLogs.branch, opts.branch));

    const rows = await this.db
      .select({
        id: inboundCallLogs.id,
        providerCallId: inboundCallLogs.providerCallId,
        fromNumber: inboundCallLogs.fromNumber,
        toNumber: inboundCallLogs.toNumber,
        branch: inboundCallLogs.branch,
        durationSeconds: inboundCallLogs.durationSeconds,
        disconnectionReason: inboundCallLogs.disconnectionReason,
        recordingUrl: inboundCallLogs.recordingUrl,
        summary: inboundCallLogs.summary,
        ustdJobNumber: inboundCallLogs.ustdJobNumber,
        startedAt: inboundCallLogs.startedAt,
        createdAt: inboundCallLogs.createdAt,
      })
      .from(inboundCallLogs)
      .where(and(...conditions))
      .orderBy(desc(inboundCallLogs.createdAt))
      .limit(Math.min(opts.limit ?? 100, 200));

    return Promise.all(
      rows.map(async (r) => {
        const jobRef = r.fromNumber ? await this.jobRefFromPhone(tenantId, r.fromNumber) : null;
        return { ...r, jobCustomerName: jobRef?.customerName ?? null, jobVehicle: jobRef?.vehicle ?? null };
      }),
    );
  }

  async getInboundCall(tenantId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(inboundCallLogs)
      .where(and(eq(inboundCallLogs.tenantId, tenantId), eq(inboundCallLogs.id, id)))
      .limit(1);
    if (!row) throw new NotFoundException('call not found');
    return row;
  }

  /**
   * Read-only reference lookup: does the caller's number match an active
   * Towbook/AAA job right now? Same cache and matching rule as
   * AiConnectService.lookupByPhone, duplicated rather than shared because
   * that method also records an ETA-check alert as a side effect — this one
   * must not, since it runs once per row on every dispatch-messages/
   * inbound-calls poll and would spam the office with false "called again"
   * pushes for calls that were never an ETA check.
   *
   * `vehicle` already comes back as one combined "2018 Chevy Trax" string
   * from the adapter — there is no separate year/make/model to join. Motor
   * club name is not available here: the Towbook scraper does not currently
   * capture an account/PO column at all (see towbook.adapter.ts), so there is
   * nothing to look up yet.
   */
  private async jobRefFromPhone(
    tenantId: string,
    phoneRaw: string | null,
  ): Promise<Pick<ActiveJob, 'customerName' | 'vehicle'> | null> {
    if (!phoneRaw) return null;
    const digits = phoneRaw.replace(/\D/g, '');
    if (!digits) return null;
    const phoneLast10 = digits.length > 10 ? digits.slice(-10) : digits;

    for (const key of [`jobs:towbook:${tenantId}`, `jobs:aaa_portal:${tenantId}`]) {
      let raw: string | null = null;
      try {
        raw = await this.redis.get(key);
      } catch (err) {
        this.logger.warn(`Redis read failed for ${key}: ${(err as Error).message}`);
        continue;
      }
      if (!raw) continue;
      let jobs: ActiveJob[];
      try {
        jobs = JSON.parse(raw) as ActiveJob[];
      } catch {
        continue;
      }
      const hit = jobs.find((j) => {
        const d = j.customerPhone.replace(/\D/g, '');
        return (d.length > 10 ? d.slice(-10) : d) === phoneLast10;
      });
      if (hit) return { customerName: hit.customerName, vehicle: hit.vehicle };
    }
    return null;
  }
}

function summarizeCall(call: OutboundCallRow | null): CommandCenterCallSummary | null {
  if (!call) return null;
  return {
    id: call.id,
    purpose: call.purpose,
    status: call.status,
    attempts: call.attempts,
    durationSeconds: call.durationSeconds,
    error: call.error,
    transcript: call.transcript,
    analysisData: call.analysisData,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    createdAt: call.createdAt,
  };
}

function summarizeFlip(
  log: typeof outboundCallLogs.$inferSelect | null,
): CommandCenterFlipSummary | null {
  if (!log) return null;
  return {
    id: log.id,
    destinationType: log.destinationType,
    flipEligible: log.flipEligible,
    nearestOurShop: log.nearestOurShop,
    flipOutcome: log.flipOutcome,
    conviniLinkSent: log.conviniLinkSent,
    managementNotified: log.managementNotified,
    callTime: log.callTime,
  };


}

export type { EnrichedJob };
