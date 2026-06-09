import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import type { Request } from 'express';
import { OutboundVoiceService } from './outbound-voice.service';

/**
 * Session 68 — Retell outbound webhook receiver.
 *
 * Retell posts call lifecycle events to /webhooks/retell/outbound-result.
 * Event shape (per https://docs.retellai.com/features/webhook):
 * {
 *   event: 'call_started' | 'call_ended' | 'call_analyzed',
 *   call: {
 *     call_id: string,
 *     call_status: 'ongoing' | 'ended' | 'error' | 'registered',
 *     disconnection_reason?: string,
 *     duration_ms?: number,
 *     transcript?: string,
 *     recording_url?: string,
 *     start_timestamp?: number,
 *     end_timestamp?: number,
 *     call_analysis?: { call_summary?: string; user_sentiment?: string; ... },
 *     metadata?: { tenant_id?: string; ustow_call_id?: string },
 *   }
 * }
 *
 * Signature verification (per https://docs.retellai.com/features/webhook):
 *   Retell signs with HMAC-SHA256 over the exact raw request bytes and sends
 *   the digest in the x-retell-signature header. Some accounts are configured
 *   with a dedicated RETELL_WEBHOOK_SECRET while older setups use RETELL_API_KEY,
 *   so verification accepts either configured value. Production must set at
 *   least one of them; verification is skipped only when both are unset.
 */
@Controller('webhooks/retell')
export class RetellWebhookController {
  private readonly logger = new Logger(RetellWebhookController.name);
  private readonly verificationSecrets: RetellVerificationSecret[];

  constructor(private readonly outboundVoice: OutboundVoiceService) {
    const webhookSecret = process.env.RETELL_WEBHOOK_SECRET?.trim() ?? '';
    const apiKey = process.env.RETELL_API_KEY?.trim() ?? '';

    this.verificationSecrets = [
      webhookSecret ? { label: 'RETELL_WEBHOOK_SECRET', value: webhookSecret } : null,
      apiKey && apiKey !== webhookSecret ? { label: 'RETELL_API_KEY', value: apiKey } : null,
    ].filter((secret): secret is RetellVerificationSecret => Boolean(secret));

    if (this.verificationSecrets.length === 0) {
      this.logger.warn(
        'RETELL_WEBHOOK_SECRET and RETELL_API_KEY unset — Retell webhook signature verification is DISABLED',
      );
    }
  }

  @Post('outbound-result')
  @HttpCode(200)
  async handleEvent(
    @Req() req: Request,
    @Headers('x-retell-signature') signature: string | undefined,
    @Body() body: RetellWebhookBody,
  ): Promise<{ matched: boolean }> {
    if (this.verificationSecrets.length > 0) {
      const payloads = buildSignaturePayloads(req, body);

      if (!verifyRetellSignature(signature, this.verificationSecrets, payloads)) {
        this.logger.warn({
          message: '[outbound-voice] Retell webhook signature mismatch',
          signaturePresent: Boolean(signature),
          signatureLength: signature?.length ?? 0,
          configuredSecretLabels: this.verificationSecrets.map((secret) => secret.label),
          payloadCandidates: payloads.map((payload) => ({
            label: payload.label,
            byteLength: payload.bytes.length,
          })),
        });
        throw new UnauthorizedException('invalid signature');
      }
    }

    const callId = body?.call?.call_id;
    if (!callId) {
      this.logger.warn('[outbound-voice] Retell webhook missing call.call_id');
      return { matched: false };
    }

    const analysis = body.call.call_analysis || {};

    const analysisData = {
      call_summary: analysis.call_summary as string | null,
      call_successful: analysis.call_successful as boolean | null,
      user_sentiment: analysis.user_sentiment as string | null,
      flip_eligible: analysis.flip_eligible as boolean | null,
      flip_outcome: analysis.flip_outcome as string | null,
      offer_1_result: analysis.offer_1_result as string | null,
      offer_2_result: analysis.offer_2_result as string | null,
      offer_3_result: analysis.offer_3_result as string | null,
      convini_link_sent: analysis.convini_link_sent as boolean | null,
      convini_sell_type: analysis.convini_sell_type as string | null,
      corrections_made: analysis.corrections_made as string | null,
      nearest_our_shop: analysis.nearest_our_shop as string | null,
      destination_type: analysis.destination_type as string | null,
    };

    const result = await this.outboundVoice.handleProviderWebhookEvent({
      provider: 'retell',
      callId,
      status: mapRetellStatus(body),
      durationSeconds: body.call.duration_ms != null
        ? Math.round(body.call.duration_ms / 1000)
        : null,
      transcript: body.call.transcript ?? null,
      recordingUrl: body.call.recording_url ?? null,
      analysisData,
      error: body.call.disconnection_reason ?? null,
      timestampIso: body.call.end_timestamp
        ? new Date(body.call.end_timestamp).toISOString()
        : body.call.start_timestamp
          ? new Date(body.call.start_timestamp).toISOString()
          : null,
    });
    return { matched: result.matched };
  }
}

/** Retell event → ThinkrrStatus-equivalent string (mapThinkrrStatus handles it). */
function mapRetellStatus(body: RetellWebhookBody): string {
  const event = body.event;
  const callStatus = body.call?.call_status;
  // Retell `call_started` => in_progress in our schema
  if (event === 'call_started') return 'in_progress';
  // call_ended / call_analyzed — read disconnection_reason for the terminal mapping
  if (event === 'call_ended' || event === 'call_analyzed') {
    const reason = body.call?.disconnection_reason?.toLowerCase();
    if (reason === 'user_hangup' || reason === 'agent_hangup' || reason === 'call_transfer') {
      return 'completed';
    }
    if (reason === 'voicemail') return 'no_answer';
    if (reason === 'dial_busy') return 'busy';
    if (reason === 'dial_no_answer') return 'no_answer';
    if (reason === 'dial_failed' || reason === 'error') return 'failed';
    if (callStatus === 'ended') return 'completed';
    if (callStatus === 'error') return 'failed';
  }
  if (callStatus === 'ongoing') return 'in_progress';
  if (callStatus === 'registered') return 'dialing';
  return 'failed';
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns true only when a === b (same length + same bytes).
 */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function verifyRetellSignature(
  signature: string | undefined,
  secrets: RetellVerificationSecret[],
  payloads: RetellSignaturePayload[],
): boolean {
  const candidates = normalizeSignatureHeader(signature);
  if (candidates.length === 0) return false;

  for (const secret of secrets) {
    for (const payload of payloads) {
      const expectedHex = crypto
        .createHmac('sha256', secret.value)
        .update(payload.bytes)
        .digest('hex');
      const expectedB64 = crypto
        .createHmac('sha256', secret.value)
        .update(payload.bytes)
        .digest('base64');

      if (
        candidates.some(
          (candidate) => timingSafeEqual(candidate, expectedHex) || timingSafeEqual(candidate, expectedB64),
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

function buildSignaturePayloads(req: Request, body: RetellWebhookBody): RetellSignaturePayload[] {
  const rawBody = (req as Request & { rawBody?: unknown }).rawBody;
  const payloads: RetellSignaturePayload[] = [];

  if (Buffer.isBuffer(rawBody)) {
    payloads.push({ label: 'rawBody', bytes: rawBody });
    return payloads;
  }

  // Backward compatibility for environments/tests that do not expose req.rawBody.
  payloads.push({ label: 'jsonBody', bytes: Buffer.from(JSON.stringify(body), 'utf8') });
  return payloads;
}

function normalizeSignatureHeader(signature: string | undefined): string[] {
  if (!signature) return [];

  return signature
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const withoutPrefix = part.replace(/^sha256=/i, '').trim();
      return withoutPrefix === part ? [part] : [withoutPrefix];
    });
}

interface RetellVerificationSecret {
  label: 'RETELL_WEBHOOK_SECRET' | 'RETELL_API_KEY';
  value: string;
}

interface RetellSignaturePayload {
  label: 'rawBody' | 'jsonBody';
  bytes: Buffer;
}

interface RetellWebhookBody {
  event: 'call_started' | 'call_ended' | 'call_analyzed';
  call: {
    call_id: string;
    call_status?: 'ongoing' | 'ended' | 'error' | 'registered';
    disconnection_reason?: string;
    duration_ms?: number;
    transcript?: string;
    recording_url?: string;
    start_timestamp?: number;
    end_timestamp?: number;
    call_analysis?: {
      call_summary?: string;
      call_successful?: boolean;
      user_sentiment?: string;
      flip_eligible?: boolean;
      flip_outcome?: string;
      offer_1_result?: string;
      offer_2_result?: string;
      offer_3_result?: string;
      convini_link_sent?: boolean;
      convini_sell_type?: string;
      corrections_made?: string;
      nearest_our_shop?: string;
      destination_type?: string;
      [key: string]: unknown;
    };
    metadata?: Record<string, unknown>;
  };
}
