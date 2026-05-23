import { Injectable, Logger } from '@nestjs/common';

/**
 * Verifies a Cloudflare Turnstile / hCaptcha token against the
 * provider's siteverify endpoint. Both providers expose the same
 * POST shape (`secret`, `response`, optional `remoteip`), so a single
 * fetch handles either.
 *
 * Behaviour:
 *   - When SIGNUP_CAPTCHA_KEY is unset → always returns ok (the
 *     onboarding controller still rate-limits by IP). Logged at debug.
 *   - When set + no token → returns failure with a clear reason.
 *   - When set + token present → POSTs to the provider's verify URL
 *     and trusts the `success` field.
 */
@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);

  private get secret(): string | undefined {
    return process.env.SIGNUP_CAPTCHA_KEY;
  }

  private get verifyUrl(): string {
    return (
      process.env.SIGNUP_CAPTCHA_VERIFY_URL ||
      'https://challenges.cloudflare.com/turnstile/v0/siteverify'
    );
  }

  isEnabled(): boolean {
    return !!this.secret;
  }

  async verify(token: string | undefined, clientIp?: string): Promise<{ ok: boolean; reason?: string }> {
    if (!this.secret) return { ok: true };
    if (!token) return { ok: false, reason: 'CAPTCHA token missing' };
    try {
      const params = new URLSearchParams();
      params.set('secret', this.secret);
      params.set('response', token);
      if (clientIp) params.set('remoteip', clientIp);
      const res = await fetch(this.verifyUrl, {
        method: 'POST',
        body: params,
      });
      const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
      if (!data.success) {
        return {
          ok: false,
          reason: `CAPTCHA verification failed: ${(data['error-codes'] ?? ['unknown']).join(',')}`,
        };
      }
      return { ok: true };
    } catch (err) {
      this.logger.warn(`[captcha] verify request failed: ${(err as Error).message}`);
      return { ok: false, reason: 'CAPTCHA provider unreachable' };
    }
  }
}
