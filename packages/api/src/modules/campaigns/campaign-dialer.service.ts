import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import {
  campaignCallLogs,
  campaignLeads,
  campaignSuppressions,
  campaigns,
  type CampaignLeadRow,
  type CampaignRow,
} from '../../db/schema';
import { CampaignsService } from './campaigns.service';
import { RetellCampaignClient } from './retell-campaign.client';
import { decideDisposition, nextLeadStatus } from './campaign-disposition';
import { isHoliday, isWithinCallWindow } from './phone-normalize';

/**
 * Session 78 — the outreach dialler.
 *
 * Four guards stand between a lead row and a ringing phone, and every one of
 * them has a specific failure it prevents:
 *
 *   1. CAMPAIGN STATUS. Anything but ACTIVE dials nothing. A campaign that
 *      exists is not a campaign that runs — the flip dialler's weekend pause
 *      works the same way and it is the single most useful switch on it.
 *
 *   2. CALLING WINDOW, LOCAL TO THE CALLED NUMBER. Not the server's clock and
 *      not the tenant's. Unknown timezone means we do not dial, because we
 *      cannot prove it is a legal hour there.
 *
 *   3. ATTEMPT AND DAILY CAPS. One attempt per number per day, two lifetime.
 *
 *   4. SUPPRESSION, RE-CHECKED AT CLAIM TIME. Ingest already refuses suppressed
 *      numbers, but a batch takes minutes and somebody can opt out during it.
 *      The check that matters is the one immediately before the dial.
 *
 * Leads are CLAIMED with a conditional UPDATE (QUEUED -> CALLING) that returns
 * the rows it actually changed. Two overlapping runs therefore cannot dial the
 * same number: the second one's UPDATE matches nothing.
 */

export interface RunOptions {
  /** Cap this run. Undefined means the campaign's remaining daily budget. */
  limit?: number;
  /** Resolve every guard, log what WOULD be dialled, place no calls. */
  dryRun?: boolean;
}

export interface RunResult {
  campaign: string;
  dryRun: boolean;
  considered: number;
  placed: number;
  skipped: Record<string, number>;
  wouldDial: Array<{ phone: string; company: string | null; timezone: string | null }>;
  errors: string[];
}

@Injectable()
export class CampaignDialerService {
  private readonly logger = new Logger(CampaignDialerService.name);

  /** Guards against two cron ticks overlapping on the same campaign. */
  private readonly running = new Set<string>();

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly campaignsService: CampaignsService,
    private readonly retell: RetellCampaignClient,
  ) {}

  // -------------------------------------------------------------------------
  // The batch
  // -------------------------------------------------------------------------

  async run(tenantId: string, campaignId: string, opts: RunOptions = {}): Promise<RunResult> {
    const campaign = await this.campaignsService.getCampaign(tenantId, campaignId);
    const dryRun = opts.dryRun === true;

    const result: RunResult = {
      campaign: campaign.name,
      dryRun,
      considered: 0,
      placed: 0,
      skipped: {},
      wouldDial: [],
      errors: [],
    };
    const skip = (reason: string) => {
      result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
    };

    // ---- Guard 1: the campaign must be switched on. ------------------------
    // A dry run is allowed to inspect an OFF campaign — that is how you check a
    // list before turning it on — but a live run is not.
    if (campaign.status !== 'ACTIVE' && !dryRun) {
      result.errors.push(`campaign status is ${campaign.status}, not ACTIVE`);
      return result;
    }
    if (!dryRun && !this.isDialable(campaign, result)) return result;

    // Overlap guard. A run that takes longer than the cron interval must not be
    // joined by the next tick.
    if (this.running.has(campaignId)) {
      result.errors.push('a run is already in progress for this campaign');
      return result;
    }
    this.running.add(campaignId);

    try {
      // ---- Daily cap. -----------------------------------------------------
      const dialedToday = await this.countDialedToday(campaignId);
      const remainingToday = Math.max(0, campaign.dailyCap - dialedToday);
      if (remainingToday === 0 && !dryRun) {
        result.errors.push(`daily cap reached (${campaign.dailyCap})`);
        return result;
      }

      const budget = Math.min(
        opts.limit ?? remainingToday,
        dryRun ? (opts.limit ?? campaign.concurrency) : remainingToday,
      );
      if (budget <= 0) return result;

      // Pull more than the budget: many will fail the per-lead window check, so
      // a batch sized exactly to the budget would under-dial on a mixed list.
      const pool = await this.fetchDialable(campaign, budget * 6);
      result.considered = pool.length;

      const eligible: CampaignLeadRow[] = [];
      for (const lead of pool) {
        if (eligible.length >= budget) break;

        // ---- Guard 2: the window, where THIS number rings. -----------------
        const window = {
          startHour: campaign.callWindowStartHour,
          endHour: campaign.callWindowEndHour,
          days: (campaign.callDays as number[]) ?? [1, 2, 3, 4, 5],
        };
        const check = isWithinCallWindow(lead.timezone, window);
        if (!check.allowed) {
          skip(check.reason ?? 'outside_window');
          continue;
        }
        if (isHoliday(lead.timezone)) {
          skip('us_holiday');
          continue;
        }

        // ---- Guard 3: one attempt per number per day. ----------------------
        if (lead.lastAttemptAt && this.sameLocalDay(lead.lastAttemptAt, lead.timezone)) {
          skip('already_attempted_today');
          continue;
        }
        if (lead.attempts >= campaign.maxAttempts) {
          skip('max_attempts');
          continue;
        }

        eligible.push(lead);
      }

      if (dryRun) {
        result.wouldDial = eligible.map((l) => ({
          phone: l.phone,
          company: l.company,
          timezone: l.timezone,
        }));
        return result;
      }

      // ---- Place the calls, `concurrency` at a time. -----------------------
      for (let i = 0; i < eligible.length; i += campaign.concurrency) {
        const slice = eligible.slice(i, i + campaign.concurrency);
        const outcomes = await Promise.all(
          slice.map((lead) => this.dialOne(campaign, lead).catch((err) => {
            this.logger.error(`[campaigns] dial threw for ${lead.phone}: ${(err as Error).message}`);
            return { placed: false, reason: 'threw' };
          })),
        );
        for (const o of outcomes) {
          if (o.placed) result.placed += 1;
          else skip(o.reason);
        }
      }

      this.logger.log(
        `[campaigns] ${campaign.slug}: placed ${result.placed}/${result.considered} ` +
          `(skipped: ${JSON.stringify(result.skipped)})`,
      );
      return result;
    } finally {
      this.running.delete(campaignId);
    }
  }

  /**
   * Claim and dial one lead.
   *
   * The claim is a conditional UPDATE returning the changed row. If another run
   * (or a retry of this one) already moved the lead out of a dialable state,
   * the UPDATE matches nothing and we stop — no double dial, no lock table.
   */
  private async dialOne(
    campaign: CampaignRow,
    lead: CampaignLeadRow,
  ): Promise<{ placed: boolean; reason: string }> {
    // ---- Guard 4: suppression, immediately before the dial. ---------------
    // Ingest checked this too, but a batch takes minutes and an opt-out during
    // it must land on the batch that is already running.
    if (await this.campaignsService.isSuppressed(campaign.tenantId, lead.phone)) {
      await this.db
        .update(campaignLeads)
        .set({ status: 'DNC', updatedAt: new Date() })
        .where(eq(campaignLeads.id, lead.id));
      return { placed: false, reason: 'suppressed_at_dial_time' };
    }

    const claimed = await this.db
      .update(campaignLeads)
      .set({
        status: 'CALLING',
        attempts: sql`${campaignLeads.attempts} + 1`,
        lastAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(campaignLeads.id, lead.id),
          inArray(campaignLeads.status, ['QUEUED', 'RETRY', 'VM']),
        ),
      )
      .returning({ id: campaignLeads.id, attempts: campaignLeads.attempts });

    if (claimed.length === 0) return { placed: false, reason: 'claimed_by_another_run' };

    // The log row is written BEFORE the provider call. If the process dies
    // between insert and dial we are left with a PENDING row the reconcile
    // sweep will resolve — losing the attempt entirely would be worse, because
    // the lead's attempt counter has already moved.
    const [log] = await this.db
      .insert(campaignCallLogs)
      .values({
        campaignId: campaign.id,
        tenantId: campaign.tenantId,
        leadId: lead.id,
        direction: 'OUTBOUND',
        phone: lead.phone,
        company: lead.company,
        agentId: campaign.outboundAgentId,
        agentVersion: campaign.outboundAgentVersion,
        status: 'PENDING',
        startedAt: new Date(),
      })
      .returning({ id: campaignCallLogs.id });

    if (!campaign.outboundAgentId || !campaign.fromNumber) {
      await this.failCall(log.id, lead.id, 'campaign missing agent id or from number');
      return { placed: false, reason: 'campaign_not_configured' };
    }

    const placed = await this.retell.placeCall({
      toNumber: lead.phone,
      fromNumber: campaign.fromNumber,
      agentId: campaign.outboundAgentId,
      agentVersion: campaign.outboundAgentVersion,
      campaignCallId: log.id,
      campaignId: campaign.id,
      tenantId: campaign.tenantId,
      dynamicVariables: {
        company: lead.company ?? '',
        state: lead.state ?? '',
        city: lead.city ?? '',
      },
    });

    if (!placed) {
      await this.failCall(log.id, lead.id, 'provider rejected the call');
      return { placed: false, reason: 'provider_error' };
    }

    await this.db
      .update(campaignCallLogs)
      .set({
        providerCallId: placed.providerCallId,
        status: 'IN_PROGRESS',
        updatedAt: new Date(),
      })
      .where(eq(campaignCallLogs.id, log.id));

    return { placed: true, reason: 'placed' };
  }

  private async failCall(callId: string, leadId: string, error: string): Promise<void> {
    await this.db
      .update(campaignCallLogs)
      .set({
        status: 'FAILED',
        disposition: 'ERROR',
        error,
        endedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(campaignCallLogs.id, callId));
    // Back to RETRY, not QUEUED: the attempt counter has already incremented,
    // so this lead has genuinely used one of its two chances.
    await this.db
      .update(campaignLeads)
      .set({ status: 'RETRY', updatedAt: new Date() })
      .where(eq(campaignLeads.id, leadId));
  }

  // -------------------------------------------------------------------------
  // Result ingestion — shared by the webhook and the reconcile sweep
  // -------------------------------------------------------------------------

  /**
   * Apply a provider call snapshot to our row and the lead behind it.
   *
   * Deliberately the SINGLE path for both the webhook and the reconcile sweep.
   * On the flip dialler these were two code paths that parsed the same object
   * differently and then disagreed about what a call did.
   */
  async applyCallResult(
    providerCallId: string,
    snapshot: {
      call_status?: string;
      disconnection_reason?: string;
      duration_ms?: number;
      transcript?: string;
      recording_url?: string;
      call_analysis?: Record<string, unknown>;
      start_timestamp?: number;
      end_timestamp?: number;
    },
  ): Promise<{ matched: boolean }> {
    const row = (
      await this.db
        .select()
        .from(campaignCallLogs)
        .where(eq(campaignCallLogs.providerCallId, providerCallId))
        .limit(1)
    )[0];
    if (!row) return { matched: false };

    // An ongoing call has no outcome yet. Record that it started and wait.
    if (snapshot.call_status === 'ongoing' || snapshot.call_status === 'registered') {
      await this.db
        .update(campaignCallLogs)
        .set({ status: 'IN_PROGRESS', updatedAt: new Date() })
        .where(eq(campaignCallLogs.id, row.id));
      return { matched: true };
    }

    const durationSeconds = snapshot.duration_ms
      ? Math.round(snapshot.duration_ms / 1000)
      : row.durationSeconds ?? null;

    const status = this.mapStatus(snapshot.call_status, snapshot.disconnection_reason);
    const analysis = snapshot.call_analysis ?? null;

    const verdict = decideDisposition({
      status,
      disconnectionReason: snapshot.disconnection_reason,
      durationSeconds,
      transcript: snapshot.transcript ?? row.transcript,
      analysis,
    });

    await this.db
      .update(campaignCallLogs)
      .set({
        status: status === 'completed' ? 'COMPLETED' : status.toUpperCase(),
        disposition: verdict.disposition,
        disconnectionReason: snapshot.disconnection_reason ?? null,
        durationSeconds,
        // Never blank an answer an earlier event captured: a late `call_analyzed`
        // can arrive with fewer fields than the `call_ended` before it.
        ...(snapshot.transcript ? { transcript: snapshot.transcript } : {}),
        ...(snapshot.recording_url ? { recordingUrl: snapshot.recording_url } : {}),
        ...(analysis ? { analysis } : {}),
        summary: (analysis?.call_summary as string) ?? row.summary,
        sentiment: (analysis?.user_sentiment as string) ?? row.sentiment,
        callbackTime: verdict.callbackTime ?? row.callbackTime,
        endedAt: snapshot.end_timestamp ? new Date(snapshot.end_timestamp) : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(campaignCallLogs.id, row.id));

    // An opt-out suppresses immediately, before the lead status is touched.
    if (verdict.disposition === 'DNC') {
      await this.campaignsService.suppress(
        row.tenantId,
        row.phone,
        'verbal_opt_out',
        verdict.optOutQuote,
        row.id,
      );
      return { matched: true };
    }

    if (row.leadId) {
      const lead = (
        await this.db
          .select({ attempts: campaignLeads.attempts })
          .from(campaignLeads)
          .where(eq(campaignLeads.id, row.leadId))
          .limit(1)
      )[0];
      const campaign = (
        await this.db
          .select({ maxAttempts: campaigns.maxAttempts })
          .from(campaigns)
          .where(eq(campaigns.id, row.campaignId))
          .limit(1)
      )[0];

      const next = nextLeadStatus(
        verdict.disposition,
        lead?.attempts ?? 1,
        campaign?.maxAttempts ?? 2,
      );
      await this.db
        .update(campaignLeads)
        .set({ status: next, updatedAt: new Date() })
        .where(eq(campaignLeads.id, row.leadId));
    }

    return { matched: true };
  }

  /**
   * Backfill calls whose terminal webhook never arrived.
   *
   * Not defensive programming — on the flip dialler this exact gap hid better
   * than a third of one morning's calls, and the drop was biased toward LONG
   * calls, which are the only ones that ever produce a result.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcileStalledCalls(): Promise<void> {
    if (!this.retell.isConfigured()) return;

    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const stalled = await this.db
      .select({ id: campaignCallLogs.id, providerCallId: campaignCallLogs.providerCallId })
      .from(campaignCallLogs)
      .where(
        and(
          inArray(campaignCallLogs.status, ['PENDING', 'IN_PROGRESS']),
          lte(campaignCallLogs.createdAt, cutoff),
          ne(campaignCallLogs.providerCallId, ''),
        ),
      )
      .limit(100);

    let fixed = 0;
    for (const row of stalled) {
      if (!row.providerCallId) continue;
      const snapshot = await this.retell.getCall(row.providerCallId);
      if (!snapshot) continue;
      const { matched } = await this.applyCallResult(row.providerCallId, snapshot);
      if (matched) fixed += 1;
    }
    if (fixed > 0) this.logger.log(`[campaigns] reconciled ${fixed} stalled call(s)`);
  }

  /**
   * Auto-run every ACTIVE campaign, every 10 minutes.
   *
   * The per-lead window check is what actually paces this — a tick outside the
   * window simply finds nothing eligible and dials nobody, which is why the
   * cron can be dumb and frequent.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async autoRun(): Promise<void> {
    if (process.env.CAMPAIGN_AUTORUN_ENABLED !== 'true') return;

    const active = await this.db.select().from(campaigns).where(eq(campaigns.status, 'ACTIVE'));
    for (const campaign of active) {
      try {
        await this.run(campaign.tenantId, campaign.id, {});
      } catch (err) {
        this.logger.error(
          `[campaigns] autoRun failed for ${campaign.slug}: ${(err as Error).message}`,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private isDialable(campaign: CampaignRow, result: RunResult): boolean {
    if (!campaign.fromNumber) {
      result.errors.push('campaign has no from_number — buy and attach a Retell number first');
      return false;
    }
    if (!campaign.outboundAgentId) {
      result.errors.push('campaign has no outbound_agent_id');
      return false;
    }
    if (!this.retell.isConfigured()) {
      result.errors.push('RETELL_API_KEY is not set on this service');
      return false;
    }
    return true;
  }

  private async countDialedToday(campaignId: string): Promise<number> {
    const row = (
      await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(campaignCallLogs)
        .where(
          and(
            eq(campaignCallLogs.campaignId, campaignId),
            eq(campaignCallLogs.direction, 'OUTBOUND'),
            sql`${campaignCallLogs.createdAt} >= date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York'`,
          ),
        )
    )[0];
    return row?.n ?? 0;
  }

  /** Leads that could be dialled, cheapest filters first. */
  private async fetchDialable(campaign: CampaignRow, limit: number): Promise<CampaignLeadRow[]> {
    return this.db
      .select()
      .from(campaignLeads)
      .where(
        and(
          eq(campaignLeads.campaignId, campaign.id),
          inArray(campaignLeads.status, ['QUEUED', 'RETRY', 'VM']),
          sql`${campaignLeads.attempts} < ${campaign.maxAttempts}`,
          or(
            isNull(campaignLeads.nextEligibleAt),
            lte(campaignLeads.nextEligibleAt, new Date()),
          ),
        ),
      )
      // Fresh leads before retries: a first call is worth more than a second,
      // and a list that never reaches its new rows is a list that is not working.
      .orderBy(campaignLeads.attempts, campaignLeads.createdAt)
      .limit(limit);
  }

  /** Was `when` the same calendar day as now, where this number rings? */
  private sameLocalDay(when: Date, timezone: string | null): boolean {
    const zone = timezone || 'America/New_York';
    try {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      return fmt.format(when) === fmt.format(new Date());
    } catch {
      return false;
    }
  }

  private mapStatus(callStatus?: string, disconnectionReason?: string): string {
    const reason = (disconnectionReason || '').toLowerCase();
    if (reason.includes('no_answer') || reason.includes('no-answer')) return 'no_answer';
    if (reason.includes('busy')) return 'busy';
    if (reason.includes('dial_failed') || reason.includes('error')) return 'failed';
    if (callStatus === 'error') return 'error';
    if (callStatus === 'ended') return 'completed';
    return 'completed';
  }
}
