/**
 * Per-route-group throttle policy (Session 26 — Bundle B section 1).
 *
 * The four tiers are intentionally coarse — they mirror the four auth
 * postures the API exposes, not individual endpoints:
 *
 *   - `public`     — IP-keyed. Knowledge Pack, /track/:token, /health.
 *                    Tight by design: an abusive scraper should hit the wall
 *                    quickly without DoS'ing a tenant API key.
 *   - `tenant_api` — Tenant-API-key keyed. /v1/ai-connect/*, /v1/driver/*.
 *                    Per-tenant headroom for high-volume callers.
 *   - `admin`      — Admin-session keyed (x-tenant-id today; jwt later).
 *                    Comfortable for a dashboard but still bounded.
 *   - `webhook`    — IP-keyed. Twilio, Thinkrr, SendGrid callbacks burst.
 *
 * Bumping a single tenant: AdminController's PATCH /v1/admin/system/limits
 * (Section 4) writes a Redis override key — see ApiKeyThrottlerGuard.
 */

export type EndpointGroup = 'public' | 'tenant_api' | 'admin' | 'webhook';

export interface ThrottleTier {
  group: EndpointGroup;
  limit: number;
  windowSeconds: number;
}

export const THROTTLE_TIERS: Record<EndpointGroup, ThrottleTier> = {
  public: { group: 'public', limit: 60, windowSeconds: 60 },
  tenant_api: { group: 'tenant_api', limit: 120, windowSeconds: 60 },
  admin: { group: 'admin', limit: 600, windowSeconds: 60 },
  webhook: { group: 'webhook', limit: 600, windowSeconds: 60 },
};

/** Resolve the endpoint group from the URL path. Order matters: longer/more
 * specific prefixes must come first. Returns `null` when no rule matches —
 * the guard treats that as "don't throttle" (e.g. internal cron triggers,
 * websocket upgrades). */
export function resolveEndpointGroup(path: string): EndpointGroup | null {
  if (!path) return null;
  // Webhook providers can burst on retry; keep their tier separate from /public.
  if (path.startsWith('/webhooks/')) return 'webhook';
  if (path === '/health' || path.startsWith('/health/')) return 'public';
  if (path.startsWith('/public/')) return 'public';
  if (path.startsWith('/track/')) return 'public';
  if (path.startsWith('/v1/admin/')) return 'admin';
  // Auth routes (login, signup, google) — IP-keyed like public to prevent
  // brute-force attacks. Sits in the 'public' tier (60 req/min per IP).
  if (path.startsWith('/v1/auth/')) return 'public';
  // Driver-facing endpoints live under both /v1/driver/* and /v1/ai-connect/*.
  if (path.startsWith('/v1/ai-connect/')) return 'tenant_api';
  if (path.startsWith('/v1/driver/')) return 'tenant_api';
  if (path.startsWith('/v1/partner/')) return 'tenant_api';
  return null;
}
