import { Injectable, Logger } from '@nestjs/common';
import type {
  OutboundVoiceProvider,
  PlaceCallParams,
  PlaceCallResult,
} from './outbound-voice-provider.interface';

/**
 * Session 68 — Retell outbound HTTP wrapper.
 *
 * Reads at construction:
 *   RETELL_API_KEY         — Bearer token (required for live calls)
 *   RETELL_AGENT_ID        — override_agent_id sent on each call
 *   RETELL_FROM_NUMBER     — E.164 caller-ID provisioned in Retell
 *
 * Endpoint: POST https://api.retellai.com/v2/create-phone-call
 * Cancel:   POST https://api.retellai.com/v2/end-call (call_id in body)
 *
 * Returns null + logs a warning when unconfigured. Never throws — the
 * OutboundVoiceService marks the row `failed` on null returns.
 *
 * Dynamic variables mapped from scriptVariables → retell_llm_dynamic_variables.
 * Webhook events arrive at /webhooks/retell/outbound-result (see
 * retell-webhook.controller.ts).
 */
@Injectable()
export class RetellOutboundClient implements OutboundVoiceProvider {
  readonly providerName = 'retell' as const;

  private readonly logger = new Logger(RetellOutboundClient.name);
  private readonly apiKey: string | null;
  private readonly agentId: string | null;
  private readonly fromNumber: string | null;
  private readonly baseUrl: string;
  private readonly agentVersion: string | null;

  constructor() {
    const key = process.env.RETELL_API_KEY?.trim() ?? '';
    const agentId = process.env.RETELL_AGENT_ID?.trim() ?? '';
    const fromNumber = process.env.RETELL_FROM_NUMBER?.trim() ?? '';
    this.apiKey = key || null;
    this.agentId = agentId || null;
    this.fromNumber = fromNumber || null;
    this.baseUrl = (process.env.RETELL_API_BASE_URL?.trim() || 'https://api.retellai.com').replace(/\/$/, '');
    this.agentVersion = process.env.RETELL_AGENT_VERSION?.trim() || null;

    // SAFETY: when override_agent_version is omitted, Retell resolves the call
    // to the agent's LATEST version — which is the working draft, published or
    // not. That means every save in the Retell dashboard goes live on the next
    // call, with no review step and nothing to roll back to.
    //
    // Setting RETELL_AGENT_VERSION (a published version number, an environment
    // tag like "prod", or "latest_published") pins live traffic to a reviewed
    // version and turns the draft into a real staging area.
    if (!this.agentVersion) {
      this.logger.warn(
        'RETELL_AGENT_VERSION unset — live calls will run the agent\'s LATEST DRAFT. ' +
          'Any edit saved in the Retell dashboard ships immediately with no review. ' +
          'Publish a version and set RETELL_AGENT_VERSION to pin production.',
      );
    }

    if (!this.isConfigured()) {
      this.logger.warn(
        'RETELL_API_KEY / RETELL_AGENT_ID / RETELL_FROM_NUMBER not fully configured — outbound voice calls will be logged-only',
      );
    }
  }

  /** The version live calls are pinned to, or null when unpinned (unsafe). */
  pinnedVersion(): string | null {
    return this.agentVersion;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.agentId && this.fromNumber);
  }

  async placeCall(params: PlaceCallParams): Promise<PlaceCallResult | null> {
    if (!this.isConfigured()) {
      this.logger.warn(
        `[outbound-voice] Retell unconfigured — skipping placeCall for ${params.callId} (tenant ${params.tenantId})`,
      );
      return null;
    }

    // Per-call override agent id wins over the env default. Useful for
    // per-tenant agents once we onboard more customers.
    const overrideAgentId = params.agentId ?? this.agentId!;

    // Retell expects dynamic variables as a flat string map. Coerce here so
    // the script renderer can still pass numbers / objects upstream without
    // worrying about JSON serialization at the wire.
    const dynamicVariables: Record<string, string> = {};
    for (const [k, v] of Object.entries(params.scriptVariables)) {
      dynamicVariables[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    // Always include the rendered body so the agent has the full script
    // text available even if the prompt template references individual vars.
    dynamicVariables.script_body = params.scriptBody || dynamicVariables.body;
    dynamicVariables.script_template = params.scriptTemplate;
    dynamicVariables.tenant_id = params.tenantId;
    dynamicVariables.ustow_call_id = params.callId;
    if (params.toName) {
      dynamicVariables.customer_name = params.toName;
      // Backward compatibility for older Retell prompts / voicemail fallback
      // text that referenced {{user_name}} instead of {{customer_name}}.
      dynamicVariables.user_name = params.toName;
    }

    const tenantTestModeEnabled = params.testModeEnabled === true;
    const tenantTestNumber = params.testOverrideNumber?.trim();
    const globalTestModeEnabled = process.env.OUTBOUND_TEST_MODE_ENABLED === 'true';
    const globalTestNumber = process.env.RETELL_TEST_OVERRIDE_NUMBER?.trim();
    let finalToNumber = params.toPhone;

    if (tenantTestModeEnabled) {
      if (!tenantTestNumber) {
        this.logger.warn(
          `[outbound-voice] tenant test mode enabled but no test_override_number set; refusing call ${params.callId} (tenant ${params.tenantId})`,
        );
        return null;
      }
      this.logger.warn(`[outbound-voice] tenant test override active: redirecting call from ${params.toPhone} to ${tenantTestNumber}`);
      finalToNumber = tenantTestNumber;
    } else if (globalTestModeEnabled && globalTestNumber) {
      this.logger.warn(`[outbound-voice] global test override active: redirecting call from ${params.toPhone} to ${globalTestNumber}`);
      finalToNumber = globalTestNumber;
    }

    // Ensure the phone number is strictly E.164 formatted for Retell, otherwise it rejects with 400
    if (finalToNumber) {
      const digits = finalToNumber.replace(/\D/g, '');
      if (digits.length === 10) {
        finalToNumber = `+1${digits}`;
      } else if (digits.length === 11 && digits.startsWith('1')) {
        finalToNumber = `+${digits}`;
      } else if (!finalToNumber.startsWith('+')) {
        finalToNumber = `+${digits}`;
      }
    }

    const body = {
      from_number: this.fromNumber!,
      to_number: finalToNumber,
      override_agent_id: overrideAgentId,
      // Omitted when unpinned, which preserves the pre-existing behaviour
      // (latest draft) rather than silently moving production to a different
      // version the moment this ships.
      ...(this.agentVersion
        ? {
            override_agent_version: /^\d+$/.test(this.agentVersion)
              ? Number(this.agentVersion)
              : this.agentVersion,
          }
        : {}),
      retell_llm_dynamic_variables: dynamicVariables,
      metadata: {
        tenant_id: params.tenantId,
        ustow_call_id: params.callId,
        script_template: params.scriptTemplate,
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
          `[outbound-voice] Retell returned ${res.status} for call ${params.callId}: ${text.slice(0, 400)}`,
        );
        return null;
      }
      const json = (await res.json().catch(() => ({}))) as {
        call_id?: string;
      };
      const retellCallId = json.call_id;
      if (!retellCallId) {
        this.logger.warn(
          `[outbound-voice] Retell response missing call_id for ${params.callId}`,
        );
        return null;
      }
      return { providerCallId: retellCallId };
    } catch (err) {
      this.logger.warn(
        `[outbound-voice] Retell placeCall threw for ${params.callId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  async cancelCall(retellCallId: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const res = await fetch(`${this.baseUrl}/v2/end-call`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ call_id: retellCallId }),
      });
      return res.ok;
    } catch (err) {
      this.logger.warn(
        `[outbound-voice] Retell cancelCall threw for ${retellCallId}: ${(err as Error).message}`,
      );
      return false;
    }
  }
}
