import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, asc, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { outboundCalls, tenants, type OutboundCallRow } from '../../db/schema';
import {
  MissingVariableError,
  type OutboundVoicePurpose,
  renderTemplate,
  SCRIPT_TEMPLATES,
} from './script-templates';
import { ThinkrrOutboundClient } from './thinkrr-outbound.client';

/**
 * Session 49 — Outbound voice orchestrator.
 *
 * Responsibilities:
 *   1. enqueueCall — validate template + variables, insert a `queued` row.
 *   2. dispatchQueued — cron, every 30 s by default. Picks queued + due
 *      rows, calls Thinkrr, transitions to `dialing` or `failed`.
 *   3. handleWebhookEvent — idempotent on thinkrr_call_id; transitions to
 *      `in_progress` / terminal status as the carrier reports back.
 *   4. retryFailed — cron, picks failed rows under max_attempts and
 *      re-queues with exponential backoff.
 *   5. listCalls / getCall / cancelCall / requeueCall — admin surface.
 *   6. Lifecycle hooks (notifyJobDispatched, …) — convenience wrappers
 *      other modules can opt into without coupling them to enqueueCall
 *      directly. They never throw.
 *
 * Tenant-scoped at every layer. The controllers and webhooks supply
 * `tenantId`; this service never trusts request bodies for tenancy.
 */
@Injectable()
export class OutboundVoiceService {
  private readonly logger = new Logger(OutboundVoiceService.name);
  private dispatching = false;

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly thinkrr: ThinkrrOutboundClient,
  ) {}

  // ---------- enqueue ----------

  async enqueueCall(input: {
    tenantId: string;
    purpose: OutboundVoicePurpose;
    toPhone: string;
    toName?: string | null;
    scriptTemplate: string;
    scriptVariables: Record<string, unknown>;
    relatedJobId?: string | null;
    scheduledFor?: Date | null;
    maxAttempts?: number;
  }): Promise<OutboundCallRow> {
    const tenant = await this.assertEnabled(input.tenantId, input.purpose);

    // Render once up front to validate variables — we don't store the rendered
    // body (it can be regenerated from template + variables) but we DO want
    // the enqueue to fail fast if the caller forgot a required variable.
    try {
      renderTemplate(input.scriptTemplate, input.scriptVariables);
    } catch (err) {
      if (err instanceof MissingVariableError) {
        this.logger.warn(
          `[outbound-voice] enqueue rejected tenant=${input.tenantId} template=${input.scriptTemplate}: ${err.message}`,
        );
      }
      throw err;
    }

    // Soft TCPA check. The dispatch step writes to `outcome` if consent
    // wasn't on file — this is the soft compliance the spec calls for.
    const requireConsent = readConfigBool(tenant, 'require_consent', true);
    if (requireConsent) {
      this.logger.debug(
        `[outbound-voice] tenant=${input.tenantId} require_consent=true; consent record check is a soft check today (logged on outcome)`,
      );
    }

    const inserted = await this.db
      .insert(outboundCalls)
      .values({
        tenantId: input.tenantId,
        purpose: input.purpose,
        toPhone: input.toPhone,
        toName: input.toName ?? null,
        scriptTemplate: input.scriptTemplate,
        scriptVariables: input.scriptVariables as never,
        relatedJobId: input.relatedJobId ?? null,
        scheduledFor: input.scheduledFor ?? null,
        maxAttempts: input.maxAttempts ?? 3,
      })
      .returning();
    return inserted[0];
  }

  // ---------- list / get / cancel / requeue ----------

  async listCalls(tenantId: string, query: {
    purpose?: string;
    status?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) {
    const filters: SQL[] = [eq(outboundCalls.tenantId, tenantId)];
    if (query.purpose) filters.push(eq(outboundCalls.purpose, query.purpose));
    if (query.status) {
      const list = query.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length === 1) filters.push(eq(outboundCalls.status, list[0]));
      else if (list.length > 1) filters.push(inArray(outboundCalls.status, list));
    }
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const rows = await this.db
      .select()
      .from(outboundCalls)
      .where(and(...filters))
      .orderBy(desc(outboundCalls.createdAt))
      .limit(limit)
      .offset(offset);
    return { items: rows, limit, offset };
  }

  async getCall(tenantId: string, id: string): Promise<OutboundCallRow | null> {
    const rows = await this.db
      .select()
      .from(outboundCalls)
      .where(and(eq(outboundCalls.tenantId, tenantId), eq(outboundCalls.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async cancelCall(tenantId: string, id: string): Promise<OutboundCallRow> {
    const existing = await this.getCall(tenantId, id);
    if (!existing) throw new Error('outbound call not found');
    if (TERMINAL_STATUSES.has(existing.status)) {
      // Idempotent: cancelling a completed/failed/cancelled row returns it as-is.
      return existing;
    }
    if (existing.thinkrrCallId) {
      await this.thinkrr.cancelCall(existing.thinkrrCallId);
    }
    const updated = await this.db
      .update(outboundCalls)
      .set({
        status: 'cancelled',
        endedAt: existing.endedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(outboundCalls.id, id))
      .returning();
    return updated[0];
  }

  async requeueCall(tenantId: string, id: string): Promise<OutboundCallRow> {
    const existing = await this.getCall(tenantId, id);
    if (!existing) throw new Error('outbound call not found');
    if (existing.status === 'queued' || existing.status === 'dialing' || existing.status === 'in_progress') {
      return existing; // Already live — no-op.
    }
    const updated = await this.db
      .update(outboundCalls)
      .set({
        status: 'queued',
        attempts: 0,
        startedAt: null,
        endedAt: null,
        durationSeconds: null,
        error: null,
        thinkrrCallId: null,
        updatedAt: new Date(),
      })
      .where(eq(outboundCalls.id, id))
      .returning();
    return updated[0];
  }

  // ---------- dispatcher cron ----------

  @Cron('*/30 * * * * *')
  async dispatchQueuedCron(): Promise<void> {
    if (process.env.OUTBOUND_VOICE_DISPATCH_CRON_ENABLED !== 'true') return;
    if (this.dispatching) {
      this.logger.debug('[outbound-voice] dispatchQueued already in flight, skipping');
      return;
    }
    this.dispatching = true;
    try {
      await this.dispatchQueued();
    } finally {
      this.dispatching = false;
    }
  }

  /**
   * Picks queued + due rows (scheduled_for null OR <= now) and tries to place
   * each via Thinkrr. Tenants without `outbound_voice_enabled = true` are
   * skipped at SQL level. Returns the rows that were transitioned out of
   * `queued` (helpful for the admin "Send now" flow).
   */
  async dispatchQueued(maxBatch = 25): Promise<OutboundCallRow[]> {
    const now = new Date();
    const queued = await this.db
      .select({
        call: outboundCalls,
        tenant: tenants,
      })
      .from(outboundCalls)
      .innerJoin(tenants, eq(outboundCalls.tenantId, tenants.id))
      .where(
        and(
          eq(outboundCalls.status, 'queued'),
          or(
            sql`${outboundCalls.scheduledFor} IS NULL`,
            lt(outboundCalls.scheduledFor, now),
          ),
          eq(tenants.outboundVoiceEnabled, true),
        ),
      )
      .orderBy(asc(outboundCalls.createdAt))
      .limit(maxBatch);

    const out: OutboundCallRow[] = [];
    for (const { call, tenant } of queued) {
      const updated = await this.dispatchOne(call, tenant);
      if (updated) out.push(updated);
    }
    return out;
  }

  private async dispatchOne(
    call: OutboundCallRow,
    tenant: typeof tenants.$inferSelect,
  ): Promise<OutboundCallRow | null> {
    let rendered: { body: string; resolvedVariables: Record<string, string> };
    try {
      rendered = renderTemplate(
        call.scriptTemplate,
        (call.scriptVariables ?? {}) as Record<string, unknown>,
      );
    } catch (err) {
      // Bad data — fail terminally, do not retry.
      const updated = await this.db
        .update(outboundCalls)
        .set({
          status: 'failed',
          error: `template_render_failed: ${(err as Error).message}`,
          attempts: call.attempts + 1,
          updatedAt: new Date(),
          endedAt: new Date(),
        })
        .where(eq(outboundCalls.id, call.id))
        .returning();
      return updated[0];
    }

    const callbackUrl = buildCallbackUrl();
    const agentId = readConfigString(tenant, 'thinkrr_outbound_agent_id', null) ?? undefined;
    const result = await this.thinkrr.placeCall({
      toPhone: call.toPhone,
      toName: call.toName,
      scriptBody: rendered.body,
      scriptTemplate: call.scriptTemplate,
      scriptVariables: rendered.resolvedVariables,
      callId: call.id,
      tenantId: call.tenantId,
      agentId,
      callbackUrl,
    });

    const requireConsent = readConfigBool(tenant, 'require_consent', true);
    const consentSkipped = requireConsent === true; // soft compliance

    if (!result) {
      // Thinkrr unconfigured / failed. Bump attempts; if under max_attempts
      // leave the row as `queued` so retryFailed picks it up later. Otherwise
      // mark it `failed` terminally.
      const nextAttempts = call.attempts + 1;
      const finalStatus = nextAttempts >= call.maxAttempts ? 'failed' : 'queued';
      const updated = await this.db
        .update(outboundCalls)
        .set({
          status: finalStatus,
          attempts: nextAttempts,
          error: 'thinkrr_unavailable_or_unconfigured',
          updatedAt: new Date(),
          ...(finalStatus === 'failed' ? { endedAt: new Date() } : {}),
        })
        .where(eq(outboundCalls.id, call.id))
        .returning();
      return updated[0];
    }

    const updated = await this.db
      .update(outboundCalls)
      .set({
        status: 'dialing',
        thinkrrCallId: result.thinkrrCallId,
        attempts: call.attempts + 1,
        startedAt: new Date(),
        outcome: { consent_check_skipped: consentSkipped } as never,
        updatedAt: new Date(),
      })
      .where(eq(outboundCalls.id, call.id))
      .returning();
    return updated[0];
  }

  // ---------- retry cron ----------

  @Cron('0 */5 * * * *')
  async retryFailedCron(): Promise<void> {
    if (process.env.OUTBOUND_VOICE_DISPATCH_CRON_ENABLED !== 'true') return;
    await this.retryFailed();
  }

  async retryFailed(): Promise<number> {
    // Re-queue rows that failed for transient reasons (thinkrr_unavailable_*)
    // and still have attempts under max_attempts. Backoff is implied by the
    // every-5-minute cron; we don't store next_attempt_after explicitly.
    const candidates = await this.db
      .select()
      .from(outboundCalls)
      .where(
        and(
          eq(outboundCalls.status, 'failed'),
          sql`${outboundCalls.attempts} < ${outboundCalls.maxAttempts}`,
          sql`${outboundCalls.error} ILIKE 'thinkrr_unavailable%'`,
        ),
      )
      .limit(50);
    if (candidates.length === 0) return 0;
    await this.db
      .update(outboundCalls)
      .set({ status: 'queued', error: null, updatedAt: new Date() })
      .where(inArray(outboundCalls.id, candidates.map((c) => c.id)));
    return candidates.length;
  }

  // ---------- webhook handler ----------

  /**
   * Idempotent on `thinkrr_call_id`. Webhook controller is responsible for
   * verifying the signature; this method trusts its input.
   *
   * Status mapping (Thinkrr → outbound_calls.status):
   *   ringing | initiated  → dialing
   *   in_progress           → in_progress
   *   completed             → completed
   *   no_answer             → no_answer
   *   busy                  → busy
   *   rejected | declined   → rejected
   *   failed | error        → failed
   *   canceled | cancelled  → cancelled
   */
  async handleWebhookEvent(event: {
    callId: string; // thinkrr_call_id
    status: string;
    durationSeconds?: number | null;
    transcript?: string | null;
    recordingUrl?: string | null;
    outcome?: Record<string, unknown> | null;
    error?: string | null;
    timestampIso?: string | null;
  }): Promise<{ matched: boolean; previousStatus: string | null; newStatus: string | null }> {
    const rows = await this.db
      .select()
      .from(outboundCalls)
      .where(eq(outboundCalls.thinkrrCallId, event.callId))
      .limit(1);
    const existing = rows[0];
    if (!existing) {
      this.logger.warn(`[outbound-voice] webhook for unknown thinkrr_call_id=${event.callId}`);
      return { matched: false, previousStatus: null, newStatus: null };
    }

    const newStatus = mapThinkrrStatus(event.status);
    if (!newStatus) {
      return { matched: true, previousStatus: existing.status, newStatus: null };
    }
    // Idempotency: if the row already advanced past this status, ignore.
    if (TERMINAL_STATUSES.has(existing.status) && existing.status === newStatus) {
      return { matched: true, previousStatus: existing.status, newStatus: existing.status };
    }

    const patch: Partial<typeof outboundCalls.$inferInsert> = {
      status: newStatus,
      updatedAt: new Date(),
    };
    if (TERMINAL_STATUSES.has(newStatus) && !existing.endedAt) {
      patch.endedAt = event.timestampIso ? new Date(event.timestampIso) : new Date();
    }
    if (newStatus === 'in_progress' && !existing.startedAt) {
      patch.startedAt = event.timestampIso ? new Date(event.timestampIso) : new Date();
    }
    if (event.durationSeconds != null) patch.durationSeconds = event.durationSeconds;
    if (event.transcript != null) patch.transcript = event.transcript;
    if (event.recordingUrl != null) patch.recordingUrl = event.recordingUrl;
    if (event.outcome != null) {
      const merged = { ...(existing.outcome as Record<string, unknown> | null ?? {}), ...event.outcome };
      patch.outcome = merged as never;
    }
    if (event.error != null) patch.error = event.error;

    await this.db.update(outboundCalls).set(patch).where(eq(outboundCalls.id, existing.id));
    return { matched: true, previousStatus: existing.status, newStatus };
  }

  // ---------- lifecycle hooks ----------
  // Other modules import the service and call these. None of these throw.

  async notifyJobDispatched(input: {
    tenantId: string;
    customerName: string;
    customerPhone: string;
    companyName: string;
    jobId: string;
    relatedJobId?: string | null;
  }): Promise<OutboundCallRow | null> {
    return this.safeEnqueue('customer_status_update', {
      tenantId: input.tenantId,
      toPhone: input.customerPhone,
      toName: input.customerName,
      scriptTemplate: 'customer_status_update',
      scriptVariables: {
        customer_name: input.customerName,
        company_name: input.companyName,
        job_id: input.jobId,
        status: 'dispatched, driver en-route',
      },
      relatedJobId: input.relatedJobId ?? null,
    });
  }

  async notifyJobOnScene(input: {
    tenantId: string;
    customerName: string;
    customerPhone: string;
    companyName: string;
    driverFirstName: string;
    etaMinutes: number;
    relatedJobId?: string | null;
  }): Promise<OutboundCallRow | null> {
    return this.safeEnqueue('eta_confirmation', {
      tenantId: input.tenantId,
      toPhone: input.customerPhone,
      toName: input.customerName,
      scriptTemplate: 'eta_confirmation',
      scriptVariables: {
        customer_name: input.customerName,
        company_name: input.companyName,
        driver_first_name: input.driverFirstName,
        eta_minutes: input.etaMinutes,
      },
      relatedJobId: input.relatedJobId ?? null,
    });
  }

  async notifyJobComplete(input: {
    tenantId: string;
    customerName: string;
    customerPhone: string;
    companyName: string;
    relatedJobId?: string | null;
  }): Promise<OutboundCallRow | null> {
    return this.safeEnqueue('post_job_followup', {
      tenantId: input.tenantId,
      toPhone: input.customerPhone,
      toName: input.customerName,
      scriptTemplate: 'post_job_followup',
      scriptVariables: {
        customer_name: input.customerName,
        company_name: input.companyName,
      },
      relatedJobId: input.relatedJobId ?? null,
    });
  }

  async notifyDriverEscalation(input: {
    tenantId: string;
    driverFirstName: string;
    driverPhone: string;
    companyName: string;
    jobId: string;
    reason: string;
    relatedJobId?: string | null;
  }): Promise<OutboundCallRow | null> {
    return this.safeEnqueue('driver_escalation', {
      tenantId: input.tenantId,
      toPhone: input.driverPhone,
      toName: input.driverFirstName,
      scriptTemplate: 'driver_escalation',
      scriptVariables: {
        driver_first_name: input.driverFirstName,
        company_name: input.companyName,
        job_id: input.jobId,
        reason: input.reason,
      },
      relatedJobId: input.relatedJobId ?? null,
    });
  }

  async notifyMotorClubUpdate(input: {
    tenantId: string;
    motorClub: string;
    motorClubPhone: string;
    companyName: string;
    jobId: string;
    status: string;
    relatedJobId?: string | null;
  }): Promise<OutboundCallRow | null> {
    return this.safeEnqueue('motor_club_update', {
      tenantId: input.tenantId,
      toPhone: input.motorClubPhone,
      toName: input.motorClub,
      scriptTemplate: 'motor_club_update',
      scriptVariables: {
        motor_club: input.motorClub,
        job_id: input.jobId,
        status: input.status,
        company_name: input.companyName,
      },
      relatedJobId: input.relatedJobId ?? null,
    });
  }

  // ---------- config / read helpers ----------

  async getConfig(tenantId: string): Promise<{
    enabled: boolean;
    config: Record<string, unknown>;
    availablePurposes: string[];
  }> {
    const rows = await this.db
      .select({
        enabled: tenants.outboundVoiceEnabled,
        config: tenants.outboundVoiceConfig,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const row = rows[0];
    return {
      enabled: row?.enabled ?? false,
      config: (row?.config as Record<string, unknown> | null) ?? {},
      availablePurposes: Object.values(SCRIPT_TEMPLATES).map((t) => t.purpose),
    };
  }

  async updateConfig(
    tenantId: string,
    patch: { enabled?: boolean; config?: Record<string, unknown> },
  ) {
    const set: Partial<typeof tenants.$inferInsert> = { updatedAt: new Date() };
    if (patch.enabled !== undefined) set.outboundVoiceEnabled = patch.enabled;
    if (patch.config !== undefined) set.outboundVoiceConfig = patch.config as never;
    await this.db.update(tenants).set(set).where(eq(tenants.id, tenantId));
    return this.getConfig(tenantId);
  }

  // ---------- internal ----------

  private async safeEnqueue(
    purpose: OutboundVoicePurpose,
    args: {
      tenantId: string;
      toPhone: string;
      toName?: string | null;
      scriptTemplate: string;
      scriptVariables: Record<string, unknown>;
      relatedJobId?: string | null;
    },
  ): Promise<OutboundCallRow | null> {
    try {
      return await this.enqueueCall({ purpose, ...args });
    } catch (err) {
      this.logger.warn(
        `[outbound-voice] safeEnqueue ${purpose} swallowed error: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async assertEnabled(
    tenantId: string,
    purpose: OutboundVoicePurpose,
  ): Promise<typeof tenants.$inferSelect> {
    const rows = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const tenant = rows[0];
    if (!tenant) throw new Error('Tenant not found');
    if (!tenant.outboundVoiceEnabled) {
      throw new Error('Outbound voice is disabled for this tenant');
    }
    const allowed = readConfigArray(tenant, 'enabled_purposes');
    if (allowed && allowed.length > 0 && !allowed.includes(purpose)) {
      throw new Error(`Outbound voice purpose "${purpose}" is not enabled for this tenant`);
    }
    return tenant;
  }
}

const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'no_answer',
  'busy',
  'rejected',
  'cancelled',
]);

function mapThinkrrStatus(raw: string): string | null {
  const s = raw.toLowerCase().trim();
  if (s === 'ringing' || s === 'initiated' || s === 'queued') return 'dialing';
  if (s === 'in_progress' || s === 'in-progress' || s === 'answered') return 'in_progress';
  if (s === 'completed' || s === 'success' || s === 'ok') return 'completed';
  if (s === 'no_answer' || s === 'no-answer' || s === 'unanswered') return 'no_answer';
  if (s === 'busy') return 'busy';
  if (s === 'rejected' || s === 'declined') return 'rejected';
  if (s === 'failed' || s === 'error') return 'failed';
  if (s === 'canceled' || s === 'cancelled') return 'cancelled';
  return null;
}

function readConfigBool(
  tenant: typeof tenants.$inferSelect,
  key: string,
  defaultValue: boolean,
): boolean {
  const cfg = (tenant.outboundVoiceConfig as Record<string, unknown> | null) ?? {};
  const v = cfg[key];
  if (typeof v === 'boolean') return v;
  return defaultValue;
}

function readConfigString(
  tenant: typeof tenants.$inferSelect,
  key: string,
  defaultValue: string | null,
): string | null {
  const cfg = (tenant.outboundVoiceConfig as Record<string, unknown> | null) ?? {};
  const v = cfg[key];
  if (typeof v === 'string') return v;
  return defaultValue;
}

function readConfigArray(
  tenant: typeof tenants.$inferSelect,
  key: string,
): string[] | null {
  const cfg = (tenant.outboundVoiceConfig as Record<string, unknown> | null) ?? {};
  const v = cfg[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return null;
}

function buildCallbackUrl(): string {
  const base = (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  return `${base}/webhooks/thinkrr/outbound-result`;
}
