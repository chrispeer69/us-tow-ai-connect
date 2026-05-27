import { Injectable, Logger } from '@nestjs/common';

/**
 * Session 49 — Thinkrr outbound HTTP wrapper.
 *
 * Reads `THINKRR_OUTBOUND_API_URL` and `THINKRR_API_KEY` at construction.
 * Returns `null` and logs a warning on every call when either is missing
 * (dev / test / staging without keys). Never throws — the
 * OutboundVoiceService is responsible for marking the call row `failed`
 * when the client returns null.
 *
 * The Thinkrr API contract is approximated from the public docs at
 * https://docs.thinkrr.ai/Outbound (POST /v1/outbound/call). When G$D
 * publishes the production endpoint and request shape, swap the path /
 * payload here and the rest of the module is untouched.
 */
@Injectable()
export class ThinkrrOutboundClient {readonly providerName = 'thinkrr' as const;
  private readonly logger = new Logger(ThinkrrOutboundClient.name);
  private readonly apiUrl: string | null;
  private readonly apiKey: string | null;
  private readonly fromNumber: string;

  constructor() {
    const url = process.env.THINKRR_OUTBOUND_API_URL?.trim() ?? '';
    const key = process.env.THINKRR_API_KEY?.trim() ?? '';
    this.apiUrl = url || null;
    this.apiKey = key || null;
    this.fromNumber = process.env.THINKRR_OUTBOUND_FROM_NUMBER?.trim()
      || process.env.TWILIO_PHONE_NUMBER?.trim()
      || '+18783563281'; // Production outbound number per S49 spec.
    if (!this.apiUrl || !this.apiKey) {
      this.logger.warn(
        'THINKRR_OUTBOUND_API_URL/THINKRR_API_KEY not configured — outbound voice calls will be logged-only',
      );
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiUrl && this.apiKey);
  }

  /**
   * Place an outbound voice call. Returns the Thinkrr-side call id on
   * success, `null` on configuration / network / API failure. Never
   * throws.
   */
  async placeCall(params: {
    toPhone: string;
    toName?: string | null;
    scriptBody: string;
    scriptTemplate: string;
    scriptVariables: Record<string, unknown>;
    callId: string;
    tenantId: string;
    agentId?: string | null;
    callbackUrl?: string;
  }): Promise<{ thinkrrCallId: string } | null> {
    if (!this.isConfigured()) {
      this.logger.warn(
        `[outbound-voice] Thinkrr unconfigured — skipping placeCall for ${params.callId} (tenant ${params.tenantId})`,
      );
      return null;
    }

    const body = {
      from: this.fromNumber,
      to: params.toPhone,
      to_name: params.toName ?? undefined,
      agent_id: params.agentId ?? undefined,
      script_template: params.scriptTemplate,
      script_body: params.scriptBody,
      variables: params.scriptVariables,
      callback_url: params.callbackUrl,
      external_id: params.callId,
      metadata: {
        tenant_id: params.tenantId,
        ustow_call_id: params.callId,
      },
    };

    try {
      const res = await fetch(`${this.apiUrl}/v1/outbound/call`, {
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
          `[outbound-voice] Thinkrr returned ${res.status} for call ${params.callId}: ${text.slice(0, 400)}`,
        );
        return null;
      }
      const json = (await res.json().catch(() => ({}))) as {
        call_id?: string;
        id?: string;
      };
      const thinkrrCallId = json.call_id ?? json.id;
      if (!thinkrrCallId) {
        this.logger.warn(
          `[outbound-voice] Thinkrr response missing call_id for ${params.callId}`,
        );
        return null;
      }
      return { thinkrrCallId };
    } catch (err) {
      this.logger.warn(
        `[outbound-voice] Thinkrr placeCall threw for ${params.callId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Best-effort cancel. Returns true on confirmed cancel, false on any
   * other path (including "already completed").
   */
  async cancelCall(thinkrrCallId: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const res = await fetch(
        `${this.apiUrl}/v1/outbound/call/${encodeURIComponent(thinkrrCallId)}/cancel`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.apiKey}`,
          },
        },
      );
      return res.ok;
    } catch (err) {
      this.logger.warn(
        `[outbound-voice] Thinkrr cancelCall threw for ${thinkrrCallId}: ${(err as Error).message}`,
      );
      return false;
    }
  }
}
