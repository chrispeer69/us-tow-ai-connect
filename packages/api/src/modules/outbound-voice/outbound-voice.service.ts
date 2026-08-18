import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, asc, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { resolveRetellTenantConfig } from '../../common/utils/retell-tenant-config';
import {
  alphaShops,
  outboundCallLogs,
  outboundCalls,
  platformSettings,
  tenantBilling,
  tenants,
  type OutboundCallRow,
} from '../../db/schema';
import type { UnifiedJobRow } from '../../db/schema';
import { TwilioSmsService } from '../outbound-sms/twilio-sms.service';
import { renderFlipWinSms } from '../flip-engine/flip-sms-templates';
import { CLOSE_MARKERS } from '../flip-engine/flip-scripts';
import {
  DEFAULT_INTAKE_COMPLETE_SECONDS,
  judgePitchCompletion,
  type PitchVerdict,
} from './pitch-completion';
import {
  extractRetellAnalysis,
  mapRetellStatus,
  type RetellAnalysisFields,
} from './retell-call-mapping';
import { PushService } from '../push/push.service';
import {
  MissingVariableError,
  type OutboundVoicePurpose,
  renderTemplate,
  SCRIPT_TEMPLATES,
} from './script-templates';
import { GeocoderService } from '../command-center/geocoder.service';
import { selectNearestShop, selectNearestShops } from '../flip-engine/nearest-shop.selector';
import { ThinkrrOutboundClient } from './thinkrr-outbound.client';
import { RetellOutboundClient } from './retell-outbound.client';
import {
  OUTBOUND_VOICE_PROVIDER,
} from './outbound-voice-provider.factory';
import type { OutboundVoiceProvider } from './outbound-voice-provider.interface';

/**
 * Session 49 — Outbound voice orchestrator.
 * Session 68 — Provider-agnostic: dispatches via injected OutboundVoiceProvider
 *              (Retell by default, Thinkrr fallback). Webhook handlers exist for
 *              both providers; legacy thinkrr_call_id rows continue to resolve
 *              through handleWebhookEvent for backward compatibility.
 *
 * Responsibilities:
 *   1. enqueueCall — validate template + variables, insert a `queued` row.
 *   2. dispatchQueued — cron, every 30 s by default. Picks queued + due
 *      rows, calls the active provider, transitions to `dialing` or `failed`.
 *   3. handleWebhookEvent — legacy Thinkrr-only path (kept for backward compat).
 *   4. handleProviderWebhookEvent — provider-agnostic webhook resolver.
 *   5. retryFailed — cron, picks failed rows under max_attempts and re-queues.
 *   6. listCalls / getCall / cancelCall / requeueCall — admin surface.
 *   7. Lifecycle hooks (notifyJobDispatched, …) — convenience wrappers
 *      other modules can opt into without coupling them to enqueueCall.
 *
 * Tenant-scoped at every layer. Controllers and webhooks supply
 * `tenantId`; this service never trusts request bodies for tenancy.
 */
@Injectable()
export class OutboundVoiceService {
  private readonly logger = new Logger(OutboundVoiceService.name);
  private readonly publicDemoAttempts = new Map<string, number>();
  private dispatching = false;

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly thinkrr: ThinkrrOutboundClient,
    private readonly retell: RetellOutboundClient,
    @Inject(OUTBOUND_VOICE_PROVIDER) private readonly provider: OutboundVoiceProvider,
    private readonly sms: TwilioSmsService,
    private readonly push: PushService,
    private readonly geocoder: GeocoderService,
  ) {
    this.logger.log(`[outbound-voice] active provider: ${this.provider.providerName}`);
  }

  // ---------- enqueue ----------

  async enqueueCall(input: {
    tenantId: string;
    purpose: OutboundVoicePurpose;
    toPhone: string;
    toName?: string | null;
    scriptTemplate: string;
    scriptVariables: Record<string, unknown>;
    relatedJobId?: string | null;
    dedupeRelatedJob?: boolean;
    scheduledFor?: Date | null;
    maxAttempts?: number;
  }): Promise<OutboundCallRow> {
    const tenant = await this.assertEnabled(input.tenantId, input.purpose);

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

    const requireConsent = readConfigBool(tenant, 'require_consent', true);
    if (requireConsent) {
      this.logger.debug(
        `[outbound-voice] tenant=${input.tenantId} require_consent=true; consent record check is a soft check today (logged on outcome)`,
      );
    }

    if (input.relatedJobId && input.purpose === 'custom' && input.dedupeRelatedJob !== false) {
      const existing = await this.db
        .select()
        .from(outboundCalls)
        .where(
          and(
            eq(outboundCalls.tenantId, input.tenantId),
            eq(outboundCalls.relatedJobId, input.relatedJobId),
            eq(outboundCalls.purpose, input.purpose),
            sql`${outboundCalls.status} <> 'cancelled'`,
          ),
        )
        .orderBy(desc(outboundCalls.createdAt))
        .limit(1);
      if (existing[0]) {
        this.logger.debug(
          `[outbound-voice] duplicate custom call suppressed tenant=${input.tenantId} relatedJobId=${input.relatedJobId} existing=${existing[0].id}`,
        );
        return existing[0];
      }
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
      return existing;
    }
    // Route cancel through the provider that placed this call, not the
    // currently-active one. Legacy thinkrr_call_id rows keep cancelling
    // through Thinkrr even after the cutover to Retell.
    const providerName = (existing as { provider?: string }).provider ?? 'thinkrr';
    const retellId = (existing as { retellCallId?: string | null }).retellCallId;
    if (providerName === 'retell' && retellId) {
      await this.retell.cancelCall(retellId);
    } else if (existing.thinkrrCallId) {
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
      return existing;
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
        createdAt: new Date(),
        thinkrrCallId: null,
        // retellCallId column is wiped here too via raw SQL below if present
        updatedAt: new Date(),
      } as never)
      .where(eq(outboundCalls.id, id))
      .returning();
    // Belt-and-suspenders: clear retell_call_id at SQL level so existing
    // Drizzle types don't need a regeneration before this PR lands.
    await this.db.execute(
      sql`update outbound_calls set retell_call_id = null where id = ${id}`,
    );
    return updated[0];
  }

  // ---------- dispatcher cron ----------

  @Cron('*/30 * * * * *')
  async dispatchQueuedCron(): Promise<void> {
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
          sql`${outboundCalls.createdAt} >= NOW() - INTERVAL '15 minutes'`
        ),
      )
      .orderBy(asc(outboundCalls.createdAt))
      .limit(maxBatch);

    const out: OutboundCallRow[] = [];
    for (const { call, tenant } of queued) {
      if (await this.freeTrialLimitReached(tenant)) {
        await this.db
          .update(outboundCalls)
          .set({
            status: 'failed',
            error: 'Outbound trial call limit reached. Please contact support to enable more calls.',
            updatedAt: new Date(),
          })
          .where(eq(outboundCalls.id, call.id));
        continue;
      }
      const updated = await this.dispatchOne(call, tenant);
      if (updated) out.push(updated);
      await new Promise((resolve) => setTimeout(resolve, 2000));
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
      await this.notifyManagersOfAttentionNeeded(call, {
        status: 'failed',
        error: `template_render_failed: ${(err as Error).message}`,
      }).catch((notifyErr) => {
        this.logger.warn(
          `[outbound-voice] attention-needed SMS failed call=${call.id}: ${(notifyErr as Error).message}`,
        );
      });
      return updated[0];
    }

    const callbackUrl = buildCallbackUrl(this.provider.providerName);
    // Retell agent / version / caller-ID are per-tenant, env-defaulted. The
    // resolver keeps agent and version paired — see retell-tenant-config.ts.
    const retell =
      this.provider.providerName === 'retell'
        ? resolveRetellTenantConfig(
            tenant.outboundVoiceConfig as Record<string, unknown> | null,
          )
        : null;
    const agentId = retell
      ? (readConfigString(tenant, 'retell_outbound_agent_id', null) ?? undefined)
      : (readConfigString(tenant, 'thinkrr_outbound_agent_id', null) ?? undefined);
    const tenantTestModeEnabled = readConfigBool(tenant, 'test_mode_enabled', false);
    const tenantTestOverrideNumber = readConfigString(tenant, 'test_override_number', null);
    if (tenantTestModeEnabled && !tenantTestOverrideNumber?.trim()) {
      const updated = await this.db
        .update(outboundCalls)
        .set({
          status: 'failed',
          attempts: call.attempts + 1,
          error: 'tenant_test_mode_enabled_without_test_override_number',
          updatedAt: new Date(),
          endedAt: new Date(),
        })
        .where(eq(outboundCalls.id, call.id))
        .returning();
      return updated[0];
    }

    const result = await this.provider.placeCall({
      toPhone: call.toPhone,
      toName: call.toName,
      scriptBody: rendered.body,
      scriptTemplate: call.scriptTemplate,
      scriptVariables: rendered.resolvedVariables,
      callId: call.id,
      tenantId: call.tenantId,
      agentId,
      agentVersion: retell?.agentVersion ?? undefined,
      fromNumber: retell?.fromNumber ?? undefined,
      callbackUrl,
      testModeEnabled: tenantTestModeEnabled,
      testOverrideNumber: tenantTestOverrideNumber,
    });

    const requireConsent = readConfigBool(tenant, 'require_consent', true);
    const consentSkipped = requireConsent === true;

    if (!result) {
      const nextAttempts = call.attempts + 1;
      const finalStatus = nextAttempts >= call.maxAttempts ? 'failed' : 'queued';
      const updated = await this.db
        .update(outboundCalls)
        .set({
          status: finalStatus,
          attempts: nextAttempts,
          error: `${this.provider.providerName}_unavailable_or_unconfigured`,
          updatedAt: new Date(),
          ...(finalStatus === 'failed' ? { endedAt: new Date() } : {}),
        })
        .where(eq(outboundCalls.id, call.id))
        .returning();
      if (finalStatus === 'failed') {
        await this.notifyManagersOfAttentionNeeded(call, {
          status: 'failed',
          error: `${this.provider.providerName}_unavailable_or_unconfigured`,
        }).catch((notifyErr) => {
          this.logger.warn(
            `[outbound-voice] attention-needed SMS failed call=${call.id}: ${(notifyErr as Error).message}`,
          );
        });
      }
      return updated[0];
    }

    // Persist the provider-call-id on the matching column. Update via raw
    // SQL so the new retell_call_id column doesn't require a Drizzle schema
    // regen before this PR lands.
    const providerIdColumn = this.provider.providerName === 'retell'
      ? 'retell_call_id'
      : 'thinkrr_call_id';
    await this.db.execute(
      sql`update outbound_calls
          set status = 'dialing',
              ${sql.raw(providerIdColumn)} = ${result.providerCallId},
              provider = ${this.provider.providerName},
              attempts = ${call.attempts + 1},
              started_at = now(),
              outcome = ${JSON.stringify({
                consent_check_skipped: consentSkipped,
                tenant_test_mode: tenantTestModeEnabled,
                tenant_test_override_number: tenantTestModeEnabled ? tenantTestOverrideNumber : null,
              })}::jsonb,
              updated_at = now()
          where id = ${call.id}`,
    );
    const rows = await this.db
      .select()
      .from(outboundCalls)
      .where(eq(outboundCalls.id, call.id))
      .limit(1);
    return rows[0];
  }

  // ---------- retry cron ----------

  @Cron('0 */5 * * * *')
  async retryFailedCron(): Promise<void> {
    await this.retryFailed();
  }

  async retryFailed(): Promise<number> {
    const candidates = await this.db
      .select()
      .from(outboundCalls)
      .where(
        and(
          eq(outboundCalls.status, 'failed'),
          sql`${outboundCalls.attempts} < ${outboundCalls.maxAttempts}`,
          sql`(${outboundCalls.error} ILIKE 'thinkrr_unavailable%' OR ${outboundCalls.error} ILIKE 'retell_unavailable%')`,
        ),
      )
      .limit(50);
    if (candidates.length === 0) return 0;
    await this.db
      .update(outboundCalls)
      .set({
        status: 'queued',
        error: null,
        // dispatchQueued only picks up rows created in the last 15 minutes. This
        // cron runs every 5 minutes over rows that failed at an unknown earlier
        // time, so without resetting createdAt a re-queued row is dropped back
        // into a window it has already fallen out of and is never dialled — the
        // status just flips to 'queued' and stays there. The webhook retry path
        // has always reset it; this one did not.
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .where(inArray(outboundCalls.id, candidates.map((c) => c.id)));
    return candidates.length;
  }

  /**
   * Pull the truth for calls whose terminal webhook never arrived.
   *
   * On 2026-08-17, 12 of 32 calls were still `in_progress` hours later: no
   * duration, no transcript, no analysis, `updated_at` unchanged since the
   * `call_started` event. Retell's `call_ended` / `call_analyzed` webhooks simply
   * did not land for 37% of the day's calls, which means those calls were absent
   * from the win count, absent from the daily review, and — once redials exist —
   * unjudgeable. Every one of those rows already had a `retell_call_id`.
   *
   * So we ask. The snapshot is fed back through handleProviderWebhookEvent, the
   * exact path a webhook takes, so reconciliation and push produce identical
   * state and the abandoned-pitch judgement downstream sees real data instead of
   * nulls. Runs before the redial sweep for that reason.
   */
  @Cron('0 */3 * * * *')
  async reconcileStalledCallsCron(): Promise<void> {
    await this.reconcileStalledCalls().catch((err) => {
      this.logger.warn(`[outbound-voice] stalled-call reconcile failed: ${(err as Error).message}`);
    });
  }

  async reconcileStalledCalls(): Promise<number> {
    // Raw SQL because `retell_call_id` and `provider` are not in the Drizzle
    // schema — the same reason dispatchOne writes them with sql.raw. Keep this
    // aligned with that if the schema is ever regenerated.
    const stalled = await this.db.execute<{ id: string; retell_call_id: string }>(
      sql`select id, retell_call_id
            from outbound_calls
           where status in ('dialing', 'in_progress')
             and retell_call_id is not null
             -- Long enough that a live call has genuinely ended. The longest
             -- flip call observed is 201s; five minutes is past all of them.
             and updated_at < now() - (${RECONCILE_MIN_AGE_SECONDS} * interval '1 second')
             and created_at > now() - interval '3 days'
           order by created_at asc
           limit ${RECONCILE_BATCH_SIZE}`,
    );
    const stalledRows = (Array.isArray(stalled) ? stalled : (stalled as { rows?: unknown[] }).rows ?? []) as Array<{
      id: string;
      retell_call_id: string;
    }>;

    let reconciled = 0;
    for (const call of stalledRows) {
      const snapshot = await this.retell.getCall(call.retell_call_id);
      if (!snapshot) continue;

      // Still genuinely ongoing — leave it alone rather than forcing a terminal
      // state onto a live conversation.
      if (snapshot.call_status === 'ongoing' || snapshot.call_status === 'registered') {
        this.logger.debug(
          `[outbound-voice] reconcile: call=${call.id} still ${snapshot.call_status} at Retell`,
        );
        continue;
      }

      const result = await this.handleProviderWebhookEvent({
        provider: 'retell',
        callId: snapshot.call_id,
        status: mapRetellStatus({
          call_status: snapshot.call_status,
          disconnection_reason: snapshot.disconnection_reason,
        }),
        durationSeconds:
          snapshot.duration_ms != null ? Math.round(snapshot.duration_ms / 1000) : null,
        transcript: snapshot.transcript ?? null,
        recordingUrl: snapshot.recording_url ?? null,
        analysisData: extractRetellAnalysis(snapshot.call_analysis),
        error: snapshot.disconnection_reason ?? null,
        timestampIso: snapshot.end_timestamp
          ? new Date(snapshot.end_timestamp).toISOString()
          : snapshot.start_timestamp
            ? new Date(snapshot.start_timestamp).toISOString()
            : null,
      });
      if (result.matched) reconciled += 1;
    }

    if (reconciled > 0) {
      this.logger.log(
        `[outbound-voice] reconciled ${reconciled} stalled call(s) from the Retell API ` +
          `(their terminal webhook never arrived)`,
      );
    }
    return reconciled;
  }

  /**
   * Safety net for abandoned pitches the webhook path could not judge.
   *
   * Two real gaps it covers, both observed on 2026-08-17:
   *  1. `call_analyzed` never arrives, so the offer results never populate and
   *     the webhook check declines to judge on empty analysis.
   *  2. No webhook arrives at all after `dialing` — one call that morning
   *     (Capital Ford, 06:01) still had null duration and null transcript
   *     ninety minutes later.
   *
   * Judged on whatever we do have (transcript, duration, our own eligibility
   * gate) once the call is old enough that analysis is clearly not coming.
   */
  @Cron('30 */2 * * * *')
  async retryAbandonedPitchesCron(): Promise<void> {
    if (!ABANDONED_PITCH_RETRY_ENABLED) return;
    await this.retryAbandonedPitches().catch((err) => {
      this.logger.warn(`[outbound-voice] abandoned-pitch sweep failed: ${(err as Error).message}`);
    });
  }

  async retryAbandonedPitches(): Promise<number> {
    const candidates = await this.db
      .select()
      .from(outboundCalls)
      .where(
        and(
          sql`${outboundCalls.attempts} < GREATEST(${outboundCalls.maxAttempts}, ${ABANDONED_PITCH_MIN_ATTEMPTS})`,
          // Recent enough that a callback still makes sense to the customer.
          sql`${outboundCalls.createdAt} > NOW() - INTERVAL '6 hours'`,
          // A row must be genuinely settled before we touch it. 'dialing' and
          // 'in_progress' are included only past a threshold no real call can
          // survive — without that split, a call redialled two minutes ago and
          // currently RINGING looks exactly like a stale one, and the sweep
          // dials the customer a second time while the first call is still live.
          or(
            and(
              eq(outboundCalls.status, 'completed'),
              sql`${outboundCalls.updatedAt} < NOW() - (${ABANDONED_PITCH_SWEEP_MIN_AGE_SECONDS} * INTERVAL '1 second')`,
            ),
            and(
              inArray(outboundCalls.status, ['dialing', 'in_progress']),
              sql`${outboundCalls.updatedAt} < NOW() - (${ABANDONED_PITCH_STUCK_INFLIGHT_MINUTES} * INTERVAL '1 minute')`,
            ),
          ),
        ),
      )
      .orderBy(asc(outboundCalls.createdAt))
      .limit(25);

    let requeued = 0;
    for (const call of candidates) {
      const analysis = (call.analysisData as Record<string, unknown> | null) ?? {};
      const did = await this.maybeRetryAbandonedPitch(call, {
        status: call.status,
        durationSeconds: call.durationSeconds,
        transcript: call.transcript,
        disconnectionReason: call.error,
        analysis,
      }).catch((err) => {
        this.logger.warn(
          `[outbound-voice] sweep retry check failed call=${call.id}: ${(err as Error).message}`,
        );
        return false;
      });
      if (did) requeued += 1;
    }
    if (requeued > 0) {
      this.logger.log(`[outbound-voice] abandoned-pitch sweep requeued ${requeued} call(s)`);
    }
    return requeued;
  }

  // ---------- webhook handlers ----------

  /**
   * Legacy Thinkrr-only path. Kept for backward compatibility with the
   * existing /webhooks/thinkrr/outbound-result endpoint. Delegates to
   * handleProviderWebhookEvent with provider='thinkrr'.
   */
  async handleWebhookEvent(event: {
    callId: string;
    status: string;
    durationSeconds?: number | null;
    transcript?: string | null;
    recordingUrl?: string | null;
    analysisData?: {
      call_summary?: string | null;
      call_successful?: boolean | null;
      user_sentiment?: string | null;
      flip_eligible?: boolean | null;
      flip_outcome?: string | null;
      offer_1_result?: string | null;
      offer_2_result?: string | null;
      offer_3_result?: string | null;
      convini_link_sent?: boolean | null;
      convini_sell_type?: string | null;
      corrections_made?: string | null;
      nearest_our_shop?: string | null;
      destination_type?: string | null;
    };
    outcome?: Record<string, unknown> | null;
    error?: string | null;
    timestampIso?: string | null;
  }): Promise<{ matched: boolean; previousStatus: string | null; newStatus: string | null }> {
    return this.handleProviderWebhookEvent({ 
      provider: 'thinkrr', 
      ...event,
      analysisData: event.analysisData ?? {}
    });
  }

  /**
   * Session 68 — provider-agnostic webhook event handler. Idempotent on
   * the provider-specific call id column. Webhook controllers verify
   * signatures before calling this. Accepts analysisData for call outcome.
   */
  async handleProviderWebhookEvent(event: {
    provider: 'retell' | 'thinkrr';
    callId: string;
    status: string;
    durationSeconds?: number | null;
    transcript?: string | null;
    recordingUrl?: string | null;
    analysisData: {
      call_summary?: string | null;
      call_successful?: boolean | null;
      user_sentiment?: string | null;
      flip_eligible?: boolean | null;
      flip_outcome?: string | null;
      offer_1_result?: string | null;
      offer_2_result?: string | null;
      offer_3_result?: string | null;
      convini_link_sent?: boolean | null;
      convini_sell_type?: string | null;
      corrections_made?: string | null;
      nearest_our_shop?: string | null;
      destination_type?: string | null;
    };
    outcome?: Record<string, unknown> | null;
    error?: string | null;
    timestampIso?: string | null;
  }): Promise<{ matched: boolean; previousStatus: string | null; newStatus: string | null }> {
    const lookupColumn = event.provider === 'retell' ? sql`retell_call_id` : sql`thinkrr_call_id`;
    const rows = await this.db
      .select()
      .from(outboundCalls)
      .where(sql`${lookupColumn} = ${event.callId}`)
      .limit(1);
    const existing = rows[0];
    if (!existing) {
      this.logger.warn(
        `[outbound-voice] webhook for unknown ${event.provider}_call_id=${event.callId}`,
      );
      return { matched: false, previousStatus: null, newStatus: null };
    }

    const newStatus = mapProviderStatus(event.status);
    if (!newStatus) {
      return { matched: true, previousStatus: existing.status, newStatus: null };
    }
    if (TERMINAL_STATUSES.has(existing.status) && existing.status === newStatus) {
      // Even if status hasn't changed (e.g. call_analyzed after call_ended),
      // we must still process any new analysis data (flip_outcome, offers, etc.)
      const analysisData = event.analysisData ?? {};
      if (Object.keys(analysisData).some((k) => (analysisData as Record<string, unknown>)[k] != null)) {
        if (event.analysisData != null) {
          await this.db.update(outboundCalls).set({ analysisData: event.analysisData }).where(eq(outboundCalls.id, existing.id));
        }
        await this.syncFlipActivityFromAnalysis(existing, {}, analysisData).catch((err) => {
          this.logger.warn(
            `[outbound-voice] flip activity sync failed for call ${existing.id}: ${(err as Error).message}`,
          );
        });
        // Retell delivers `call_analyzed` after `call_ended`, and the offer
        // results only exist on the second one. This is therefore the FIRST
        // point at which "did the pitch finish?" can be answered honestly, and
        // the branch we normally reach for a completed call. Judging on
        // call_ended alone would see empty analysis on every call and redial the
        // ones that had already won.
        const requeued = await this.maybeRetryAbandonedPitch(existing, {
          status: existing.status,
          durationSeconds: event.durationSeconds ?? existing.durationSeconds,
          transcript: event.transcript ?? existing.transcript,
          disconnectionReason: event.error ?? existing.error,
          analysis: analysisData,
        }).catch((err) => {
          this.logger.warn(
            `[outbound-voice] abandoned-pitch retry check failed for call ${existing.id}: ${(err as Error).message}`,
          );
          return false;
        });
        if (requeued) {
          return { matched: true, previousStatus: existing.status, newStatus: 'queued' };
        }
      }
      return { matched: true, previousStatus: existing.status, newStatus: existing.status };
    }

    const isRetryableFailure = ['failed', 'no_answer', 'busy', 'rejected'].includes(newStatus);
    const canRetry = existing.attempts < existing.maxAttempts;

    if (isRetryableFailure && canRetry) {
      this.logger.log(
        `[outbound-voice] Auto-retrying call ${existing.id} (attempt ${existing.attempts}/${existing.maxAttempts}) after ${newStatus}`,
      );
      await this.db
        .update(outboundCalls)
        .set({
          status: 'queued',
          error: event.error ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(outboundCalls.id, existing.id));
      return { matched: true, previousStatus: existing.status, newStatus: 'queued' };
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

    const analysisData = event.analysisData ?? {};
    if (event.analysisData != null) patch.analysisData = event.analysisData;

    const shouldNotifyAttention =
      ['no_answer', 'failed'].includes(newStatus) && existing.status !== newStatus;

    await this.db.update(outboundCalls).set(patch).where(eq(outboundCalls.id, existing.id));
    if (shouldNotifyAttention) {
      await this.notifyManagersOfAttentionNeeded(existing, {
        status: newStatus,
        error: event.error ?? patch.error ?? existing.error,
      }).catch((err) => {
        this.logger.warn(
          `[outbound-voice] attention-needed SMS failed call=${existing.id}: ${(err as Error).message}`,
        );
      });
    }
    if (TERMINAL_STATUSES.has(newStatus) && Object.keys(analysisData).length > 0) {
      await this.syncFlipActivityFromAnalysis(existing, patch, analysisData).catch((err) => {
        this.logger.warn(
          `[outbound-voice] flip activity sync failed for call ${existing.id}: ${(err as Error).message}`,
        );
      });
    }

    // The attempt is now fully recorded — transcript, duration and analysis all
    // persisted — so a requeue from here loses nothing. Ordering matters: the
    // connection-failure retry above returns early precisely because a dial that
    // never connected has nothing worth keeping, whereas an abandoned pitch has
    // a transcript we want in the daily review either way.
    if (TERMINAL_STATUSES.has(newStatus)) {
      const requeued = await this.maybeRetryAbandonedPitch(
        { ...existing, ...patch } as OutboundCallRow,
        {
          status: newStatus,
          durationSeconds: patch.durationSeconds ?? existing.durationSeconds,
          transcript: patch.transcript ?? existing.transcript,
          disconnectionReason: event.error ?? existing.error,
          analysis: analysisData,
        },
      ).catch((err) => {
        this.logger.warn(
          `[outbound-voice] abandoned-pitch retry check failed for call ${existing.id}: ${(err as Error).message}`,
        );
        return false;
      });
      if (requeued) {
        return { matched: true, previousStatus: existing.status, newStatus: 'queued' };
      }
    }
    return { matched: true, previousStatus: existing.status, newStatus };
  }

  // ---------- abandoned-pitch retry (Session 76) ----------

  /**
   * Chris, 2026-08-17: "If a call dies with a sales logic pitch I want the agent
   * to immediately call the customer back again — we must complete the call — no
   * less than 3 attempts."
   *
   * Requeues a call whose conversation stopped before the flip reached a
   * decision. Returns true when it requeued, so the caller can report `queued`
   * rather than the terminal status.
   *
   * Every gate here is a reason NOT to redial, and each one is load-bearing:
   * an opt-out, a job that never had a pitch, a pitch the customer answered,
   * or an agent that reached its close. See pitch-completion.ts for why the
   * "agent judged it inappropriate after a full intake" case must survive —
   * two of the three long calls on 2026-08-17 were correct suppressions of a
   * wrong club ticket, and redialling them would pitch a repair shop to
   * someone whose car is going home on a flatbed.
   */
  private async maybeRetryAbandonedPitch(
    call: OutboundCallRow,
    observed: {
      status: string;
      durationSeconds?: number | null;
      transcript?: string | null;
      disconnectionReason?: string | null;
      analysis: Record<string, unknown>;
    },
  ): Promise<boolean> {
    if (!ABANDONED_PITCH_RETRY_ENABLED) return false;

    const maxAttempts = Math.max(call.maxAttempts ?? 0, ABANDONED_PITCH_MIN_ATTEMPTS);
    if (call.attempts >= maxAttempts) {
      this.logger.log(
        `[outbound-voice] abandoned pitch call=${call.id} at attempt ceiling ${call.attempts}/${maxAttempts} — not redialling`,
      );
      return false;
    }

    // Only flip calls are in scope, and `purpose`/`scriptTemplate` cannot tell
    // us — the flip orchestrator enqueues everything as 'custom', same as an ETA
    // courtesy call. A time-bounded flip log row is the only real discriminator
    // we have: no row in the window means this was not a flip call, so there is
    // no pitch to have abandoned.
    //
    // The window matters as much as the match. The lookup is by phone with no
    // time bound elsewhere in this file, which would happily return YESTERDAY's
    // flip log for a customer we are calling today about their driver's ETA —
    // and then redial them for a pitch that was never in this call's script.
    const log = await this.findLatestCallLog(call, ABANDONED_PITCH_LOG_MATCH_WINDOW_HOURS);
    if (!log) {
      this.logger.debug(
        `[outbound-voice] call=${call.id} has no flip log row in the last ` +
          `${ABANDONED_PITCH_LOG_MATCH_WINDOW_HOURS}h — not a flip call, no redial`,
      );
      return false;
    }

    // Our pre-call gate's eligibility, not the agent's post-call opinion of it.
    // syncFlipActivityFromAnalysis deliberately keeps those separate; so do we.
    const jobFlipEligible = log.flipEligible ?? false;

    const verdict: PitchVerdict = judgePitchCompletion(
      {
        status: observed.status,
        disconnectionReason: observed.disconnectionReason,
        durationSeconds: observed.durationSeconds,
        transcript: observed.transcript,
        analysis: observed.analysis as Parameters<typeof judgePitchCompletion>[0]['analysis'],
        jobFlipEligible,
      },
      {
        intakeCompleteSeconds: ABANDONED_PITCH_INTAKE_SECONDS,
        closeMarkers: CLOSE_MARKERS,
      },
    );

    if (verdict.outcome !== 'ABANDONED') {
      this.logger.log(
        `[outbound-voice] call=${call.id} pitch ${verdict.outcome} (${verdict.reason}) — no redial`,
      );
      return false;
    }

    const scheduledFor = new Date(Date.now() + ABANDONED_PITCH_RETRY_DELAY_SECONDS * 1000);
    await this.db
      .update(outboundCalls)
      .set({
        status: 'queued',
        error: `abandoned_pitch_retry: ${verdict.reason}`,
        // dispatchQueued only considers rows created in the last 15 minutes, so
        // a requeue that does not reset createdAt is silently never dialled.
        // This is the same reason the connection-failure path resets it.
        createdAt: new Date(),
        scheduledFor,
        endedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(outboundCalls.id, call.id));

    this.logger.warn(
      `[outbound-voice] REDIALLING abandoned pitch call=${call.id} attempt=${call.attempts}/${maxAttempts} ` +
        `reason=${verdict.reason} in ${ABANDONED_PITCH_RETRY_DELAY_SECONDS}s`,
    );
    return true;
  }

  /**
   * The flip log row for a call. Matched on tenant + phone + recency because
   * outbound_call_logs carries no foreign key to outbound_calls — the same join
   * syncFlipActivityFromAnalysis uses, extracted so both agree on which row
   * "this call" means.
   */
  private async findLatestCallLog(
    call: OutboundCallRow,
    withinHours?: number,
  ): Promise<typeof outboundCallLogs.$inferSelect | undefined> {
    const filters: SQL[] = [
      eq(outboundCallLogs.tenantId, call.tenantId),
      eq(outboundCallLogs.customerPhone, call.toPhone),
    ];
    if (withinHours != null) {
      // Anchored on the call row's own clock rather than now(), so a redial
      // whose createdAt was reset still resolves to the flip log that started
      // the sequence.
      const anchor = call.startedAt ?? call.createdAt ?? new Date();
      filters.push(
        sql`${outboundCallLogs.callTime} >= ${new Date(anchor.getTime() - withinHours * 3600_000)}`,
      );
      filters.push(
        sql`${outboundCallLogs.callTime} <= ${new Date(anchor.getTime() + withinHours * 3600_000)}`,
      );
    }
    const rows = await this.db
      .select()
      .from(outboundCallLogs)
      .where(and(...filters))
      .orderBy(desc(outboundCallLogs.callTime))
      .limit(1);
    return rows[0];
  }

  private async notifyManagersOfAttentionNeeded(
    call: typeof outboundCalls.$inferSelect,
    details: { status: string; error?: string | null },
  ): Promise<void> {
    await this.notifyManagersOfJobAttention({
      tenantId: call.tenantId,
      jobId: call.relatedJobId,
      customerName: call.toName,
      customerPhone: call.toPhone,
      reason: details.status === 'no_answer' ? 'no answer / voicemail' : 'call failed',
      error: details.error,
    });
  }

  async notifyManagersOfJobAttention(input: {
    tenantId: string;
    jobId?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    reason: string;
    error?: string | null;
  }): Promise<void> {
    const tenantRows = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, input.tenantId))
      .limit(1);
    const tenant = tenantRows[0];
    if (!tenant) return;
    if (!readConfigBool(tenant, 'manager_alerts_for_unanswered_calls', true)) return;

    const recipients = readManagerPhones(tenant);
    if (recipients.length === 0) return;

    const body = [
      `AI CALL NEEDS ATTENTION - ${tenant.companyName}`,
      `Customer: ${input.customerName || 'unknown'} ${input.customerPhone || 'no phone on job'}`,
      `Result: ${input.reason}`,
      input.jobId ? `Job: ${input.jobId}` : null,
      input.error ? `Error: ${String(input.error).slice(0, 120)}` : null,
      'Please review the job and call the customer manually.',
    ].filter(Boolean).join('\n');

    for (const phone of recipients) {
      await this.sms
        .sendSms({
          to: phone,
          body,
          tenantId: input.tenantId,
          ghlData: {
            customer_name: input.customerName,
            customer_phone: input.customerPhone,
            reason: input.reason,
            job_id: input.jobId,
            error: input.error,
          },
        })
        .catch((err) =>
          this.logger.warn(
            `[outbound-voice] attention-needed SMS failed phone=${phone} job=${input.jobId ?? 'unknown'}: ${(err as Error).message}`,
          ),
        );
    }
  }

  private async syncFlipActivityFromAnalysis(
    call: typeof outboundCalls.$inferSelect,
    callPatch: Partial<typeof outboundCalls.$inferInsert>,
    // Partial<RetellAnalysisFields> rather than a hand-listed copy: this inline
    // type had already drifted once (it was missing new_destination, which is
    // why an accepted flip stored a null destination), and a second definition
    // of the same shape will always drift again.
    analysis: Partial<RetellAnalysisFields>,
  ): Promise<void> {
    const rows = await this.db
      .select()
      .from(outboundCallLogs)
      .where(
        and(
          eq(outboundCallLogs.tenantId, call.tenantId),
          eq(outboundCallLogs.customerPhone, call.toPhone),
        ),
      )
      .orderBy(desc(outboundCallLogs.callTime))
      .limit(1);
    const log = rows[0];
    if (!log) return;

    const offer1 = normalizeOutcomeValue(analysis.offer_1_result);
    const offer2 = normalizeOutcomeValue(analysis.offer_2_result);
    const offer3 = normalizeOutcomeValue(analysis.offer_3_result);
    const flipOutcome = normalizeOutcomeValue(analysis.flip_outcome);
    const acceptedOffer = pickAcceptedOfferFromAnalysis(offer1, offer2, offer3, flipOutcome);
    const accepted = acceptedOffer != null || outcomeMeansAccepted(flipOutcome);
    const shouldNotifyManagers = accepted && !log.managementNotified;

    const update: Partial<typeof outboundCallLogs.$inferInsert> = {
      callDurationSeconds: callPatch.durationSeconds ?? call.durationSeconds ?? null,
      callRecordingUrl: callPatch.recordingUrl ?? call.recordingUrl ?? null,
      transcript: callPatch.transcript ?? call.transcript ?? null,
    };
    // Session 74 — do NOT let the post-call extractor overwrite flip_eligible.
    //
    // It used to. The pre-call engine decides eligibility, writes the reason to
    // no_flip_reason, and renders a script that either contains an offer or does
    // not. Retell's post_call_analysis then re-answers "was a flip genuinely
    // appropriate?" from the transcript, and that answer was being written over
    // the top — erasing the gate's decision and its reason.
    //
    // The damage was analytical, not operational, and it was severe: on
    // 2026-08-13 the gate put an offer into 40 calls while the column read 17,
    // so the funnel looked like an eligibility collapse when the real story was
    // that the agent skipped half the offers it was given. Every "eligible" and
    // "never pitched" figure in the daily review was reading the agent's opinion
    // of its own call.
    //
    // The extractor's judgement is still worth keeping — a disagreement is a
    // signal that the gate mis-scoped the call — so it is recorded alongside
    // rather than on top.
    if (analysis.flip_eligible === false && log.flipEligible === true) {
      update.noFlipReason = trimForColumn('agent_judged_flip_not_appropriate', 120);
    }
    if (offer1) update.offer1Result = offer1;
    if (offer2) update.offer2Result = offer2;
    if (offer3) update.offer3Result = offer3;
    if (flipOutcome) update.flipOutcome = accepted ? 'ACCEPTED' : flipOutcome;
    if (typeof analysis.convini_link_sent === 'boolean') {
      update.conviniLinkSent = analysis.convini_link_sent;
    }
    if (analysis.convini_sell_type) {
      update.conviniSellType = trimForColumn(analysis.convini_sell_type, 10);
    }
    if (analysis.corrections_made) update.correctionsMade = analysis.corrections_made;

    // Session 77 — persist the dispatch intake answers.
    //
    // The script has asked all four of these on every call since 2026-08-15 and
    // nothing has ever stored them, so the AI Notes block rendered empty. These
    // are the columns the composer reads.
    //
    // Written with `assignIfPresent` rather than a plain truthiness check for a
    // specific reason: an intake answer can legitimately be the string "unknown"
    // (the agent is told to record an honest unknown rather than guess) and it
    // must not be silently dropped, while a null from a call where the question
    // was never reached must NOT overwrite an answer an earlier webhook already
    // stored. Late `call_analyzed` events and the reconciliation sweep both
    // re-enter this path for the same call.
    assignIfPresent(update, 'keysAndPresence', analysis.keys_and_presence);
    assignIfPresent(update, 'accessNotes', analysis.access_notes);
    assignIfPresent(update, 'vehicleCondition', analysis.vehicle_condition);
    assignIfPresent(update, 'vehicleDetails', analysis.vehicle_details);
    assignIfPresent(update, 'issueDescription', analysis.issue_description);
    assignIfPresent(update, 'confirmedDestination', analysis.confirmed_destination);
    // new_destination has a column already but was never populated from the
    // analysis, which is why both 2026-08-17 wins showed a null destination on a
    // call where the customer plainly named the shop.
    assignIfPresent(update, 'newDestination', analysis.new_destination);

    if (accepted) update.managementNotified = true;

    await this.db.update(outboundCallLogs).set(update).where(eq(outboundCallLogs.id, log.id));

    // Send CONVINI SMS to customer if the AI promised it
    if (update.conviniLinkSent && log.customerPhone) {
      const tenantRows = await this.db.select().from(tenants).where(eq(tenants.id, log.tenantId)).limit(1);
      const tenant = tenantRows[0];
      if (tenant) {
        const cfg = (tenant.flipEngineConfig as Record<string, unknown> | null) ?? {};
        if (cfg.sms_convini !== false) {
          const conviniLink = (cfg.convini_link as string) || 'https://convini.live';
          const body = `Hi from ${tenant.companyName}! Here is the free CONVINI app we mentioned to track your tow and get help faster next time: ${conviniLink}`;
          
          await this.sms.sendSms({
            to: log.customerPhone,
            body,
            tenantId: log.tenantId,
            ghlData: {
              customer_name: log.customerName,
              convini_link: conviniLink,
            }
          }).catch((err) =>
            this.logger.warn(`[outbound-voice] Convini SMS to customer failed phone=${log.customerPhone}: ${(err as Error).message}`),
          );
        }
      }
    }

    if (shouldNotifyManagers) {
      // Buzz every registered device before the SMS fan-out. Deliberately fired
      // and not awaited into the same failure path: sendFlipWin swallows its own
      // errors, because a dead push endpoint must never stop a win being
      // recorded or the managers being texted.
      // Optional-chained on purpose. sendFlipWin already swallows its own
      // errors, but if the dependency itself is ever missing, a throw here
      // would land BEFORE the manager SMS and cost us the notification that
      // actually matters. Push is the garnish; the SMS is the meal.
      void this.push?.sendFlipWin?.(log.tenantId, {
        id: log.id,
        customerName: log.customerName,
        shop: update.nearestOurShop ?? log.nearestOurShop ?? null,
        vehicle: log.vehicle,
      });

      await this.notifyManagersOfFlipWin(log, {
        ...update,
        offer1Result: update.offer1Result ?? log.offer1Result,
        offer2Result: update.offer2Result ?? log.offer2Result,
        offer3Result: update.offer3Result ?? log.offer3Result,
        conviniLinkSent: update.conviniLinkSent ?? log.conviniLinkSent,
        callDurationSeconds: update.callDurationSeconds ?? log.callDurationSeconds,
        callRecordingUrl: update.callRecordingUrl ?? log.callRecordingUrl,
      });
    }
  }

  private async notifyManagersOfFlipWin(
    log: typeof outboundCallLogs.$inferSelect,
    merged: Partial<typeof outboundCallLogs.$inferInsert>,
  ): Promise<void> {
    const tenantRows = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, log.tenantId))
      .limit(1);
    const tenant = tenantRows[0];
    if (!tenant) return;
    const recipients = readManagerPhones(tenant);
    if (recipients.length === 0) return;

    const body = renderFlipWinSms({
      companyName: tenant.companyName,
      customer: { name: log.customerName, phone: log.customerPhone },
      vehicle: log.vehicle ?? 'unknown',
      issue: log.issueType ?? 'unknown',
      pickup: 'unknown',
      originalDestination: log.originalDestination ?? 'unknown',
      redirectedTo: merged.nearestOurShop ?? log.nearestOurShop ?? 'accepted shop',
      distanceSavedMiles: null,
      acceptedOffer: pickAcceptedOfferForSms(merged),
      conviniLinkSent: Boolean(merged.conviniLinkSent),
      rentalMentioned: false,
      driverName: null,
      jobNumber: log.id.slice(0, 8),
      callTimeLocal: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: tenant.timezone,
        timeZoneName: 'short',
      }),
      callDuration: formatDuration(merged.callDurationSeconds ?? null),
      transcriptUrl: merged.callRecordingUrl ?? null,
    });

    for (const phone of recipients) {
      await this.sms
        .sendSms({
          to: phone,
          body,
          tenantId: log.tenantId,
          ghlData: {
            customer_name: log.customerName,
            customer_phone: log.customerPhone,
            vehicle: log.vehicle,
            issue: log.issueType,
            original_destination: log.originalDestination,
            nearest_our_shop: merged.nearestOurShop ?? log.nearestOurShop,
            accepted_offer: pickAcceptedOfferForSms(merged),
            call_duration_seconds: merged.callDurationSeconds ?? log.callDurationSeconds,
            transcript_url: merged.callRecordingUrl ?? log.callRecordingUrl,
            job_number: log.id.slice(0, 8),
          },
        })
        .catch((err) =>
          this.logger.warn(
            `[outbound-voice] flip win SMS failed phone=${phone} log=${log.id}: ${(err as Error).message}`,
          ),
        );
    }
  }

  // ---------- lifecycle hooks ----------

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
    activeProvider: string;
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
      activeProvider: this.provider.providerName,
    };
  }

  async updateConfig(
    tenantId: string,
    patch: { enabled?: boolean; config?: Record<string, unknown> },
  ) {
    const set: Partial<typeof tenants.$inferInsert> = { updatedAt: new Date() };
    if (patch.enabled !== undefined) set.outboundVoiceEnabled = patch.enabled;
    if (patch.config !== undefined) {
      const nextConfig = { ...patch.config };
      if ('test_override_number' in nextConfig) {
        nextConfig.test_override_number = normalizeOptionalPhone(
          typeof nextConfig.test_override_number === 'string'
            ? nextConfig.test_override_number
            : null,
        );
      }
      set.outboundVoiceConfig = nextConfig as never;
    }
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
      throw new BadRequestException('Outbound voice is disabled for this tenant');
    }
    if (await this.freeTrialLimitReached(tenant)) {
      throw new BadRequestException('Outbound trial call limit reached. Please contact support to enable more calls.');
    }
    const allowed = readConfigArray(tenant, 'enabled_purposes');
    if (allowed && allowed.length > 0 && !allowed.includes(purpose)) {
      throw new Error(`Outbound voice purpose "${purpose}" is not enabled for this tenant`);
    }
    return tenant;
  }

  private async freeTrialLimitReached(tenant: typeof tenants.$inferSelect): Promise<boolean> {
    const limitMinutes = readConfigNumber(tenant, 'free_trial_call_minutes', 15);
    if (limitMinutes <= 0) return false;

    const billing = (
      await this.db
        .select({ plan: tenantBilling.plan })
        .from(tenantBilling)
        .where(eq(tenantBilling.tenantId, tenant.id))
        .limit(1)
    )[0];
    const plan = (billing?.plan ?? 'FREE').trim().toUpperCase();
    if (plan !== 'FREE' && plan !== 'TRIAL') return false;

    const usage = (
      await this.db
        .select({
          seconds: sql<number>`coalesce(sum(case when ${outboundCalls.status} = 'failed' then coalesce(${outboundCalls.durationSeconds}, 0) else coalesce(${outboundCalls.durationSeconds}, 60) end), 0)::int`,
        })
        .from(outboundCalls)
        .where(
          and(
            eq(outboundCalls.tenantId, tenant.id),
            sql`${outboundCalls.status} <> 'cancelled'`,
          ),
        )
        .limit(1)
    )[0];
    return (usage?.seconds ?? 0) >= limitMinutes * 60;
  }

  async publicDemoCall(input: {
    mode?: 'explicit' | 'live';
    scenario?: 'competitor_repair' | 'auto_body' | 'residence' | 'our_shop' | 'unknown';
    scriptType?: 'auto_flip' | 'eta_confirmation' | 'status_update' | 'winch_out' | 'convini_only';
    toPhone: string;
    customerName?: string | null;
    businessName?: string | null;
    vehicle?: string | null;
    destination?: string | null;
    pickupLocation?: string | null;
    motorClub?: string | null;
    ipKey: string;
  }) {
    if (!(await this.publicDemoCallsEnabled())) {
      throw new Error('Public demo calls are currently disabled.');
    }
    const phoneKey = formatOutboundPhone(input.toPhone);
    this.assertPublicDemoRateLimit(`${input.ipKey}:${phoneKey}`);
    const tenantId = await this.resolvePublicDemoTenantId();
    const customerName = input.customerName?.trim() || 'Demo Caller';
    const scriptBody =
      input.scriptType && input.scriptType !== 'auto_flip'
        ? renderPublicDemoScript(input.scriptType, {
            customerName,
            vehicle: input.vehicle || 'demo tow request',
            pickupLocation:
              input.pickupLocation ||
              (input.businessName
                ? `${input.businessName} demo service location`
                : 'demo service location'),
            destination: input.destination || 'demo destination',
            motorClub: input.motorClub || 'Demo',
          })
        : undefined;
    return this.testCall(tenantId, {
      scenario: scriptBody ? undefined : input.scenario ?? 'unknown',
      toPhone: phoneKey,
      customerName,
      vehicle: input.vehicle || 'demo tow request',
      pickupLocation:
        input.pickupLocation ||
        (input.businessName
          ? `${input.businessName} demo service location`
          : 'demo service location'),
      destination: input.destination || 'demo destination',
      motorClub: input.motorClub || 'Demo',
      scriptBody,
      ignoreTenantOutboundDisabled: true,
      ignoreTrialLimit: true,
    });
  }

  async publicDemoCallStatus() {
    try {
      return {
        enabled: await this.publicDemoCallsEnabled(),
      };
    } catch {
      return { enabled: false };
    }
  }

  async testCall(
    tenantId: string,
    input: {
      scenario?: 'competitor_repair' | 'auto_body' | 'residence' | 'our_shop' | 'unknown';
      toPhone: string;
      customerName?: string;
      vehicle?: string;
      destination?: string;
      pickupLocation?: string;
      motorClub?: string;
      scriptBody?: string;
      ignoreTenantOutboundDisabled?: boolean;
      ignoreTrialLimit?: boolean;
    },
  ) {
    const { renderCallBody } = await import('../flip-engine/flip-scripts');
    
    // Ensure strict E.164 formatting for Retell
    let formattedPhone = input.toPhone.replace(/\D/g, '');
    if (formattedPhone.length === 10) formattedPhone = '+1' + formattedPhone;
    if (!formattedPhone.startsWith('+')) formattedPhone = '+' + formattedPhone;
    
    const rows = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const tenant = rows[0];
    if (!tenant) throw new Error('Tenant not found');
    if (!tenant.outboundVoiceEnabled && !input.ignoreTenantOutboundDisabled) {
      throw new BadRequestException('Outbound voice is disabled for this tenant');
    }
    if (!input.ignoreTrialLimit && await this.freeTrialLimitReached(tenant)) {
      throw new BadRequestException('Outbound trial call limit reached. Please contact support to enable more calls.');
    }
    const cfg = (tenant.outboundVoiceConfig as Record<string, unknown> | null) || {};
    const demoRetell = resolveRetellTenantConfig(cfg);
    const tenantTestModeEnabled = readConfigBool(tenant, 'test_mode_enabled', false);
    const tenantTestOverrideNumber = readConfigString(tenant, 'test_override_number', null);
    if (tenantTestModeEnabled && !tenantTestOverrideNumber?.trim()) {
      throw new BadRequestException('Tenant test mode is enabled but no test override number is set.');
    }

    const activeShops = await this.db
      .select()
      .from(alphaShops)
      .where(and(eq(alphaShops.tenantId, tenantId), eq(alphaShops.active, true)));

    const repairShops = activeShops.filter((s) => s.shopType === 'REPAIR');
    const bodyShops = activeShops.filter((s) => s.shopType === 'BODY');

    // Session 75 — this path used to hand the script `repairShops[0]` and a
    // LITERAL `nearestShopDistanceMiles: 3`. It measured nothing. A test call
    // from Lewis Center on 2026-08-14 was offered Complete Brake Service — 18
    // miles away, the ninth-nearest shop of nine — and told the customer it was
    // "just 3 miles from you". Both the shop and the number were fabrications,
    // and the same code backs the PUBLIC DEMO, so prospects heard it too.
    //
    // Real jobs were never affected: the orchestrator renders its own body and
    // passes it in as `scriptBody`, so it never reached this ctx. That is
    // exactly why the defect survived — it only ever fired where we were
    // looking at it.
    //
    // Now geocoded and measured like production, and honest when it cannot be:
    // no pickup, no geocode, or nothing inside the catchment means no shop and
    // no offer, rather than an invented one.
    const geocodedPickup = input.pickupLocation
      ? await this.geocoder.geocode(input.pickupLocation)
      : null;
    const flipCfg = (tenant.flipEngineConfig as Record<string, unknown> | null) ?? {};
    const maxShopDistanceMiles = Number(flipCfg.max_shop_distance_miles ?? 12);
    const nearest = geocodedPickup
      ? selectNearestShop({
          pickupLat: geocodedPickup.lat,
          pickupLng: geocodedPickup.lng,
          shopType: 'REPAIR',
          shops: activeShops.map((s) => ({
            id: s.id,
            name: s.name,
            shopType: s.shopType as 'REPAIR' | 'BODY',
            lat: s.lat == null ? null : Number(s.lat),
            lng: s.lng == null ? null : Number(s.lng),
            active: s.active,
          })),
        })
      : null;
    const withinCatchment =
      nearest?.shop != null &&
      nearest.distanceMiles != null &&
      nearest.distanceMiles <= maxShopDistanceMiles;
    const offeredName = withinCatchment ? nearest!.shop!.name.toLowerCase().trim() : null;
    const alternateShops = geocodedPickup
      ? selectNearestShops(
          {
            pickupLat: geocodedPickup.lat,
            pickupLng: geocodedPickup.lng,
            shopType: 'REPAIR',
            shops: activeShops.map((s) => ({
              id: s.id,
              name: s.name,
              shopType: s.shopType as 'REPAIR' | 'BODY',
              lat: s.lat == null ? null : Number(s.lat),
              lng: s.lng == null ? null : Number(s.lng),
              active: s.active,
            })),
          },
          4,
        )
          .filter((x) => x.shop.name.toLowerCase().trim() !== offeredName)
          .slice(0, 3)
          .map((x) => ({ name: x.shop.name, distanceMiles: x.distanceMiles }))
      : [];
    if (input.pickupLocation && !withinCatchment) {
      this.logger.warn(
        `[outbound-voice] test call: no partner shop offered — pickup="${input.pickupLocation}" ` +
          `geocoded=${geocodedPickup ? `${geocodedPickup.lat},${geocodedPickup.lng}` : 'FAILED'} ` +
          `nearest=${nearest?.shop?.name ?? 'none'} distance=${nearest?.distanceMiles ?? 'n/a'}mi ` +
          `cap=${maxShopDistanceMiles}mi`,
      );
    }

    const ctx: any = {
      repName: (cfg.rep_name as string) || '',
      companyName: (cfg.company_name as string) || 'Roadside Towing',
      motorClub: input.motorClub || 'Agero Motor Club',
      callbackNumber: (cfg.callback_number as string) || process.env.RETELL_CALLBACK_NUMBER || '',
      conviniLink: (cfg.convini_link as string) || 'https://convini.live',
      diagnosticValue: Number(cfg.diagnostic_value ?? 179),
      customerFirstName: input.customerName?.split(' ')[0] || 'John',
      vehicle: input.vehicle || '2019 Honda Civic',
      pickupLocation: input.pickupLocation || '123 Main Street',
      destination: input.destination || 'Collision Center',
      issue: 'a breakdown',
      issueSubcategory: null,
      nearestShop: withinCatchment ? nearest!.shop!.name : null,
      nearestShopDistanceMiles: withinCatchment ? Math.round(nearest!.distanceMiles!) : null,
      alternateShops: withinCatchment ? alternateShops : null,
      bodyShop1: bodyShops[0]?.name || null,
      bodyShop2: bodyShops[1]?.name || bodyShops[0]?.name || null,
      rentalsAvailable: true,
    };

    const fullBody = input.scriptBody || (input.scenario ? renderCallBody(input.scenario, ctx) : '');
    const [call] = await this.db
      .insert(outboundCalls)
      .values({
        tenantId,
        purpose: 'custom',
        toPhone: formattedPhone,
        toName: input.customerName || 'Test Customer',
        scriptTemplate: 'custom',
        scriptVariables: { body: fullBody } as never,
        maxAttempts: 1,
      })
      .returning();

    let result: any;
    try {
      result = await this.provider.placeCall({
        toPhone: formattedPhone,
        toName: input.customerName || 'Test Customer',
        scriptBody: fullBody,
        scriptTemplate: 'custom',
        scriptVariables: { body: fullBody },
        callId: call.id,
        tenantId,
        // Same per-tenant Retell resolution as the dispatch path, so a manual
        // or demo call exercises the agent the tenant's real calls will use.
        agentId: readConfigString(tenant, 'retell_outbound_agent_id', null) ?? undefined,
        agentVersion: demoRetell.agentVersion ?? undefined,
        fromNumber: demoRetell.fromNumber ?? undefined,
        callbackUrl: buildCallbackUrl(this.provider.providerName),
        testModeEnabled: tenantTestModeEnabled,
        testOverrideNumber: tenantTestOverrideNumber,
      });
    } catch (e: any) {
      throw new BadRequestException(e.message || String(e));
    }

    if (!result?.providerCallId) {
      await this.db
        .update(outboundCalls)
        .set({
          status: 'failed',
          attempts: 1,
          error: `${this.provider.providerName}_unavailable_or_unconfigured`,
          endedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(outboundCalls.id, call.id));
    } else {
      const providerIdColumn = this.provider.providerName === 'retell'
        ? 'retell_call_id'
        : 'thinkrr_call_id';
      await this.db.execute(
        sql`update outbound_calls
            set status = 'dialing',
                ${sql.raw(providerIdColumn)} = ${result.providerCallId},
                provider = ${this.provider.providerName},
                attempts = 1,
                started_at = now(),
                updated_at = now()
            where id = ${call.id}`,
      );
    }

    return {
      success: !!result?.providerCallId,
      outboundCallId: call.id,
      callId: result?.providerCallId ?? null,
      toPhone: formattedPhone,
      scenario: input.scenario,
      scriptPreview: fullBody.split('\n').slice(0, 10).join('\n') + '...',
      message: `Test call placed to ${formattedPhone}. The AI agent should call within 10 seconds.`,
    };
  }

  private assertPublicDemoRateLimit(key: string) {
    const now = Date.now();
    const last = this.publicDemoAttempts.get(key) ?? 0;
    const waitMs = 10 * 60 * 1000;
    if (now - last < waitMs) {
      throw new Error('Demo call limit reached. Please try again later or book a live demo.');
    }
    this.publicDemoAttempts.set(key, now);
    for (const [attemptKey, timestamp] of this.publicDemoAttempts.entries()) {
      if (now - timestamp > waitMs) this.publicDemoAttempts.delete(attemptKey);
    }
  }

  private async resolvePublicDemoTenantId(): Promise<string> {
    const configured =
      process.env.PUBLIC_DEMO_TENANT_ID ||
      process.env.DEMO_TENANT_ID ||
      process.env.NEXT_PUBLIC_DEMO_TENANT_ID;
    const rows = configured
      ? await this.db
          .select({
            id: tenants.id,
            outboundVoiceConfig: tenants.outboundVoiceConfig,
          })
          .from(tenants)
          .where(eq(tenants.id, configured))
          .limit(1)
      : await this.db
          .select({
            id: tenants.id,
            outboundVoiceConfig: tenants.outboundVoiceConfig,
          })
          .from(tenants)
          .where(sql`${tenants.outboundVoiceConfig}->>'demo_mode' = 'true'`)
          .orderBy(desc(tenants.createdAt))
          .limit(1);
    const tenant = rows[0];
    if (!tenant) {
      throw new Error('Public demo calls are not configured.');
    }
    const cfg = (tenant.outboundVoiceConfig as Record<string, unknown> | null | undefined) ?? {};
    if (cfg.demo_mode !== true) {
      throw new Error('Public demo calls require a demo account.');
    }
    return tenant.id;
  }

  private async publicDemoCallsEnabled(): Promise<boolean> {
    const row = (
      await this.db
        .select({ value: platformSettings.value })
        .from(platformSettings)
        .where(eq(platformSettings.key, 'public_demo_calls_enabled'))
        .limit(1)
    )[0];
    const value = row?.value as Record<string, unknown> | boolean | null | undefined;
    if (typeof value === 'boolean') return value;
    return Boolean(value?.enabled);
  }
}

function normalizeOutcomeValue(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[\s-]+/g, '_').toUpperCase();
  if (!normalized) return null;
  if (/NOT_ATTEMPT|SKIP|N\/A|NONE/.test(normalized)) return 'NOT_ATTEMPTED';
  if (/DECLINE|REJECT|NO|LOST|LOSS|REFUSE|DID_NOT|DONT|DON'T|NO_CHANGE|NOT_CHANGE|NO_SWITCH/.test(normalized)) {
    return 'DECLINED';
  }
  if (
    /ACCEPT|SUCCESS|YES|WIN|AGREE|SWITCH|REDIRECT|CHANGE_DESTINATION|DESTINATION_CHANGE|CHANGED_DESTINATION|UPDATE_DESTINATION/.test(
      normalized,
    )
  ) {
    return 'ACCEPTED';
  }
  return trimForColumn(normalized, 20);
}

function outcomeMeansAccepted(value: string | null): boolean {
  return value === 'ACCEPTED';
}

function pickAcceptedOfferFromAnalysis(
  offer1: string | null,
  offer2: string | null,
  offer3: string | null,
  flipOutcome: string | null,
): 1 | 2 | 3 | null {
  if (offer1 === 'ACCEPTED') return 1;
  if (offer2 === 'ACCEPTED') return 2;
  if (offer3 === 'ACCEPTED') return 3;
  return outcomeMeansAccepted(flipOutcome) ? 1 : null;
}

/**
 * Copy an analysis value onto the update only when the model actually returned
 * one.
 *
 * Three cases have to stay distinct, and `if (value)` collapses all three:
 *   - a real answer            -> write it
 *   - the string "unknown"     -> write it. An honest unknown is information;
 *                                 the agent is told to record it rather than
 *                                 guess, and a driver reading "drivetrain
 *                                 unknown" behaves differently to one reading
 *                                 nothing at all.
 *   - null / '' (not reached)  -> leave whatever is already stored alone, so a
 *                                 late call_analyzed event or the reconcile
 *                                 sweep cannot blank an answer an earlier
 *                                 webhook captured.
 */
function assignIfPresent<K extends keyof typeof outboundCallLogs.$inferInsert>(
  target: Partial<typeof outboundCallLogs.$inferInsert>,
  key: K,
  value: unknown,
): void {
  if (value == null) return;
  const text = String(value).trim();
  if (text === '') return;
  (target as Record<string, unknown>)[key as string] = text;
}

function pickAcceptedOfferForSms(row: Partial<typeof outboundCallLogs.$inferInsert>): 1 | 2 | 3 {
  if (row.offer1Result === 'ACCEPTED') return 1;
  if (row.offer2Result === 'ACCEPTED') return 2;
  if (row.offer3Result === 'ACCEPTED') return 3;
  return 1;
}

function trimForColumn(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function readManagerPhones(tenant: typeof tenants.$inferSelect): string[] {
  const raw = tenant.managerPhones as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.filter((phone): phone is string => typeof phone === 'string' && phone.trim().length > 0);
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return 'unknown';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'no_answer',
  'busy',
  'rejected',
  'cancelled',
]);

// ---------- abandoned-pitch retry config (Session 76) ----------

function envInt(name: string, fallback: number): number {
  const raw = (process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * Master switch. Default ON because the behaviour Chris asked for is the
 * correction of a defect — a live call dying mid-pitch was simply never retried —
 * but a single env var turns it off without a code change if redial volume
 * misbehaves.
 */
const ABANDONED_PITCH_RETRY_ENABLED =
  (process.env.OUTBOUND_ABANDONED_PITCH_RETRY ?? 'true').trim().toLowerCase() !== 'false';

/**
 * "No less than 3 attempts" (Chris, 2026-08-17). This is a FLOOR applied over
 * whatever the row carries, so an old row enqueued with max_attempts=1 still
 * gets its three tries rather than silently honouring the smaller number.
 */
const ABANDONED_PITCH_MIN_ATTEMPTS = Math.max(
  envInt('OUTBOUND_ABANDONED_PITCH_MIN_ATTEMPTS', 3),
  1,
);

/**
 * Chris asked for "immediately". This defaults to 60 seconds rather than 0, and
 * that deserves an explicit justification because it is a deliberate departure:
 * dialling a customer back within a second or two of them hanging up reads as a
 * malfunction (or harassment) to the person on the other end, and Retell needs a
 * moment to finalise the call record we just judged. Sixty seconds is still
 * "right away" to a customer standing next to a broken car, and it is one env
 * var from zero. Raise it if redials start landing on people mid-tow.
 */
const ABANDONED_PITCH_RETRY_DELAY_SECONDS = envInt('OUTBOUND_ABANDONED_PITCH_DELAY_SECONDS', 60);

/** See DEFAULT_INTAKE_COMPLETE_SECONDS in pitch-completion.ts. */
const ABANDONED_PITCH_INTAKE_SECONDS = envInt(
  'OUTBOUND_RETRY_INTAKE_COMPLETE_SECONDS',
  DEFAULT_INTAKE_COMPLETE_SECONDS,
);

/**
 * How far from a call's own timestamp we will look for its flip log row. Six
 * hours is generous for a match that should be near-simultaneous, and still far
 * tighter than the unbounded phone lookup it replaces.
 */
const ABANDONED_PITCH_LOG_MATCH_WINDOW_HOURS = envInt(
  'OUTBOUND_ABANDONED_PITCH_LOG_WINDOW_HOURS',
  6,
);

/**
 * A call must be at least this old before the sweep will judge it without
 * provider analysis. Long enough that `call_analyzed` has genuinely had its
 * chance (it normally lands within a minute of `call_ended`), short enough that
 * a customer still remembers the call they were on.
 */
const ABANDONED_PITCH_SWEEP_MIN_AGE_SECONDS = envInt(
  'OUTBOUND_ABANDONED_PITCH_SWEEP_MIN_AGE_SECONDS',
  600,
);

/**
 * How long a row may sit in `dialing` / `in_progress` before the sweep treats it
 * as stuck rather than live. No real outbound flip call approaches this — the
 * longest on 2026-08-17 was 201 seconds — so anything past it has lost its
 * webhook, not its customer. Set well above any plausible call length: the cost
 * of being wrong here is dialling someone who is still on the phone with us.
 */
const ABANDONED_PITCH_STUCK_INFLIGHT_MINUTES = envInt(
  'OUTBOUND_ABANDONED_PITCH_STUCK_MINUTES',
  30,
);

// ---------- stalled-call reconciliation config (Session 76) ----------

/**
 * How long a call may sit in `dialing` / `in_progress` before we go and ask
 * Retell what happened to it. Five minutes clears the longest observed call
 * (201s) with room to spare, so we never force a terminal state onto a
 * conversation that is still running.
 */
const RECONCILE_MIN_AGE_SECONDS = envInt('OUTBOUND_RECONCILE_MIN_AGE_SECONDS', 300);

/** One GET per row, so keep a batch modest and let the 3-minute cron catch up. */
const RECONCILE_BATCH_SIZE = envInt('OUTBOUND_RECONCILE_BATCH_SIZE', 25);

function mapProviderStatus(raw: string): string | null {
  const s = raw.toLowerCase().trim();
  if (s === 'ringing' || s === 'initiated' || s === 'queued' || s === 'dialing') return 'dialing';
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

function readConfigNumber(
  tenant: typeof tenants.$inferSelect,
  key: string,
  defaultValue: number,
): number {
  const cfg = (tenant.outboundVoiceConfig as Record<string, unknown> | null) ?? {};
  const v = cfg[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : defaultValue;
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

function formatOutboundPhone(value: string): string {
  let formatted = value.replace(/\D/g, '');
  if (formatted.length === 10) formatted = `1${formatted}`;
  if (formatted.length < 8 || formatted.length > 15) {
    throw new Error('Please enter a valid phone number.');
  }
  return `+${formatted}`;
}

function normalizeOptionalPhone(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (trimmed.startsWith('+')) return trimmed;
  return `+${digits}`;
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || 'there';
}

function renderPublicDemoScript(
  scriptType: 'eta_confirmation' | 'status_update' | 'winch_out' | 'convini_only',
  vars: {
    customerName: string;
    vehicle: string;
    pickupLocation: string;
    destination: string;
    motorClub: string;
  },
): string {
  const name = firstName(vars.customerName);
  switch (scriptType) {
    case 'eta_confirmation':
      return `Hi ${name}, this is Emily from Roadside Towing. I am calling to confirm your ${vars.motorClub} service request. The pickup is ${vars.pickupLocation}. The destination is ${vars.destination}. Your driver will call if they need anything else.`;
    case 'status_update':
      return `Hi ${name}, this is Emily from Roadside Towing with a quick update on your service request for ${vars.vehicle}. Your job is still active, and the dispatch team is tracking it.`;
    case 'winch_out':
      return `Hi ${name}, this is Emily from Roadside Towing about your winch-out request at ${vars.pickupLocation}. A winch out means we help get the vehicle back onto solid ground. Please have photos of the situation ready to send by text when the driver calls.`;
    case 'convini_only':
      return `Hi ${name}, this is Emily from Roadside Towing. I am calling about your ${vars.motorClub} service request. Please watch for the CONVINI app link so you can track and manage the service details from your phone.`;
  }
}

function buildCallbackUrl(provider: 'retell' | 'thinkrr'): string {
  const base = (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  return `${base}/webhooks/${provider}/outbound-result`;
}
