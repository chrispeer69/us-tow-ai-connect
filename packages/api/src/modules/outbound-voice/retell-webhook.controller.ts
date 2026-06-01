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
 *   Retell signs with your account API key (RETELL_API_KEY) — NOT a separate
 *   webhook secret — using HMAC-SHA256 over the EXACT raw request bytes,
 *   delivering the hex digest in the x-retell-signature header.
 *
 *   We verify by computing HMAC-SHA256 over req.rawBody (the unmodified bytes
 *   NestJS captures because main.ts enables rawBody: true) using RETELL_API_KEY
 *   as the key, then doing a timing-safe comparison against the header value.
 *
 *   If RETELL_API_KEY is unset (dev / CI), signature verification is SKIPPED —
 *   production must set it.
 */
@Controller('webhooks/retell')
  export class RetellWebhookController {
    private readonly logger = new Logger(RetellWebhookController.name);
    private readonly apiKey: string | null;

  constructor(private readonly outboundVoice: OutboundVoiceService) {
        const key = process.env.RETELL_API_KEY?.trim() ?? '';
        this.apiKey = key || null;
        if (!this.apiKey) {
                this.logger.warn(
                          'RETELL_API_KEY unset — Retell webhook signature verification is DISABLED',
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
          if (this.apiKey) {
                  // req.rawBody is a Buffer set by NestJS when rawBody: true is passed to
            // NestFactory.create().  We MUST hash the exact bytes Retell signed —
            // re-serialising the parsed object (JSON.stringify) reorders/reformats
            // keys and the HMAC will never match.
            const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
                  if (!rawBody || rawBody.length === 0) {
                            this.logger.warn('[outbound-voice] rawBody unavailable — rejecting');
                            throw new BadRequestException('raw body unavailable');
                  }

            const expected = crypto
                    .createHmac('sha256', this.apiKey)
                    .update(rawBody)
                    .digest('hex');

            if (!signature || !timingSafeEqual(signature, expected)) {
                      this.logger.warn(`[outbound-voice] Retell webhook signature mismatch. signature=${signature}, expected=${expected}, rawBody=${rawBody.toString('utf8')}, apiKey=${this.apiKey}`);
                      throw new UnauthorizedException('invalid signature');
            }
          }

      const callId = body?.call?.call_id;
          if (!callId) {
                  this.logger.warn('[outbound-voice] Retell webhook missing call.call_id');
                  return { matched: false };
          }

      const result = await this.outboundVoice.handleProviderWebhookEvent({
              provider: 'retell',
              callId,
              status: mapRetellStatus(body),
              durationSeconds: body.call.duration_ms != null
                ? Math.round(body.call.duration_ms / 1000)
                        : null,
              transcript: body.call.transcript ?? null,
              recordingUrl: body.call.recording_url ?? null,
              outcome: body.call.call_analysis
                ? (body.call.call_analysis as Record<string, unknown>)
                        : null,
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
      call_analysis?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    };
}
