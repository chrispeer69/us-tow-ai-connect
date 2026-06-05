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

  constructor() {
    const key = process.env.RETELL_API_KEY?.trim() ?? '';
    const agentId = process.env.RETELL_AGENT_ID?.trim() ?? '';
    const fromNumber = process.env.RETELL_FROM_NUMBER?.trim() ?? '';
    this.apiKey = key || null;
    this.agentId = agentId || null;
    this.fromNumber = fromNumber || null;
    this.baseUrl = (process.env.RETELL_API_BASE_URL?.trim() || 'https://api.retellai.com').replace(/\/$/, '');

    if (!this.isConfigured()) {
      this.logger.warn(
        'RETELL_API_KEY / RETELL_AGENT_ID / RETELL_FROM_NUMBER not fully configured — outbound voice calls will be logged-only',
      );
    }
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
    if (params.toName) dynamicVariables.customer_name = params.toName;

    const testModeEnabled = process.env.OUTBOUND_TEST_MODE_ENABLED === 'true';
    const testNumber = process.env.RETELL_TEST_OVERRIDE_NUMBER?.trim();
    let finalToNumber = params.toPhone;

    if (testModeEnabled && testNumber) {
      this.logger.warn(`[outbound-voice] ⚠️ TEST OVERRIDE ACTIVE: Redirecting call from ${params.toPhone} to ${testNumber}`);
      finalToNumber = testNumber;
    }

    const body = {
      from_number: this.fromNumber!,
      to_number: finalToNumber,
      override_agent_id: overrideAgentId,
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
