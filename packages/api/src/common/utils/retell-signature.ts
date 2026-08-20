import * as crypto from 'crypto';
import type { Request } from 'express';

/**
 * Retell webhook signature verification.
 *
 * Extracted from `outbound-voice/retell-webhook.controller.ts` in Session 78,
 * when the outreach campaign added a SECOND Retell webhook endpoint. Two
 * copies of signature-checking code is how one of them quietly stops matching
 * the provider's format — this is the only implementation.
 *
 * Format (https://docs.retellai.com/features/webhook): Retell signs with
 * HMAC-SHA256 over the exact raw request bytes plus a timestamp, and sends
 *   x-retell-signature: v={timestamp},d={hex_digest}
 * Some older/test paths send a bare digest, so legacy digest support stays.
 */

export const RETELL_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

export interface RetellVerificationSecret {
  label: 'RETELL_WEBHOOK_SECRET' | 'RETELL_API_KEY';
  value: string;
}

export interface RetellSignaturePayload {
  label: 'rawBody' | 'jsonBody';
  bytes: Buffer;
}

interface RetellStructuredSignature {
  timestamp: string;
  timestampMs: number;
  digest: string;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns true only when a === b (same length + same bytes).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function verifyRetellSignature(
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

/**
 * The bytes to sign over.
 *
 * `req.rawBody` is authoritative when present — re-serializing parsed JSON can
 * reorder keys or change whitespace, and the digest is over exact bytes. The
 * JSON fallback exists for environments and tests that do not expose rawBody.
 */
export function buildSignaturePayloads(req: Request, body: unknown): RetellSignaturePayload[] {
  const rawBody = (req as Request & { rawBody?: unknown }).rawBody;
  if (Buffer.isBuffer(rawBody)) {
    return [{ label: 'rawBody', bytes: rawBody }];
  }
  return [{ label: 'jsonBody', bytes: Buffer.from(JSON.stringify(body), 'utf8') }];
}

export function normalizeSignatureHeader(signature: string | undefined): string[] {
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

export function parseRetellStructuredSignature(
  signature: string | undefined,
): RetellStructuredSignature | null {
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

  return { timestamp, timestampMs, digest: digest.toLowerCase() };
}

/**
 * Build the secret list from the environment, newest-preferred first.
 *
 * Returns an empty array when neither is set, which the callers treat as
 * "verification disabled" — and log loudly about, because a webhook that
 * accepts anything is a webhook anyone can post to.
 */
export function retellSecretsFromEnv(): RetellVerificationSecret[] {
  const webhookSecret = process.env.RETELL_WEBHOOK_SECRET?.trim() ?? '';
  const apiKey = process.env.RETELL_API_KEY?.trim() ?? '';

  return [
    webhookSecret ? ({ label: 'RETELL_WEBHOOK_SECRET', value: webhookSecret } as const) : null,
    apiKey && apiKey !== webhookSecret ? ({ label: 'RETELL_API_KEY', value: apiKey } as const) : null,
  ].filter((s): s is RetellVerificationSecret => Boolean(s));
}
