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
import type { Request } from 'express';
import { OutboundVoiceService } from './outbound-voice.service';
import { extractRetellAnalysis, mapRetellStatus } from './retell-call-mapping';
import {
  buildSignaturePayloads,
  retellSecretsFromEnv,
  verifyRetellSignature,
  type RetellVerificationSecret,
} from '../../common/utils/retell-signature';

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
    this.verificationSecrets = retellSecretsFromEnv();

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
        duration_seconds:
          body.call.duration_ms != null ? Math.round(body.call.duration_ms / 1000) : null,
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

// Signature verification now lives in common/utils/retell-signature.ts — the
// campaign webhook (Session 78) needs the identical check, and two copies of it
// is how one of them quietly stops matching the provider format.

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
