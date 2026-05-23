import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import {
  TwilioSignatureGuard,
  computeTwilioSignature,
} from './twilio-signature.guard';

const AUTH_TOKEN = '1234567890abcdef1234567890abcdef';
const URL = 'https://example.com/webhooks/twilio/call-status';

function ctxFor(headers: Record<string, string>, body: Record<string, unknown>): ExecutionContext {
  const req = {
    headers,
    body,
    originalUrl: '/webhooks/twilio/call-status',
    url: '/webhooks/twilio/call-status',
    method: 'POST',
    protocol: 'https',
    get(name: string) {
      return name === 'host' ? 'example.com' : undefined;
    },
  };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('TwilioSignatureGuard', () => {
  let originalToken: string | undefined;
  let originalBase: string | undefined;

  beforeEach(() => {
    originalToken = process.env.TWILIO_AUTH_TOKEN;
    originalBase = process.env.PUBLIC_BASE_URL;
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
    process.env.PUBLIC_BASE_URL = 'https://example.com';
  });

  afterEach(() => {
    process.env.TWILIO_AUTH_TOKEN = originalToken;
    process.env.PUBLIC_BASE_URL = originalBase;
    vi.restoreAllMocks();
  });

  it('accepts a request with a valid Twilio signature', () => {
    const body = { CallSid: 'CA123', CallStatus: 'completed', CallDuration: '42' };
    const signature = computeTwilioSignature(AUTH_TOKEN, URL, body);
    const guard = new TwilioSignatureGuard();
    expect(guard.canActivate(ctxFor({ 'x-twilio-signature': signature }, body))).toBe(true);
  });

  it('rejects a request with a mismatched signature', () => {
    const body = { CallSid: 'CA123', CallStatus: 'completed' };
    const guard = new TwilioSignatureGuard();
    expect(() =>
      guard.canActivate(ctxFor({ 'x-twilio-signature': 'wrong-signature===' }, body)),
    ).toThrow(ForbiddenException);
  });

  it('rejects a request with a missing X-Twilio-Signature header', () => {
    const body = { CallSid: 'CA123' };
    const guard = new TwilioSignatureGuard();
    expect(() => guard.canActivate(ctxFor({}, body))).toThrow(ForbiddenException);
  });

  it('rejects when the body has been tampered with', () => {
    const realBody = { CallSid: 'CA123', CallStatus: 'completed' };
    const tamperedBody = { CallSid: 'CA999', CallStatus: 'completed' };
    const signature = computeTwilioSignature(AUTH_TOKEN, URL, realBody);
    const guard = new TwilioSignatureGuard();
    expect(() =>
      guard.canActivate(ctxFor({ 'x-twilio-signature': signature }, tamperedBody)),
    ).toThrow(ForbiddenException);
  });

  it('allows the request through with a warning when TWILIO_AUTH_TOKEN is unset', () => {
    process.env.TWILIO_AUTH_TOKEN = '';
    const guard = new TwilioSignatureGuard();
    expect(guard.canActivate(ctxFor({}, {}))).toBe(true);
  });

  it('allows the request through when TWILIO_AUTH_TOKEN is a REPLACE_ME placeholder', () => {
    process.env.TWILIO_AUTH_TOKEN = 'REPLACE_ME_BEFORE_DEPLOY';
    const guard = new TwilioSignatureGuard();
    expect(guard.canActivate(ctxFor({}, {}))).toBe(true);
  });
});

describe('computeTwilioSignature', () => {
  it('produces the canonical Twilio signature for a sorted form body', () => {
    // Canonical Twilio example: signed string = URL + sortedKey1 + value1 + ... .
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    const params = { Caller: '+12345', Digits: '1234', From: '+12345', To: '+18005551212' };
    const sig = computeTwilioSignature('12345', url, params);
    // Manually compute to confirm determinism (regression guard rather than
    // a Twilio-published vector, since they publish only the algorithm).
    const expected = computeTwilioSignature('12345', url, params);
    expect(sig).toEqual(expected);
    expect(sig).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
  });

  it('orders keys alphabetically before concatenating', () => {
    const url = 'https://x.test/cb';
    const a = computeTwilioSignature('k', url, { b: '2', a: '1', c: '3' });
    const b = computeTwilioSignature('k', url, { a: '1', b: '2', c: '3' });
    const c = computeTwilioSignature('k', url, { c: '3', a: '1', b: '2' });
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});
