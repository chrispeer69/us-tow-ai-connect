import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { campaignCallLogs, campaignLeads, campaigns } from '../../db/schema';
import {
  buildSignaturePayloads,
  retellSecretsFromEnv,
  verifyRetellSignature,
  type RetellVerificationSecret,
} from '../../common/utils/retell-signature';
import { CampaignDialerService } from './campaign-dialer.service';
import { CampaignsService } from './campaigns.service';
import { decideDisposition } from './campaign-disposition';
import { normalizePhone } from './phone-normalize';

interface CampaignWebhookBody {
  event: 'call_started' | 'call_ended' | 'call_analyzed';
  call: {
    call_id: string;
    call_type?: string;
    direction?: string;
    call_status?: 'ongoing' | 'ended' | 'error' | 'registered';
    disconnection_reason?: string;
    duration_ms?: number;
    transcript?: string;
    recording_url?: string;
    start_timestamp?: number;
    end_timestamp?: number;
    from_number?: string;
    to_number?: string;
    agent_id?: string;
    call_analysis?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
}

/**
 * Session 78 — Retell events for outreach campaigns.
 *
 * A SEPARATE ENDPOINT from /webhooks/retell/outbound-result, not a branch
 * inside it. The tow webhook looks up `outbound_call_logs` by call id and maps
 * flip-specific analysis fields; a campaign event has no row there and no flip
 * fields, and teaching one controller both shapes would mean every future
 * change to either risks the other.
 *
 * Inbound is handled here too. Someone who returns a missed call reaches the
 * inbound agent on the same number, and that call has no `campaign_call_id` in
 * its metadata because we did not place it — so it is matched by NUMBER and a
 * row is created on the fly.
 */
@Controller('webhooks/retell/campaign')
export class CampaignWebhookController {
  private readonly logger = new Logger(CampaignWebhookController.name);
  private readonly secrets: RetellVerificationSecret[];

  constructor(
    private readonly dialer: CampaignDialerService,
    private readonly campaignsService: CampaignsService,
    @Inject(DB_CLIENT) private readonly db: DbClient,
  ) {
    this.secrets = retellSecretsFromEnv();
    if (this.secrets.length === 0) {
      this.logger.warn(
        'RETELL_WEBHOOK_SECRET and RETELL_API_KEY unset — campaign webhook signature verification is DISABLED',
      );
    }
  }

  @Post('result')
  @HttpCode(200)
  async handle(
    @Req() req: Request,
    @Headers('x-retell-signature') signature: string | undefined,
    @Body() body: CampaignWebhookBody,
  ): Promise<{ matched: boolean }> {
    if (this.secrets.length > 0) {
      const payloads = buildSignaturePayloads(req, body);
      if (!verifyRetellSignature(signature, this.secrets, payloads)) {
        this.logger.warn({
          message: '[campaigns] webhook signature mismatch',
          signaturePresent: Boolean(signature),
          secretLabels: this.secrets.map((s) => s.label),
        });
        throw new UnauthorizedException('invalid signature');
      }
    }

    const call = body?.call;
    if (!call?.call_id) {
      this.logger.warn('[campaigns] webhook missing call.call_id');
      return { matched: false };
    }

    this.logger.log({
      message: '[campaigns] webhook received',
      event: body.event,
      callId: call.call_id,
      direction: call.direction ?? 'unknown',
      durationMs: call.duration_ms ?? null,
    });

    // An outbound call we placed carries our row id in metadata and already has
    // a row waiting. Everything else is inbound.
    const isInbound =
      call.direction === 'inbound' || (!call.metadata?.campaign_call_id && Boolean(call.from_number));

    if (isInbound) {
      return this.handleInbound(call);
    }

    return this.dialer.applyCallResult(call.call_id, call);
  }

  /**
   * A returned call on the campaign number.
   *
   * These are worth more than the outbound ones — somebody who calls back is
   * self-selected interest — so they are logged with the same transcript and
   * recording as an outbound call rather than being dropped for having no
   * matching lead.
   */
  private async handleInbound(call: CampaignWebhookBody['call']): Promise<{ matched: boolean }> {
    const toNumber = call.to_number ?? null;
    if (!toNumber) return { matched: false };

    // Match the campaign by the number that was dialled.
    const campaign = (
      await this.db.select().from(campaigns).where(eq(campaigns.fromNumber, toNumber)).limit(1)
    )[0];
    if (!campaign) {
      this.logger.warn(`[campaigns] inbound call to unknown number ${toNumber}`);
      return { matched: false };
    }

    const caller = normalizePhone(call.from_number);
    const phone = caller.e164 ?? call.from_number ?? 'unknown';

    // Link it to the lead if we have called them — that is what turns "someone
    // rang back" into "the company we pitched on Tuesday rang back".
    const lead = caller.e164
      ? (
          await this.db
            .select({ id: campaignLeads.id, company: campaignLeads.company })
            .from(campaignLeads)
            .where(eq(campaignLeads.phone, caller.e164))
            .limit(1)
        )[0]
      : undefined;

    const durationSeconds = call.duration_ms ? Math.round(call.duration_ms / 1000) : null;
    const verdict = decideDisposition({
      status: call.call_status === 'error' ? 'error' : 'completed',
      disconnectionReason: call.disconnection_reason,
      durationSeconds,
      transcript: call.transcript,
      analysis: call.call_analysis ?? null,
    });

    // Upsert on the provider call id: `call_started`, `call_ended` and
    // `call_analyzed` all arrive for the same call and must not become three
    // rows in the list Chris reads.
    const existing = (
      await this.db
        .select({ id: campaignCallLogs.id })
        .from(campaignCallLogs)
        .where(eq(campaignCallLogs.providerCallId, call.call_id))
        .limit(1)
    )[0];

    const values = {
      campaignId: campaign.id,
      tenantId: campaign.tenantId,
      leadId: lead?.id ?? null,
      direction: 'INBOUND' as const,
      phone,
      company: lead?.company ?? null,
      providerCallId: call.call_id,
      agentId: call.agent_id ?? campaign.inboundAgentId,
      agentVersion: campaign.inboundAgentVersion,
      status: call.call_status === 'ongoing' ? 'IN_PROGRESS' : 'COMPLETED',
      disposition: call.call_status === 'ongoing' ? null : verdict.disposition,
      disconnectionReason: call.disconnection_reason ?? null,
      durationSeconds,
      ...(call.transcript ? { transcript: call.transcript } : {}),
      ...(call.recording_url ? { recordingUrl: call.recording_url } : {}),
      ...(call.call_analysis ? { analysis: call.call_analysis } : {}),
      summary: (call.call_analysis?.call_summary as string) ?? null,
      sentiment: (call.call_analysis?.user_sentiment as string) ?? null,
      callbackTime: verdict.callbackTime,
      startedAt: call.start_timestamp ? new Date(call.start_timestamp) : new Date(),
      endedAt: call.end_timestamp ? new Date(call.end_timestamp) : null,
      updatedAt: new Date(),
    };

    if (existing) {
      await this.db.update(campaignCallLogs).set(values).where(eq(campaignCallLogs.id, existing.id));
    } else {
      await this.db.insert(campaignCallLogs).values(values);
    }

    // An opt-out on an inbound call suppresses exactly as it does outbound.
    // Somebody who rings us specifically to be removed is the LAST person who
    // should stay on the list.
    if (verdict.disposition === 'DNC' && caller.e164) {
      await this.campaignsService.suppress(
        campaign.tenantId,
        caller.e164,
        'inbound_opt_out',
        verdict.optOutQuote,
        existing?.id ?? null,
      );
    }

    return { matched: true };
  }
}
