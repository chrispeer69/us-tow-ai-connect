import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, asc, desc, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import {
  aiAgentConfigs,
  dispatchRequests,
  interactionLogs,
  routingRules,
  smartActions,
  tenants,
} from '../../db/schema';
import type {
  DispatchRequestCreate,
  LogInteractionRequest,
  SmartActionRequest,
} from '@ustow/shared';
import type { ActiveJob } from '../adapters/adapter.interface';
import { NotificationService } from '../notifications/notification.service';
import { TwilioOutboundService } from '../outbound/twilio-outbound.service';
import { DriverPingsService, type LatestDriverPing } from '../driver-pings/driver-pings.service';
import { GoogleDistanceMatrixService } from '../driver-pings/google-distance-matrix.service';

const DEFAULT_ETA_MINS = 45;
// Pings older than this are ignored when picking "the nearest available
// driver" — a stale ping from 2 hours ago is worse than no ping at all
// because it makes the agent quote a confidently-wrong number.
const PING_FRESHNESS_SECONDS = 20 * 60;
// Drivers further than this from the caller are not considered for live ETA.
// 60 miles ≈ 1 hr drive — beyond that the configured default is more honest.
const MAX_CANDIDATE_DISTANCE_MILES = 60;
const DEFAULT_SERVICES = [
  { key: 'LIGHT_TOW', label: 'Light Duty Tow' },
  { key: 'MEDIUM_TOW', label: 'Medium Duty Tow' },
  { key: 'HEAVY_TOW', label: 'Heavy Duty Tow' },
  { key: 'ROADSIDE', label: 'Roadside Assistance' },
  { key: 'JUMP_START', label: 'Jump Start' },
  { key: 'LOCKOUT', label: 'Lockout' },
  { key: 'TIRE_CHANGE', label: 'Tire Change' },
  { key: 'FUEL_DELIVERY', label: 'Fuel Delivery' },
  { key: 'ACCIDENT_RECOVERY', label: 'Accident Recovery' },
  { key: 'MOTOR_CLUB', label: 'Motor Club Work' },
];

export interface LookupByPhoneResult {
  found: boolean;
  source?: 'TOWBOOK' | 'AAA_PORTAL';
  job?: {
    jobId: string;
    customerName: string;
    customerPhone: string;
    vehicle: string;
    status: string;
    driverName: string;
    eta: string;
    destination: string;
    lastUpdated: string;
  };
  message?: string;
}

@Injectable()
export class AiConnectService {
  private readonly logger = new Logger(AiConnectService.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly notifications: NotificationService,
    private readonly twilio: TwilioOutboundService,
    private readonly driverPings: DriverPingsService,
    private readonly distanceMatrix: GoogleDistanceMatrixService,
  ) {}

  async getActiveTransferRoute(tenantId: string) {
    const rows = await this.db
      .select()
      .from(routingRules)
      .where(and(eq(routingRules.tenantId, tenantId), eq(routingRules.isActiveNow, true)))
      .orderBy(asc(routingRules.priorityOrder))
      .limit(1);
    const rule = rows[0];
    if (!rule) {
      throw new NotFoundException({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'No active routing rule configured',
      });
    }
    return rule;
  }

  async logInteraction(tenantId: string, dto: LogInteractionRequest): Promise<void> {
    await this.db.insert(interactionLogs).values({
      tenantId,
      thinkrrCallId: dto.thinkrr_call_id,
      callerPhone: dto.caller_phone,
      category: dto.category,
      summary: dto.summary,
      outcome: dto.outcome,
      durationSeconds: dto.duration_seconds,
    });
  }

  // ─── lookup-by-phone ────────────────────────────────────────────────
  async lookupByPhone(tenantId: string, phoneRaw: string): Promise<LookupByPhoneResult> {
    const phone = phoneRaw.replace(/\D/g, '');
    if (!phone) {
      return { found: false, message: 'phone is required' };
    }
    const phoneLast10 = phone.length > 10 ? phone.slice(-10) : phone;
    const sources: Array<{ key: string; source: 'TOWBOOK' | 'AAA_PORTAL' }> = [
      { key: `jobs:towbook:${tenantId}`, source: 'TOWBOOK' },
      { key: `jobs:aaa_portal:${tenantId}`, source: 'AAA_PORTAL' },
    ];
    for (const { key, source } of sources) {
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
        const last10 = d.length > 10 ? d.slice(-10) : d;
        return last10 === phoneLast10;
      });
      if (hit) {
        return { found: true, source, job: hit };
      }
    }
    return { found: false, message: 'No active job found for that phone number' };
  }

  // ─── eta ────────────────────────────────────────────────────────────
  /**
   * Live ETA: pick the closest fresh-pinged driver and ask Google Distance
   * Matrix for the driving duration to the caller's location. Falls back to
   * the tenant's configured default ETA at three boundaries:
   *   1. No caller lat/lng supplied (agent didn't geocode the address).
   *   2. No driver_pings rows fresh enough to trust.
   *   3. Distance Matrix returns nothing (API key missing, quota, etc.).
   * The `basis` field surfaces *which* path produced the number so the
   * Thinkrr agent can phrase the response accurately ("our nearest truck is
   * about 18 minutes out" vs "our typical ETA is 45 minutes").
   */
  async estimateEta(tenantId: string, lat: number | null, lng: number | null) {
    const cfg = (
      await this.db
        .select({ defaultEtaMins: aiAgentConfigs.defaultEtaMins })
        .from(aiAgentConfigs)
        .where(eq(aiAgentConfigs.tenantId, tenantId))
        .limit(1)
    )[0];
    const defaultEta = cfg?.defaultEtaMins ?? DEFAULT_ETA_MINS;

    if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
      return {
        eta_minutes: defaultEta,
        basis: 'default_eta_mins (no caller coordinates supplied)',
      };
    }

    let candidates: LatestDriverPing[] = [];
    try {
      candidates = await this.driverPings.listLatestPerDriver(tenantId, {
        maxAgeSeconds: PING_FRESHNESS_SECONDS,
      });
    } catch (err) {
      this.logger.warn(`driver_pings lookup failed: ${(err as Error).message}`);
    }

    const callerPoint = { lat, lng };
    const ranked = candidates
      .map((c) => ({
        ping: c,
        miles: GoogleDistanceMatrixService.haversineMiles(
          { lat: c.lat, lng: c.lng },
          callerPoint,
        ),
      }))
      .filter((c) => c.miles <= MAX_CANDIDATE_DISTANCE_MILES)
      .sort((a, b) => a.miles - b.miles);

    if (ranked.length === 0) {
      return {
        eta_minutes: defaultEta,
        basis: 'default_eta_mins (no fresh driver pings within range)',
      };
    }

    // Ask Distance Matrix for the top N nearest by straight-line distance —
    // shortest miles isn't always shortest driving time (highways), so let
    // Google pick the actual winner from a small shortlist.
    const shortlist = ranked.slice(0, 3);
    let matrix: Awaited<ReturnType<GoogleDistanceMatrixService['durationToPoint']>> = [];
    try {
      matrix = await this.distanceMatrix.durationToPoint(
        shortlist.map((s) => ({ lat: s.ping.lat, lng: s.ping.lng, label: s.ping.driverPhone })),
        callerPoint,
      );
    } catch (err) {
      this.logger.warn(`Distance Matrix call threw: ${(err as Error).message}`);
    }

    if (matrix.length === 0) {
      // Fall back to a haversine-only estimate at a conservative 30 mph
      // surface-street speed. Better than nothing when the API is down.
      const nearest = shortlist[0];
      const minutes = Math.max(5, Math.round((nearest.miles / 30) * 60));
      return {
        eta_minutes: minutes,
        basis: 'haversine_estimate (Distance Matrix unavailable)',
        driver: {
          phone: nearest.ping.driverPhone,
          name: nearest.ping.driverName,
          distance_miles: Number(nearest.miles.toFixed(2)),
          ping_age_seconds: nearest.ping.ageSeconds,
        },
      };
    }

    const winner = matrix.reduce((best, cur) =>
      cur.durationSeconds < best.durationSeconds ? cur : best,
    );
    const winnerPing = shortlist.find(
      (s) => s.ping.lat === winner.origin.lat && s.ping.lng === winner.origin.lng,
    )?.ping;

    const etaMinutes = Math.max(1, Math.round(winner.durationSeconds / 60));
    return {
      eta_minutes: etaMinutes,
      basis: 'distance_matrix (live driver ping + Google driving time)',
      driver: winnerPing
        ? {
            phone: winnerPing.driverPhone,
            name: winnerPing.driverName,
            distance_miles: Number((winner.distanceMeters / 1609.344).toFixed(2)),
            ping_age_seconds: winnerPing.ageSeconds,
          }
        : null,
    };
  }

  // ─── services ───────────────────────────────────────────────────────
  async getServices(tenantId: string) {
    const cfg = (
      await this.db
        .select({
          serviceToggles: aiAgentConfigs.serviceToggles,
          knowledgePack: aiAgentConfigs.knowledgePack,
        })
        .from(aiAgentConfigs)
        .where(eq(aiAgentConfigs.tenantId, tenantId))
        .limit(1)
    )[0];
    const fromToggles = Object.entries(
      (cfg?.serviceToggles ?? {}) as Record<string, { enabled?: boolean }>,
    )
      .filter(([, v]) => v?.enabled)
      .map(([key]) => ({ key, label: key.replace(/_/g, ' ') }));
    const fromKp = (
      (cfg?.knowledgePack as { services?: Array<{ key: string; label: string }> } | undefined)
        ?.services ?? []
    ).filter((s) => s && s.key);

    const merged = new Map<string, { key: string; label: string }>();
    for (const s of [...DEFAULT_SERVICES, ...fromToggles, ...fromKp]) {
      merged.set(s.key, s);
    }
    return { services: Array.from(merged.values()) };
  }

  // ─── dispatch-request ───────────────────────────────────────────────
  async createDispatchRequest(tenantId: string, body: DispatchRequestCreate) {
    const inserted = await this.db
      .insert(dispatchRequests)
      .values({
        tenantId,
        callerName: body.caller_name,
        callerPhone: body.caller_phone,
        vehicleYear: body.vehicle?.year ?? null,
        vehicleMake: body.vehicle?.make ?? null,
        vehicleModel: body.vehicle?.model ?? null,
        vehicleColor: body.vehicle?.color ?? null,
        location: body.location,
        destination: body.destination ?? null,
        reason: body.reason ?? null,
        agentNotes: body.agent_notes ?? null,
        status: 'NEW',
      })
      .returning();
    const row = inserted[0];

    const notified = await this.notifyDispatcher(tenantId, row);
    if (notified) {
      await this.db
        .update(dispatchRequests)
        .set({ dispatcherNotified: true, updatedAt: new Date() })
        .where(eq(dispatchRequests.id, row.id));
    }

    return { dispatch_request_id: row.id, status: row.status, dispatcher_notified: notified };
  }

  private async notifyDispatcher(
    tenantId: string,
    req: {
      callerName: string;
      callerPhone: string;
      vehicleYear: string | null;
      vehicleMake: string | null;
      vehicleModel: string | null;
      vehicleColor: string | null;
      location: string;
      destination: string | null;
      reason: string | null;
    },
  ): Promise<boolean> {
    let dispatchNumber: string | null = null;
    try {
      const rule = await this.getActiveTransferRoute(tenantId);
      dispatchNumber = rule.phoneNumber;
    } catch {
      const tenant = (
        await this.db
          .select({ assignedPhoneNumber: tenants.assignedPhoneNumber })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1)
      )[0];
      dispatchNumber = tenant?.assignedPhoneNumber ?? null;
    }
    if (!dispatchNumber) {
      this.logger.warn(`No dispatch number configured for tenant ${tenantId}`);
      return false;
    }

    const vehicle = [req.vehicleYear, req.vehicleColor, req.vehicleMake, req.vehicleModel]
      .filter(Boolean)
      .join(' ') || 'Unknown vehicle';
    const body =
      `New AI-routed tow request:\n` +
      `Caller: ${req.callerName} (${req.callerPhone})\n` +
      `Vehicle: ${vehicle}\n` +
      `From: ${req.location}\n` +
      (req.destination ? `To: ${req.destination}\n` : '') +
      (req.reason ? `Reason: ${req.reason}\n` : '');

    try {
      await this.twilio.sendDispatchSms(dispatchNumber, body);
      this.logger.log(`Dispatch SMS sent to ${dispatchNumber} for tenant ${tenantId}`);
      return true;
    } catch (err) {
      this.logger.warn(`Dispatch SMS failed: ${(err as Error).message}`);
      return false;
    }
  }

  // ─── smart-action ───────────────────────────────────────────────────
  async recordSmartAction(tenantId: string, dto: SmartActionRequest) {
    const inserted = await this.db
      .insert(smartActions)
      .values({
        tenantId,
        actionType: dto.action_type,
        payload: { ...dto.payload, call_id: dto.call_id ?? null } as never,
        status: 'PENDING',
      })
      .returning();
    const row = inserted[0];
    this.logger.log(`Smart action recorded id=${row.id} type=${dto.action_type}`);
    return { action_id: row.id, status: row.status };
  }

  // ─── admin: list call_interactions ──────────────────────────────────
  async listCallInteractions(
    tenantId: string,
    query: { page?: string; limit?: string },
  ) {
    const { callInteractions } = await import('../../db/schema');
    const page = Math.max(1, Number(query.page ?? 1));
    const rawLimit = Number(query.limit ?? 25);
    const limit = Math.min(Math.max(rawLimit || 25, 1), 100);
    const totalRow = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(callInteractions)
      .where(eq(callInteractions.tenantId, tenantId));
    const total = totalRow[0]?.count ?? 0;
    const items = await this.db
      .select()
      .from(callInteractions)
      .where(eq(callInteractions.tenantId, tenantId))
      .orderBy(desc(callInteractions.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    return { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }
}
