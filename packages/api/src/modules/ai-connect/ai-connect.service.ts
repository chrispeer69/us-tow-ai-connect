import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, asc, desc, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import {
  aiAgentConfigs,
  dispatchRequests,
  dispatchMessages,
  etaCheckCalls,
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
import { TrackingService } from '../tracking/tracking.service';
import { PushService } from '../push/push.service';

const DEFAULT_ETA_MINS = 45;
// Emily may call the lookup more than once in a single conversation. Alerting
// on each one teaches Chris to ignore the notification.
const ALERT_QUIET_MINUTES = 15;
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
    private readonly tracking: TrackingService,
    private readonly push: PushService,
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
        // Record it, but never let alerting break the lookup. Emily is mid-call
        // with somebody stranded; a failed insert must not cost them the answer.
        void this.recordEtaCheck(tenantId, source, hit).catch((err) =>
          this.logger.warn(`eta-check record failed: ${(err as Error).message}`),
        );
        return { found: true, source, job: hit };
      }
    }
    return { found: false, message: 'No active job found for that phone number' };
  }

  /**
   * Log that a customer rang about a job, and tell the office.
   *
   * Upserts on (tenant, job, caller) so repeat calls raise a counter rather
   * than a pile of rows. Re-alerts only when the last call was more than
   * ALERT_QUIET_MINUTES ago: Emily can call the lookup more than once inside a
   * single conversation, and three pushes for one phone call trains Chris to
   * ignore the notification, which is worse than not sending it.
   */
  private async recordEtaCheck(
    tenantId: string,
    source: 'TOWBOOK' | 'AAA_PORTAL',
    job: ActiveJob,
  ): Promise<void> {
    const now = new Date();
    const quietBefore = new Date(now.getTime() - ALERT_QUIET_MINUTES * 60 * 1000);

    const [row] = await this.db
      .insert(etaCheckCalls)
      .values({
        tenantId,
        jobId: job.jobId,
        source,
        customerName: job.customerName || null,
        customerPhone: job.customerPhone,
        vehicle: job.vehicle || null,
        driverName: job.driverName || null,
        pickup: job.pickup || null,
        destination: job.destination || null,
        jobStatus: job.status || null,
        etaRaw: job.eta || null,
      })
      .onConflictDoUpdate({
        target: [etaCheckCalls.tenantId, etaCheckCalls.jobId, etaCheckCalls.customerPhone],
        targetWhere: sql`${etaCheckCalls.handledAt} is null`,
        set: {
          calls: sql`${etaCheckCalls.calls} + 1`,
          lastCalledAt: now,
          // Refresh the board snapshot — the lateness may have grown since the
          // first call, and that change is the whole story.
          etaRaw: job.eta || null,
          jobStatus: job.status || null,
          driverName: job.driverName || null,
          updatedAt: now,
        },
      })
      .returning({
        id: etaCheckCalls.id,
        calls: etaCheckCalls.calls,
        notifiedAt: etaCheckCalls.notifiedAt,
        lastCalledAt: etaCheckCalls.lastCalledAt,
      });

    if (!row) return;

    const isRepeat = row.calls > 1;
    const quiet = row.notifiedAt !== null && row.notifiedAt > quietBefore;
    if (quiet) return;

    const who = job.customerName || job.customerPhone;
    await this.push.sendToTenantAdmins(tenantId, {
      title: isRepeat
        ? `${who} called again — ${row.calls} times now`
        : `${who} called for an ETA`,
      body: [job.vehicle, job.driverName ? `driver ${job.driverName}` : null, job.status]
        .filter(Boolean)
        .join(' · '),
      url: '/m/roadside',
      tag: `eta-check:${row.id}`,
    });

    await this.db
      .update(etaCheckCalls)
      .set({ notifiedAt: now, updatedAt: now })
      .where(eq(etaCheckCalls.id, row.id));
  }

  // ─── messages for dispatch ──────────────────────────────────────────
  /**
   * Emily takes a message instead of handing the call over.
   *
   * The first live intake call is the argument for this method existing. The
   * caller gave a complete, correct tow intake — safe, callback, location,
   * fault, destination, vehicle, drivetrain, keys — and then said he had a
   * Convini membership. Emily had two moves, answer it or transfer, and she
   * did not know what Convini was, so she transferred. The finished intake
   * went with her and no job was created. One unanswerable fact at the end of
   * a call destroyed everything the call had earned.
   *
   * So: she files the job, takes the awkward part down as a message, and the
   * office reads it here. A message is never a substitute for a transfer when
   * somebody is unsafe or angry — those still go straight through.
   */
  async takeDispatchMessage(
    tenantId: string,
    input: {
      callerPhone: string;
      message: string;
      callerName?: string | null;
      jobNumber?: string | null;
      topic?: string | null;
      urgency?: string | null;
      callbackRequested?: boolean | null;
      callbackWindow?: string | null;
      providerCallId?: string | null;
    },
  ) {
    const now = new Date();
    const urgency = input.urgency === 'urgent' ? 'urgent' : 'normal';
    const topic = (input.topic || 'other').slice(0, 60);

    const values = {
      tenantId,
      providerCallId: input.providerCallId || null,
      callerName: input.callerName || null,
      callerPhone: input.callerPhone,
      jobNumber: input.jobNumber || null,
      topic,
      urgency,
      message: input.message,
      callbackRequested: input.callbackRequested ?? true,
      callbackWindow: input.callbackWindow || null,
      updatedAt: now,
    };

    // A tool retry inside one call must not post the message twice. With no
    // call id we cannot tell a retry from a second genuine message, and two
    // copies of a message is a far smaller failure than losing one.
    const [row] = input.providerCallId
      ? await this.db
          .insert(dispatchMessages)
          .values(values)
          .onConflictDoUpdate({
            target: [dispatchMessages.tenantId, dispatchMessages.providerCallId],
            targetWhere: sql`${dispatchMessages.providerCallId} is not null`,
            set: {
              message: values.message,
              topic: values.topic,
              urgency: values.urgency,
              callerName: values.callerName,
              jobNumber: values.jobNumber,
              callbackRequested: values.callbackRequested,
              callbackWindow: values.callbackWindow,
              updatedAt: now,
            },
          })
          .returning({ id: dispatchMessages.id })
      : await this.db.insert(dispatchMessages).values(values).returning({ id: dispatchMessages.id });

    const who = input.callerName || input.callerPhone;
    await this.push.sendToTenantAdmins(tenantId, {
      title: urgency === 'urgent' ? `URGENT message — ${who}` : `Message from ${who}`,
      body: input.message.slice(0, 140),
      url: '/m/roadside',
      tag: `dispatch-message:${row.id}`,
    });

    // Emily reads this back to the caller, so it has to be a sentence she can
    // say without editing it.
    return {
      status: 'success',
      messageId: row.id,
      confirmation: 'Your message is on the dispatch board now.',
    };
  }

  // ─── claim lookup (ClaimShield) ────────────────────────────────────
  /**
   * A motor club rep asking about a damage claim they opened against us.
   * ClaimShield (ustowshield.com) is a separate product Chris runs — this
   * is a live read-only passthrough, not data we own or cache. The service
   * credential lives in Railway (`CLAIMSHIELD_API_KEY`), never in the
   * agent prompt: Emily calls this endpoint, she never sees the key.
   *
   * Returns only what is safe for Emily to say out loud. Money fields
   * (settlement, unauthorized-deduction amounts, counter-offers) are
   * deliberately left out of the spoken summary — same rule as job pricing:
   * she can report status and facts, she cannot negotiate or quote a
   * dollar figure. `raw` carries the untrimmed record for logging only.
   */
  async lookupClaim(
    input: { claimId?: string | null; jobReference?: string | null; vinLast6?: string | null },
  ): Promise<{ found: boolean; message?: string; claim?: Record<string, unknown> }> {
    const claimId = (input.claimId || '').trim();
    const jobReference = (input.jobReference || '').trim();
    const vinLast6 = (input.vinLast6 || '').trim();
    if (!claimId && !jobReference && !vinLast6) {
      return { found: false, message: 'claim_id, job_reference, or vin_last6 is required' };
    }

    const key = process.env.CLAIMSHIELD_API_KEY;
    if (!key) {
      this.logger.warn('CLAIMSHIELD_API_KEY unset — claim lookup skipped');
      return { found: false, message: 'Claim lookup is not configured' };
    }

    const params = new URLSearchParams();
    if (claimId) params.set('claimId', claimId);
    else if (jobReference) params.set('jobReference', jobReference);
    else params.set('vin', vinLast6);

    let body: { results?: Array<Record<string, unknown>> };
    try {
      const res = await fetch(`https://www.ustowshield.com/api/v1/claims/lookup?${params}`, {
        headers: { 'X-Api-Key': key },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        this.logger.warn(`ClaimShield lookup HTTP ${res.status} for ${params}`);
        return { found: false, message: 'Claim lookup failed' };
      }
      body = (await res.json()) as typeof body;
    } catch (err) {
      this.logger.warn(`ClaimShield lookup error: ${(err as Error).message}`);
      return { found: false, message: 'Claim lookup failed' };
    }

    const hit = body.results?.[0];
    if (!hit) {
      return { found: false, message: 'No claim found matching that' };
    }

    const vehicle = hit.vehicle as
      | { year?: number; make?: string; model?: string; color?: string | null }
      | undefined;
    const customer = hit.customer as { name?: string | null } | undefined;
    // Sort by timestamp rather than trust array order — ClaimShield returns
    // newest-first today, but "last element" silently became the OLDEST note
    // once that assumption was wrong, and Emily would read it to a caller as
    // current. Never trust position for "latest" again.
    //
    // Chris, 2026-08-26: she should read through ALL the notes before
    // answering, not just the newest one — a single note out of context can
    // read very differently than the arc of the investigation. Only 'note'
    // events carry that narrative; document uploads and review-routing
    // events are noise for a spoken summary. Capped at 12 so a long-running
    // claim doesn't blow up the tool response.
    const events = (hit.events as Array<{ type?: string; content?: string; at?: string }> | undefined) ?? [];
    const notes = events
      .filter((e) => e.type === 'note' && e.content && e.at)
      .sort((a, b) => new Date(b.at as string).getTime() - new Date(a.at as string).getTime())
      .slice(0, 12)
      .map((e) => ({ at: e.at, content: e.content }));

    return {
      found: true,
      claim: {
        claimId: hit.claimId,
        status: hit.status,
        jobReference: hit.jobReference,
        claimDescription: hit.claimDescription,
        motorClubName: hit.motorClubName,
        vehicle: vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') : null,
        customerName: customer?.name ?? null,
        // Newest first — the tool description tells Emily to read the whole
        // list before answering, not just notes[0].
        notes,
        lastContactAt: hit.lastContactAt,
      },
    };
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

    // Session 24: auto-create a tracking link + SMS the caller. Best-effort —
    // a tracking failure should never block dispatch creation (which the
    // human dispatcher is also notified about via SMS independently).
    let tracking: { tracking_url: string; token: string; expires_at: string } | null = null;
    try {
      const created = await this.tracking.create(tenantId, {
        callerPhone: body.caller_phone,
        callerName: body.caller_name,
        jobId: row.id,
      });
      tracking = {
        tracking_url: created.tracking_url,
        token: created.token,
        expires_at: created.expires_at,
      };
    } catch (err) {
      this.logger.warn(`Tracking link creation failed: ${(err as Error).message}`);
    }

    return {
      dispatch_request_id: row.id,
      status: row.status,
      dispatcher_notified: notified,
      tracking,
    };
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
