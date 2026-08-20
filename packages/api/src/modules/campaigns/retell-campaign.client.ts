import { Injectable, Logger } from '@nestjs/common';

/**
 * Session 78 — a thin Retell client for campaign calls.
 *
 * SEPARATE FROM `outbound-voice/retell-outbound.client.ts` on purpose. That
 * client reads its agent id, version and caller-ID from deployment env vars
 * (RETELL_AGENT_ID / RETELL_FROM_NUMBER) and injects tow-specific dynamic
 * variables — script_body, script_template, customer_name. A campaign has a
 * different agent, a different number and no script variables at all: Ray's
 * prompt is self-contained.
 *
 * Reusing it would have meant either polluting it with campaign branches or
 * having a campaign silently inherit the tow agent's env pinning, which is the
 * exact class of bug that made the flip agent version ambiguous.
 *
 * Everything here comes off the CAMPAIGN ROW, not the environment. The only env
 * value read is the API key, which is account-wide.
 */

export interface PlaceCampaignCallParams {
  toNumber: string;
  fromNumber: string;
  agentId: string;
  /** Published version to pin to. Omitted means Retell runs the latest DRAFT. */
  agentVersion?: string | null;
  /** Written into Retell metadata so the webhook can find our row. */
  campaignCallId: string;
  campaignId: string;
  tenantId: string;
  /** Merge fields available to the prompt, e.g. {{company}}. */
  dynamicVariables?: Record<string, string>;
}

export interface CampaignCallSnapshot {
  call_id: string;
  call_status?: 'ongoing' | 'ended' | 'error' | 'registered';
  disconnection_reason?: string;
  duration_ms?: number;
  transcript?: string;
  recording_url?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  call_analysis?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class RetellCampaignClient {
  private readonly logger = new Logger(RetellCampaignClient.name);
  private readonly apiKey: string | null;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = process.env.RETELL_API_KEY?.trim() || null;
    this.baseUrl = (process.env.RETELL_API_BASE_URL?.trim() || 'https://api.retellai.com').replace(
      /\/$/,
      '',
    );
    if (!this.apiKey) {
      this.logger.warn('RETELL_API_KEY unset — campaign calls will be logged-only');
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Place one call. Returns the provider call id, or null on any failure.
   *
   * Never throws: the dialler runs a batch, and one bad number must not abort
   * the other nine in flight. A null return is recorded on the call row as an
   * ERROR disposition with the reason attached.
   */
  async placeCall(params: PlaceCampaignCallParams): Promise<{ providerCallId: string } | null> {
    if (!this.apiKey) {
      this.logger.warn(`[campaigns] Retell unconfigured — skipping call ${params.campaignCallId}`);
      return null;
    }

    if (!params.agentVersion) {
      // Same trap as the flip agent: with no override_agent_version, Retell
      // resolves to the agent's LATEST version — the working draft, published
      // or not. Every dashboard save would then ship mid-campaign.
      this.logger.warn(
        `[campaigns] call ${params.campaignCallId} is UNPINNED on agent ${params.agentId} — ` +
          'it will run that agent\'s latest draft. Publish a version and set it on the campaign.',
      );
    }

    const body = {
      from_number: params.fromNumber,
      to_number: params.toNumber,
      override_agent_id: params.agentId,
      ...(params.agentVersion ? { override_agent_version: Number(params.agentVersion) } : {}),
      retell_llm_dynamic_variables: params.dynamicVariables ?? {},
      metadata: {
        campaign_call_id: params.campaignCallId,
        campaign_id: params.campaignId,
        tenant_id: params.tenantId,
        kind: 'outreach',
      },
    };

    try {
      const res = await fetch(`${this.baseUrl}/v2/create-phone-call`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(
          `[campaigns] Retell ${res.status} for ${params.campaignCallId}: ${text.slice(0, 300)}`,
        );
        return null;
      }
      const json = (await res.json().catch(() => ({}))) as { call_id?: string };
      if (!json.call_id) {
        this.logger.warn(`[campaigns] Retell response missing call_id for ${params.campaignCallId}`);
        return null;
      }
      return { providerCallId: json.call_id };
    } catch (err) {
      this.logger.warn(
        `[campaigns] placeCall threw for ${params.campaignCallId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Pull a call's state directly.
   *
   * The push path is not reliable — on the flip dialler, 12 of 32 calls in one
   * morning never received their terminal webhook and sat in_progress with no
   * transcript. The reconcile sweep uses this, and it is not optional.
   */
  async getCall(providerCallId: string): Promise<CampaignCallSnapshot | null> {
    if (!this.apiKey) return null;
    try {
      const res = await fetch(`${this.baseUrl}/v2/get-call/${providerCallId}`, {
        headers: { authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) return null;
      return (await res.json()) as CampaignCallSnapshot;
    } catch (err) {
      this.logger.warn(`[campaigns] getCall threw for ${providerCallId}: ${(err as Error).message}`);
      return null;
    }
  }
}
