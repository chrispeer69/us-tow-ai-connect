/**
 * Classify a thrown exception from an adapter login() into a coarse
 * category so operators can group failures in the admin UI without
 * having to read the raw exception message.
 *
 * Kept as a pure function (no Playwright import) so it stays testable
 * without a browser context. Match priority is explicit — first match
 * wins; UNKNOWN is the fall-through.
 */
export type FailureKind =
  | 'LAUNCH'
  | 'NAVIGATION'
  | 'SELECTOR'
  | 'AUTH'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'CAPTCHA'
  | 'UNKNOWN';

export function classifyFailure(message: string): FailureKind {
  const m = (message ?? '').toLowerCase();

  // Chromium binary / system-library failures during launch.
  if (
    m.includes("browsertype.launch") ||
    m.includes("executable doesn't exist") ||
    m.includes('missing dependencies') ||
    m.includes('playwright')
  ) {
    return 'LAUNCH';
  }

  // The page never finished loading or returned a non-200.
  if (m.includes('net::') || m.includes('err_') || m.includes('econnreset')) {
    return 'NETWORK';
  }

  // Generic timeout — could be a slow page, could be a redirect we don't
  // expect. Explicit because operators will see it often.
  if (m.includes('timeout') || m.includes('exceeded')) {
    return 'TIMEOUT';
  }

  // The login flow may have redirected us to a captcha gate before the
  // dashboard. Match specifically so we can surface a separate alert.
  if (m.includes('captcha') || m.includes('recaptcha')) {
    return 'CAPTCHA';
  }

  // A selector we expected on the page (e.g. #Username, a[href="/DS4/"])
  // never appeared. Either the markup changed or the page never loaded.
  if (
    m.includes('selector') ||
    m.includes('waiting for selector') ||
    m.includes('element not found')
  ) {
    return 'SELECTOR';
  }

  // The page returned but the post-login URL never matched — usually a
  // sign that auth was rejected (wrong creds, expired account, MFA gate).
  if (
    m.includes('waiting for url') ||
    m.includes('navigation') ||
    m.includes('redirect')
  ) {
    return 'NAVIGATION';
  }

  // Explicit unauthorized signal.
  if (
    m.includes('401') ||
    m.includes('unauthorized') ||
    m.includes('invalid credential') ||
    m.includes('forbidden')
  ) {
    return 'AUTH';
  }

  return 'UNKNOWN';
}
