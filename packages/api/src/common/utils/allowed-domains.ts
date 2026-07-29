/**
 * Domain allow-list resolution (Session 46).
 *
 * Single source of truth for "which origins is this API allowed to talk to."
 * Driven by the `ALLOWED_DOMAINS` env var so a custom domain
 * (e.g. https://app.ustow-aiconnect.com) can be brought online by editing
 * one Railway variable — no code change, no redeploy of new image.
 *
 * `ALLOWED_DOMAINS` is a comma-separated list of origins. Two entry shapes:
 *   - exact origin:  https://app.ustow-aiconnect.com
 *   - wildcard host: https://*.up.railway.app   (matches any single label
 *                    in the left-most position, scheme-sensitive)
 *
 * Legacy `WEB_PUBLIC_URL` + `CORS_EXTRA_ORIGINS` are merged in for
 * backward-compatibility so the migration to ALLOWED_DOMAINS is
 * non-breaking — existing deploys keep working until the operator moves
 * everything under ALLOWED_DOMAINS.
 */

/** Origins always trusted in local dev. Harmless in prod (never sent by browsers there). */
const DEV_DEFAULTS = ['http://localhost:3000', 'http://localhost:3001'];

/** Railway's per-service generated subdomains, used before a custom domain is wired. */
const RAILWAY_WILDCARD = 'https://*.up.railway.app';

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export interface AllowedDomainsEnv {
  ALLOWED_DOMAINS?: string;
  WEB_PUBLIC_URL?: string;
  CORS_EXTRA_ORIGINS?: string;
}

/**
 * Resolve the full origin allow-list from the environment.
 * Order is irrelevant (matching is set-based); duplicates are collapsed.
 */
export function resolveAllowedOrigins(env: AllowedDomainsEnv = process.env): string[] {
  const configured = splitList(env.ALLOWED_DOMAINS);
  const legacy = [env.WEB_PUBLIC_URL, ...splitList(env.CORS_EXTRA_ORIGINS)].filter(
    (v): v is string => Boolean(v),
  );

  // When the operator has set nothing, fall back to dev + Railway defaults
  // so a fresh deploy is reachable from *.up.railway.app out of the box.
  const base = configured.length > 0 || legacy.length > 0 ? [] : [...DEV_DEFAULTS, RAILWAY_WILDCARD];

  return Array.from(new Set([...base, ...configured, ...legacy]));
}

/**
 * Build an origin predicate from an allow-list. Supports exact matches and
 * `scheme://*.suffix` wildcard hosts (single left-most label).
 */
export function buildOriginMatcher(allowList: string[]): (origin: string) => boolean {
  const exact = new Set<string>();
  const wildcards: Array<{ scheme: string; suffix: string }> = [];

  for (const entry of allowList) {
    const star = entry.indexOf('://*.');
    if (star !== -1) {
      const scheme = entry.slice(0, star); // e.g. "https"
      const suffix = entry.slice(star + '://*.'.length); // e.g. "up.railway.app"
      if (scheme && suffix) wildcards.push({ scheme, suffix });
      continue;
    }
    exact.add(entry);
  }

  return (origin: string): boolean => {
    if (exact.has(origin)) return true;
    for (const { scheme, suffix } of wildcards) {
      // Match scheme + a single subdomain label in front of the suffix.
      // https://abc.up.railway.app ✓   https://up.railway.app ✗   https://a.b.up.railway.app ✗
      const prefix = `${scheme}://`;
      if (!origin.startsWith(prefix)) continue;
      const host = origin.slice(prefix.length);
      const dot = host.indexOf('.');
      if (dot > 0 && host.slice(dot + 1) === suffix) return true;
    }
    return false;
  };
}

/**
 * CSP `connect-src` directive value built from the same allow-list.
 *
 * The API tier itself serves only JSON and ships `default-src 'none'`
 * (see AdminCspMiddleware) — it does NOT consume this. It exists as the
 * cross-tier contract the web app (packages/web, Next.js headers) should
 * emit so the browser can reach the API on a custom domain. Documented in
 * docs/CUSTOM_DOMAIN.md §3. Kept here so the directive derives from one
 * allow-list rather than drifting in two codebases.
 */
export function buildConnectSrcDirective(allowList: string[]): string {
  const sources = allowList.length > 0 ? allowList.join(' ') : "'self'";
  return `connect-src 'self' ${sources}`.trim();
}

/**
 * Parent cookie domain for a custom origin — the dotted apex that lets a
 * cookie be shared across app./api. subdomains (e.g. ".ustow-aiconnect.com").
 *
 * Returns null for localhost, IPs, and bare two-label hosts where a
 * dot-prefixed cookie domain would be rejected by the browser. The API is
 * header/token-auth and sets no cookies; this is the helper the web tier
 * uses for its session cookie — see docs/CUSTOM_DOMAIN.md §3.
 */
export function parentCookieDomain(origin: string): string | null {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return null;
  }
  if (host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const labels = host.split('.');
  if (labels.length < 3) return null; // apex with no subdomain → no shared cookie domain
  return `.${labels.slice(-2).join('.')}`;
}
