import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, asc, desc, gt, inArray, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import {
  aiAgentConfigs,
  dispatchRequests,
  dispatchMessages,
  etaCheckCalls,
  inboundCallLogs,
  interactionLogs,
  routingRules,
  smartActions,
  tenants,
  unifiedJobs,
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
/** A lookup this soon after the last one is the same conversation, not a repeat caller. */
const REPEAT_CALL_GAP_MINUTES = 10;
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

/** The last ten digits of a phone, so "+1 614..." and "614..." compare equal. */
function last10(digits: string): string {
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export interface LookupByPhoneResult {
  found: boolean;
  /** 2026-09-10 — what found the job: the phone the caller gave, their caller ID, our job number, or the motor-club PO. */
  matchedBy?: 'given' | 'caller_id' | 'job_number' | 'po_number';
  source?: 'TOWBOOK' | 'AAA_PORTAL';
  /**
   * 2026-09-11 — 'active' is the live board. 'completed' / 'canceled' come
   * from our own unified_jobs history when the board has no match: a customer
   * ringing about a tow that finished that morning used to be told "I can't
   * find it" and offered dispatch, which is the wrong answer to "did my car
   * get there?".
   */
  jobState?: 'active' | 'completed' | 'canceled';
  /** ISO timestamp of when the job left the live board (closed jobs only). */
  closedAt?: string;
  /**
   * 2026-09-12 — true when somebody already rang about this job in an
   * EARLIER conversation (an open eta_check_calls row whose last call was
   * more than REPEAT_CALL_GAP_MINUTES ago). Chris: repeat callers who have
   * already heard the thirty-minute line "should auto forward to dispatch".
   * Two lookups inside one conversation do not count as a repeat.
   */
  repeatCall?: boolean;
  /** How many earlier calls that open row had recorded (0 when none). */
  priorCalls?: number;
  job?: {
    jobId: string;
    customerName: string;
    customerPhone: string;
    vehicle: string;
    status: string;
    driverName: string;
    eta: string;
    pickup?: string;
    destination: string;
    lastUpdated: string;
    callNumber?: string;
    poNumber?: string;
  };
  message?: string;
}

/** How far back the closed-job fallback looks. A day covers "it was picked up this morning". */
const CLOSED_JOB_LOOKBACK_HOURS = 24;
const CLOSED_JOB_SCAN_LIMIT = 300;

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
  /**
   * Look a live job up by the number the caller gave, and — 2026-09-10 — by
   * the number they are calling from when the given one finds nothing. Seven
   * of nine not_found lookups in the first ten days of September were callers
   * reading out a different number than the one on the ticket; every one of
   * them ended in a transfer that the caller ID would have avoided.
   */
  async lookupByPhone(
    tenantId: string,
    phoneRaw: string,
    options: { fallbackPhone?: string | null } = {},
  ): Promise<LookupByPhoneResult> {
    return this.lookupJob(tenantId, { phone: phoneRaw, fallbackPhone: options.fallbackPhone });
  }

  /**
   * 2026-09-10 — one lookup, three keys. Chris, from the Towbook board: the
   * job number is what our own people quote, the motor-club PO number is
   * what the club (and many customers) quote, and the phone is how a
   * customer is found. Tried in that order because a job or PO number is
   * unambiguous where a phone can sit on two jobs; the caller ID is last.
   */
  async lookupJob(
    tenantId: string,
    keys: { phone?: string | null; jobNumber?: string | null; poNumber?: string | null; fallbackPhone?: string | null },
  ): Promise<LookupByPhoneResult> {
    const jobNumber = (keys.jobNumber ?? '').replace(/\D/g, '');
    const poNumber = (keys.poNumber ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const phone = (keys.phone ?? '').replace(/\D/g, '');
    const fallback = (keys.fallbackPhone ?? '').replace(/\D/g, '');

    // The matchers, in priority order. Each is tried against the live board
    // first; only when every one misses do we look at closed jobs, so a live
    // job can never be shadowed by yesterday's.
    const matchers: Array<{ by: NonNullable<LookupByPhoneResult['matchedBy']>; test: (j: ActiveJob) => boolean }> = [];
    if (jobNumber) {
      matchers.push({
        by: 'job_number',
        test: (j) => {
          const call = (j.callNumber ?? '').replace(/\D/g, '');
          // A stray leading digit ("one two seven seven four eight" heard as
          // 1127748) must not miss — a Roadside call number is six digits.
          return (
            (call !== '' && (call === jobNumber || (call.length >= 5 && jobNumber.length > call.length && jobNumber.endsWith(call)))) ||
            j.jobId === jobNumber
          );
        },
      });
    }
    if (poNumber) {
      matchers.push({
        by: 'po_number',
        test: (j) => {
          const po = (j.poNumber ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
          return po !== '' && (po === poNumber || (poNumber.length >= 6 && po.endsWith(poNumber)));
        },
      });
    }
    if (phone) {
      matchers.push({ by: 'given', test: (j) => last10(j.customerPhone.replace(/\D/g, '')) === last10(phone) });
    }
    if (fallback && last10(fallback) !== last10(phone)) {
      matchers.push({ by: 'caller_id', test: (j) => last10(j.customerPhone.replace(/\D/g, '')) === last10(fallback) });
    }
    if (matchers.length === 0) {
      return { found: false, message: 'phone is required' };
    }
    for (const m of matchers) {
      const hit = await this.findActiveJob(tenantId, m.test);
      if (hit.found) return { ...hit, matchedBy: m.by, jobState: 'active' };
    }
    const closed = await this.findRecentlyClosedJob(tenantId, matchers);
    if (closed) return closed;
    return { found: false, message: 'No active job found for that phone number' };
  }

  /**
   * 2026-09-11 — the live cache is active jobs only; a job that completed an
   * hour ago is not findable by any key. Six not_found lookups in the first
   * ten days of September were customers ringing about a tow that had
   * already finished. The job-poller keeps every job it has ever seen in
   * unified_jobs with the last board row in source_payload, so the same
   * matchers run over the last day of closed rows. No eta-check row is
   * recorded for these — nobody is waiting on a truck.
   */
  private async findRecentlyClosedJob(
    tenantId: string,
    matchers: Array<{ by: NonNullable<LookupByPhoneResult['matchedBy']>; test: (j: ActiveJob) => boolean }>,
  ): Promise<LookupByPhoneResult | null> {
    const since = new Date(Date.now() - CLOSED_JOB_LOOKBACK_HOURS * 60 * 60 * 1000);
    let rows: Array<{
      sourceJobId: string;
      status: string;
      callerPhone: string | null;
      callerName: string | null;
      sourcePayload: unknown;
      completedAt: Date | null;
      updatedAt: Date;
    }>;
    try {
      rows = await this.db
        .select({
          sourceJobId: unifiedJobs.sourceJobId,
          status: unifiedJobs.status,
          callerPhone: unifiedJobs.callerPhone,
          callerName: unifiedJobs.callerName,
          sourcePayload: unifiedJobs.sourcePayload,
          completedAt: unifiedJobs.completedAt,
          updatedAt: unifiedJobs.updatedAt,
        })
        .from(unifiedJobs)
        .where(
          and(
            eq(unifiedJobs.tenantId, tenantId),
            inArray(unifiedJobs.status, ['completed', 'canceled']),
            gt(unifiedJobs.updatedAt, since),
          ),
        )
        .orderBy(desc(unifiedJobs.updatedAt))
        .limit(CLOSED_JOB_SCAN_LIMIT);
    } catch (err) {
      this.logger.warn(`closed-job lookup failed: ${(err as Error).message}`);
      return null;
    }
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const asJob = (r: (typeof rows)[number]): ActiveJob => {
      const p = (r.sourcePayload && typeof r.sourcePayload === 'object' ? r.sourcePayload : {}) as Partial<ActiveJob>;
      return {
        jobId: p.jobId || r.sourceJobId,
        customerName: p.customerName || r.callerName || '',
        customerPhone: (p.customerPhone || r.callerPhone || '').replace(/\D/g, ''),
        vehicle: p.vehicle || '',
        status: p.status || r.status,
        driverName: p.driverName || '',
        eta: p.eta || 'Unknown',
        pickup: p.pickup || '',
        destination: p.destination || '',
        lastUpdated: p.lastUpdated || r.updatedAt.toISOString(),
        callNumber: p.callNumber || '',
        poNumber: p.poNumber || '',
      };
    };
    for (const m of matchers) {
      for (const r of rows) {
        const job = asJob(r);
        if (!m.test(job)) continue;
        const state: 'completed' | 'canceled' = r.status === 'canceled' ? 'canceled' : 'completed';
        return {
          found: true,
          source: 'TOWBOOK',
          matchedBy: m.by,
          jobState: state,
          closedAt: (r.completedAt ?? r.updatedAt).toISOString(),
          job,
        };
      }
    }
    return null;
  }

  private async findActiveJob(
    tenantId: string,
    matches: (job: ActiveJob) => boolean,
  ): Promise<LookupByPhoneResult> {
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
      const hit = jobs.find(matches);
      if (hit) {
        // Read the counter BEFORE recording this call, so "repeat" means an
        // earlier conversation and not the lookup Emily ran ten seconds ago.
        const prior = await this.priorEtaChecks(tenantId, hit);
        void this.recordEtaCheck(tenantId, source, hit).catch((err) =>
          this.logger.warn(`eta-check record failed: ${(err as Error).message}`),
        );
        return { found: true, source, job: hit, repeatCall: prior.repeat, priorCalls: prior.calls };
      }
    }
    return { found: false, message: 'No active job found for that phone number' };
  }

  /** @deprecated 2026-09-10 — kept for the two older call sites; use lookupJob. */
  private async findActiveJobByPhone(tenantId: string, phoneRaw: string): Promise<LookupByPhoneResult> {
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
   * Has anyone already rung about this job in an earlier conversation?
   * Never throws — a counter read must not cost a stranded caller the answer.
   */
  private async priorEtaChecks(
    tenantId: string,
    job: ActiveJob,
  ): Promise<{ repeat: boolean; calls: number }> {
    try {
      const [row] = await this.db
        .select({ calls: etaCheckCalls.calls, lastCalledAt: etaCheckCalls.lastCalledAt })
        .from(etaCheckCalls)
        .where(
          and(
            eq(etaCheckCalls.tenantId, tenantId),
            eq(etaCheckCalls.jobId, job.jobId),
            eq(etaCheckCalls.customerPhone, job.customerPhone),
            sql`${etaCheckCalls.handledAt} is null`,
          ),
        )
        .orderBy(desc(etaCheckCalls.lastCalledAt))
        .limit(1);
      if (!row) return { repeat: false, calls: 0 };
      const gapMs = Date.now() - new Date(row.lastCalledAt).getTime();
      return { repeat: gapMs > REPEAT_CALL_GAP_MINUTES * 60 * 1000, calls: row.calls };
    } catch (err) {
      this.logger.warn(`eta-check prior read failed: ${(err as Error).message}`);
      return { repeat: false, calls: 0 };
    }
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

  // ─── create tow job (US Tow Dispatch) ──────────────────────────────
  /**
   * Emily books a brand-new tow into US Tow Dispatch.
   *
   * Proxied here rather than Retell calling USTD's phone-intake route
   * directly, because Retell wraps every custom-tool POST body as
   * `{ call, name, args }` and USTD reads the flat body. 2026-09-12:
   * every create_tow_job since the tool was built on 08-23 — four of
   * four, one of them that same morning — came back HTTP 400 "Required"
   * on customer / vehicle / serviceType / pickup. The fields were all
   * there, one level down. Same bug as lookup_job_by_phone and
   * take_dispatch_message (silent-integration incidents 1 and 2); this
   * is incident 7. The route unwraps, forwards with the server-side USTD
   * key (which no longer has to sit in the Retell tool config), stamps
   * the job number onto the inbound call, and tells the office.
   *
   * Always resolves — never throws — because Retell turns a thrown error
   * into an opaque "HTTP 500" string Emily cannot reason about. A
   * `status: 'error'` result is what the prompt's "if create_tow_job
   * fails, do NOT tell them they are booked" line keys on.
   */
  async createTowJob(
    tenantId: string,
    input: { args: Record<string, unknown>; providerCallId: string | null; fromNumber: string | null },
  ): Promise<
    | {
        status: 'success';
        job_number: string | null;
        job_id: string | null;
        price: string | null;
        vin_required_at_pickup: boolean;
        confirmation: string;
      }
    | { status: 'error'; http_status?: number; message: string; errors?: string[] }
  > {
    const apiKey = process.env.USTD_API_KEY;
    if (!apiKey) {
      this.logger.error('create_tow_job: USTD_API_KEY is not set — cannot book a tow');
      return { status: 'error', message: 'Booking is not configured on this line.' };
    }
    const base = (process.env.USTD_API_BASE_URL ?? 'https://api.ustowdispatch.com').replace(/\/$/, '');

    // Retell adds execution_message to args when speak_during_execution
    // is on; USTD's schema does not know it. callReference is the
    // idempotency key — fill it from the call context when the LLM forgot.
    const { execution_message: _spoken, ...payload } = input.args as Record<string, unknown> & {
      execution_message?: unknown;
    };
    if (!payload.callReference && input.providerCallId) payload.callReference = input.providerCallId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let res: Response;
    let text = '';
    try {
      res = await fetch(`${base}/v1/jobs/phone-intake`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          ...(input.providerCallId ? { 'idempotency-key': input.providerCallId } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      text = await res.text();
    } catch (err) {
      this.logger.error(`create_tow_job: US Tow Dispatch unreachable: ${(err as Error).message}`);
      return { status: 'error', message: 'US Tow Dispatch did not answer.' };
    } finally {
      clearTimeout(timer);
    }

    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (!res.ok) {
      const errors = describeUstdErrors(body);
      this.logger.error(
        `create_tow_job: USTD HTTP ${res.status} for call ${input.providerCallId ?? '?'}: ${
          errors.length ? errors.join('; ') : text.slice(0, 400)
        }`,
      );
      return {
        status: 'error',
        http_status: res.status,
        message: 'US Tow Dispatch rejected the booking.',
        ...(errors.length ? { errors } : {}),
      };
    }

    const job = (body ?? {}) as Record<string, unknown>;
    const jobNumber = job.jobNumber != null ? String(job.jobNumber) : null;
    const jobId = typeof job.id === 'string' ? job.id : null;
    const quote = (job.rateQuote ?? null) as { totalCents?: unknown } | null;
    const price =
      quote && typeof quote.totalCents === 'number' ? '$' + (quote.totalCents / 100).toFixed(2) : null;

    this.logger.log(
      `create_tow_job: booked USTD job ${jobNumber ?? jobId ?? '?'} for call ${input.providerCallId ?? '?'}`,
    );

    // Stamp the job number onto the call. The call_ended webhook has not
    // fired yet (we are mid-call), so this is an upsert of a stub row that
    // the webhook later fills in — its onConflict set clause does not
    // touch ustd_job_number, so the stamp survives.
    if (input.providerCallId && jobNumber) {
      try {
        await this.db
          .insert(inboundCallLogs)
          .values({
            tenantId,
            providerCallId: input.providerCallId,
            branch: 'new_tow',
            fromNumber: input.fromNumber,
            ustdJobNumber: jobNumber,
            startedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: inboundCallLogs.providerCallId,
            set: { ustdJobNumber: jobNumber, updatedAt: new Date() },
          });
      } catch (err) {
        this.logger.warn(`create_tow_job: could not stamp job on call log: ${(err as Error).message}`);
      }
    }

    // Tell the office. A booked tow that nobody notices is a stranded
    // caller — same push channel the urgent dispatch messages use.
    try {
      const customer = (payload.customer ?? {}) as { name?: string; phone?: string };
      const vehicle = (payload.vehicle ?? {}) as { year?: number; make?: string; model?: string };
      const pickup = (payload.pickup ?? {}) as { address?: string };
      const car = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'vehicle';
      await this.push.sendToTenantAdmins(tenantId, {
        title: `New tow booked by Emily${jobNumber ? ` — #${jobNumber}` : ''}`,
        body: `${car} at ${pickup.address ?? 'unknown location'} · ${customer.name || 'caller'} ${
          customer.phone ?? ''
        }`.slice(0, 140),
        url: '/m/roadside',
        tag: `new-tow:${jobId ?? jobNumber ?? input.providerCallId ?? Date.now()}`,
      });
    } catch (err) {
      this.logger.warn(`create_tow_job: admin push failed: ${(err as Error).message}`);
    }

    return {
      status: 'success',
      job_number: jobNumber,
      job_id: jobId,
      price,
      vin_required_at_pickup: job.vinRequiredAtPickup === true,
      confirmation:
        "You're all set — I've got you in the system. Dispatch will call you right back on this number with your driver and a time.",
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

/**
 * USTD's error envelope arrives in a flattened, index-referenced form:
 * `[{"title":"2","errors":"4",...}, ..., ["6","7"], ..., {"path":"10","message":"11"}, "customer", "Required"]`
 * — every string in an object is an index into the outer array. Resolve it
 * into "customer: Required" lines so the log (and Emily) can read it. Falls
 * back to whatever `errors` / `message` a plain JSON body carries.
 */
export function describeUstdErrors(body: unknown): string[] {
  const resolve = (node: unknown, table: unknown[], depth = 0): unknown => {
    if (depth > 6) return node;
    if (typeof node === 'string' && /^\d+$/.test(node) && Number(node) < table.length) {
      return resolve(table[Number(node)], table, depth + 1);
    }
    if (Array.isArray(node)) return node.map((n) => resolve(n, table, depth + 1));
    if (node && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, resolve(v, table, depth + 1)]),
      );
    }
    return node;
  };
  let root: unknown = body;
  if (Array.isArray(body) && body.length > 0 && body[0] && typeof body[0] === 'object') {
    root = resolve(body[0], body);
  }
  if (!root || typeof root !== 'object') return [];
  const r = root as { errors?: unknown; message?: unknown; title?: unknown };
  const out: string[] = [];
  if (Array.isArray(r.errors)) {
    for (const e of r.errors) {
      if (e && typeof e === 'object') {
        const { path, message } = e as { path?: unknown; message?: unknown };
        out.push([path, message].filter((x) => typeof x === 'string').join(': '));
      } else if (typeof e === 'string') out.push(e);
    }
  }
  if (!out.length && typeof r.message === 'string') out.push(r.message);
  if (!out.length && typeof r.title === 'string') out.push(r.title);
  return out.filter(Boolean);
}
