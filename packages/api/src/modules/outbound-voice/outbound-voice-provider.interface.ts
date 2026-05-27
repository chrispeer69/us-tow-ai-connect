/**
 * Session 68 — Outbound voice provider abstraction.
 *
 * Both `RetellOutboundClient` and `ThinkrrOutboundClient` implement this
 * interface. The OutboundVoiceService picks one at dispatch time via the
 * OUTBOUND_VOICE_PROVIDER env var (default "retell" when RETELL_API_KEY
 * is set, else "thinkrr").
 *
 * Returning `null` from any method means "skip / log-only" — never throws.
 * The service is responsible for marking the call row `failed` when the
 * client returns null.
 */
export interface OutboundVoiceProvider {
  /** Provider tag stored on outbound_calls.provider for traceability. */
  readonly providerName: 'retell' | 'thinkrr';

  /** True when the client has all credentials it needs. */
  isConfigured(): boolean;

  /** Place an outbound voice call. */
  placeCall(params: PlaceCallParams): Promise<PlaceCallResult | null>;

  /** Best-effort cancel. */
  cancelCall(providerCallId: string): Promise<boolean>;
}

export interface PlaceCallParams {
  toPhone: string;
  toName?: string | null;
  scriptBody: string;
  scriptTemplate: string;
  scriptVariables: Record<string, unknown>;
  callId: string;
  tenantId: string;
  agentId?: string | null;
  callbackUrl?: string;
}

export interface PlaceCallResult {
  /** The provider-side call id. Stored on outbound_calls.retell_call_id or thinkrr_call_id. */
  providerCallId: string;
}
