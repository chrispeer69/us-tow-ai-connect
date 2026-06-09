import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetellWebhookController } from './retell-webhook.controller';
import type { OutboundVoiceService } from './outbound-voice.service';

const WEBHOOK_SECRET = 'whsec_test_123';
const API_KEY = 'key_test_abc123XYZ';

describe('RetellWebhookController', () => {
  const previousEnv = {
    RETELL_WEBHOOK_SECRET: process.env.RETELL_WEBHOOK_SECRET,
    RETELL_API_KEY: process.env.RETELL_API_KEY,
  };

  let outboundVoice: Pick<OutboundVoiceService, 'handleProviderWebhookEvent'>;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.RETELL_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.RETELL_API_KEY = API_KEY;
    outboundVoice = {
      handleProviderWebhookEvent: vi.fn().mockResolvedValue({ matched: true }),
    };
  });

  afterEach(() => {
    process.env.RETELL_WEBHOOK_SECRET = previousEnv.RETELL_WEBHOOK_SECRET;
    process.env.RETELL_API_KEY = previousEnv.RETELL_API_KEY;
  });

  it('accepts a correctly signed raw payload', async () => {
    const controller = new RetellWebhookController(outboundVoice as OutboundVoiceService);
    const rawBody = Buffer.from('{"call":{"call_id":"call_123","call_status":"ended"},"event":"call_ended"}');
    const body = {
      event: 'call_ended',
      call: { call_id: 'call_123', call_status: 'ended' },
    } as const;

    const result = await controller.handleEvent(
      requestWithRawBody(rawBody),
      hmacHex(WEBHOOK_SECRET, rawBody),
      body,
    );

    expect(result).toEqual({ matched: true });
    expect(outboundVoice.handleProviderWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'retell',
        callId: 'call_123',
        status: 'completed',
      }),
    );
  });

  it('accepts a base64 signature with a sha256 prefix', async () => {
    const controller = new RetellWebhookController(outboundVoice as OutboundVoiceService);
    const rawBody = Buffer.from(JSON.stringify(sampleBody));
    const signature = `sha256=${hmacBase64(WEBHOOK_SECRET, rawBody)}`;

    await expect(
      controller.handleEvent(requestWithRawBody(rawBody), signature, sampleBody),
    ).resolves.toEqual({ matched: true });
  });

  it('falls back to JSON body verification when rawBody is unavailable', async () => {
    const controller = new RetellWebhookController(outboundVoice as OutboundVoiceService);
    const payload = Buffer.from(JSON.stringify(sampleBody));

    await expect(
      controller.handleEvent({} as Request, hmacHex(WEBHOOK_SECRET, payload), sampleBody),
    ).resolves.toEqual({ matched: true });
  });

  it('accepts signatures generated with RETELL_API_KEY when both keys are configured', async () => {
    const controller = new RetellWebhookController(outboundVoice as OutboundVoiceService);
    const rawBody = Buffer.from(JSON.stringify(sampleBody));

    await expect(
      controller.handleEvent(requestWithRawBody(rawBody), hmacHex(API_KEY, rawBody), sampleBody),
    ).resolves.toEqual({ matched: true });
  });

  it('rejects a tampered raw payload', async () => {
    const controller = new RetellWebhookController(outboundVoice as OutboundVoiceService);
    const originalRawBody = Buffer.from(JSON.stringify(sampleBody));
    const tamperedRawBody = Buffer.from(JSON.stringify({ ...sampleBody, event: 'call_started' }));

    await expect(
      controller.handleEvent(
        requestWithRawBody(tamperedRawBody),
        hmacHex(WEBHOOK_SECRET, originalRawBody),
        sampleBody,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a missing signature when verification is configured', async () => {
    const controller = new RetellWebhookController(outboundVoice as OutboundVoiceService);

    await expect(
      controller.handleEvent(requestWithRawBody(Buffer.from(JSON.stringify(sampleBody))), undefined, sampleBody),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('skips signature verification only when no Retell verification key is configured', async () => {
    delete process.env.RETELL_WEBHOOK_SECRET;
    delete process.env.RETELL_API_KEY;
    const controller = new RetellWebhookController(outboundVoice as OutboundVoiceService);

    await expect(
      controller.handleEvent({} as Request, undefined, sampleBody),
    ).resolves.toEqual({ matched: true });
  });
});

const sampleBody = {
  event: 'call_ended',
  call: {
    call_id: 'call_123',
    call_status: 'ended',
    disconnection_reason: 'user_hangup',
    duration_ms: 11_500,
    transcript: 'hello',
    recording_url: 'https://example.com/recording.mp3',
    end_timestamp: Date.parse('2026-06-09T00:00:00.000Z'),
  },
} as const;

function requestWithRawBody(rawBody: Buffer): Request {
  return { rawBody } as unknown as Request;
}

function hmacHex(secret: string, payload: Buffer): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function hmacBase64(secret: string, payload: Buffer): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64');
}
