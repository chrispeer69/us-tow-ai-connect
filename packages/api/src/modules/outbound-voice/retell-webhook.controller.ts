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
import { extractRetellAnalysis, mapRetellStatus } from './retell-call-mapping';

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
 *   Retell signs with HMAC-SHA256 over the exact raw request bytes plus a
 *   timestamp and sends it as x-retell-signature: v={timestamp},d={hex_digest}.
 *   Some older/test paths used a bare digest, so verification keeps legacy
 *   digest support. Production must set RETELL_API_KEY or RETELL_WEBHOOK_SECRET;
 *   verification is skipped only when both are unset.
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

    const analysis = body.call?.call_analysis || {};
    const custom = (analysis as any).custom_analysis_data || {};

    this.logger.log({
      message: '[outbound-voice] Retell webhook received',
      event: body.event,
      callId,
      analysisKeys: Object.keys(analysis),
      customKeys: Object.keys(custom),
      rawFlipOutcome: analysis.flip_outcome ?? custom.flip_outcome ?? null,
      rawOffer1: analysis.offer_1_result ?? custom.offer_1_result ?? null,
    });

    // Shared with the reconciliation sweep, which pulls this same object from
    // GET /v2/get-call. See retell-call-mapping.ts.
    const analysisData = extractRetellAnalysis(analysis as Record<string, unknown>);

    const result = await this.outboundVoice.handleProviderWebhookEvent({
      provider: 'retell',
      callId,
      status: mapRetellStatus({
        event: body.event,
        call_status: body.call?.call_status,
        disconnection_reason: body.call?.disconnection_reason,
      }),
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
  const structuredSignature = parseRetellStructuredSignature(signature);
  const candidates = normalizeSignatureHeader(signature);
  if (!structuredSignature && candidates.length === 0) return false;

  for (const secret of secrets) {
    for (const payload of payloads) {
      if (structuredSignature && verifyStructuredRetellSignature(structuredSignature, secret, payload)) {
        return true;
      }

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

function verifyStructuredRetellSignature(
  signature: RetellStructuredSignature,
  secret: RetellVerificationSecret,
  payload: RetellSignaturePayload,
): boolean {
  if (Math.abs(Date.now() - signature.timestampMs) > RETELL_SIGNATURE_TOLERANCE_MS) {
    return false;
  }

  const expectedHex = crypto
    .createHmac('sha256', secret.value)
    .update(payload.bytes)
    .update(signature.timestamp, 'utf8')
    .digest('hex');

  return timingSafeEqual(signature.digest, expectedHex);
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
      if (/^[vd]=/i.test(withoutPrefix)) return [];
      return withoutPrefix === part ? [part] : [withoutPrefix];
    });
}

function parseRetellStructuredSignature(signature: string | undefined): RetellStructuredSignature | null {
  if (!signature) return null;

  const parts = Object.fromEntries(
    signature
      .split(',')
      .map((part) => part.trim().split('='))
      .filter((entry): entry is [string, string] => entry.length === 2 && Boolean(entry[0]) && Boolean(entry[1]))
      .map(([key, value]) => [key.toLowerCase(), value]),
  );
  const timestamp = parts.v;
  const digest = parts.d;
  if (!timestamp || !digest || !/^\d+$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(digest)) {
    return null;
  }

  const timestampMs = Number(timestamp);
  if (!Number.isSafeInteger(timestampMs)) return null;

  return {
    timestamp,
    timestampMs,
    digest: digest.toLowerCase(),
  };
}

const RETELL_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

interface RetellVerificationSecret {
  label: 'RETELL_WEBHOOK_SECRET' | 'RETELL_API_KEY';
  value: string;
}

interface RetellSignaturePayload {
  label: 'rawBody' | 'jsonBody';
  bytes: Buffer;
}

interface RetellStructuredSignature {
  timestamp: string;
  timestampMs: number;
  digest: string;
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
