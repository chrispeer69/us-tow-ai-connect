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

const DEFAULT_ETA_MINS = 45;
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
      const hit = jobs.find((j) => j.customerPhone.replace(/\D/g, '') === phone);
      if (hit) {
        return { found: true, source, job: hit };
      }
    }
    return { found: false, message: 'No active job found for that phone number' };
  }

  // ─── eta ────────────────────────────────────────────────────────────
  /**
   * Distance/driver-GPS integration is deferred. For v1 we return the
   * configured default ETA from ai_agent_configs (falling back to 45).
   * lat/lng are accepted for forward compatibility and currently unused.
   */
  async estimateEta(tenantId: string, _lat: number | null, _lng: number | null) {
    const cfg = (
      await this.db
        .select({ defaultEtaMins: aiAgentConfigs.defaultEtaMins })
        .from(aiAgentConfigs)
        .where(eq(aiAgentConfigs.tenantId, tenantId))
        .limit(1)
    )[0];
    const eta = cfg?.defaultEtaMins ?? DEFAULT_ETA_MINS;
    return {
      eta_minutes: eta,
      basis: 'default_eta_mins (driver-GPS integration deferred — see ASSUMPTIONS.md)',
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
