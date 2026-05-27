import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { OutboundVoiceService } from './outbound-voice.service';

/**
 * Session 49 — Thinkrr outbound result webhook.
 *
 * Public endpoint (no AdminAuthGuard). Verified via the
 * `THINKRR_WEBHOOK_SECRET` env var passed in the `x-thinkrr-secret`
 * header. If the secret is unset, all requests are rejected with 401
 * (fail-closed) — operators must configure the secret before Thinkrr
 * starts posting.
 *
 * Idempotent on `thinkrr_call_id`. The same event can be redelivered
 * by Thinkrr (network jitter, retries) without double-processing.
 */
@Controller('webhooks/thinkrr')
export class OutboundVoiceWebhookController {
  constructor(private readonly service: OutboundVoiceService) {}

  @Post('outbound-result')
  @HttpCode(200)
  async outboundResult(
    @Headers('x-thinkrr-secret') headerSecret: string | undefined,
    @Body() body: ThinkrrOutboundEvent,
  ) {
    const expected = (process.env.THINKRR_WEBHOOK_SECRET ?? '').trim();
    if (!expected) {
      throw new UnauthorizedException({
        status: 'error',
        code: 'WEBHOOK_SECRET_UNCONFIGURED',
        message: 'THINKRR_WEBHOOK_SECRET is not set on this deployment',
      });
    }
    if (!headerSecret || headerSecret.trim() !== expected) {
      throw new UnauthorizedException({
        status: 'error',
        code: 'WEBHOOK_SECRET_MISMATCH',
        message: 'thinkrr webhook secret mismatch',
      });
    }
    if (!body || typeof body !== 'object') {
      throw new BadRequestException({
        status: 'error',
        code: 'INVALID_BODY',
        message: 'webhook body must be a JSON object',
      });
    }
    const callId = (body.call_id ?? body.id ?? '').toString().trim();
    const status = (body.status ?? '').toString().trim();
    if (!callId || !status) {
      throw new BadRequestException({
        status: 'error',
        code: 'INVALID_BODY',
        message: 'webhook body must include call_id and status',
      });
    }

    const result = await this.service.handleWebhookEvent({
      callId,
      status,
      durationSeconds:
        typeof body.duration_seconds === 'number'
          ? body.duration_seconds
          : null,
      transcript: typeof body.transcript === 'string' ? body.transcript : null,
      recordingUrl: typeof body.recording_url === 'string' ? body.recording_url : null,
      outcome:
        body.outcome && typeof body.outcome === 'object' && !Array.isArray(body.outcome)
          ? (body.outcome as Record<string, unknown>)
          : null,
      error: typeof body.error === 'string' ? body.error : null,
      timestampIso: typeof body.timestamp === 'string' ? body.timestamp : null,
    });

    return {
      status: 'success',
      data: {
        matched: result.matched,
        previous_status: result.previousStatus,
        new_status: result.newStatus,
      },
    };
  }
}

interface ThinkrrOutboundEvent {
  call_id?: string;
  id?: string;
  status?: string;
  duration_seconds?: number;
  transcript?: string;
  recording_url?: string;
  outcome?: Record<string, unknown>;
  error?: string;
  timestamp?: string;
}
