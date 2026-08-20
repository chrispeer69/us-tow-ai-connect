/**
 * Session 79 — which tenant this browser is currently looking at.
 *
 * Before this, `api()` sent a HARDCODED `x-tenant-id` from
 * NEXT_PUBLIC_DEFAULT_TENANT_ID — always Roadside's uuid, for everyone, on
 * every request. That was invisible while the product had one real tenant. The
 * moment the tenant switcher works it becomes the bug that eats it: the JWT
 * would say US Tow Alliance and the header would still say Roadside, and which
 * one wins is decided per-endpoint by whichever the guard happens to read.
 *
 * So the active tenant is stored once, here, and both the header and the UI
 * read from the same place.
 *
 * localStorage rather than a cookie: it sits beside `access_token`, which is
 * already stored there, and the two must be swapped together — a token for one
 * tenant with a header for another is exactly the mismatch above.
 */

export const ACTIVE_TENANT_KEY = 'active_tenant_id';
export const ACTIVE_TENANT_NAME_KEY = 'active_tenant_name';

/** Fallback for a browser that has never switched. Matches the API default. */
export const DEFAULT_TENANT_ID =
  process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';

/**
 * The tenant id to send with requests.
 *
 * Prefers, in order: an explicit switch, the tenantId inside the current JWT,
 * then the build-time default. Reading the JWT matters for the very first page
 * load after signing in — the user has a token scoped to a tenant but has not
 * touched the switcher, and defaulting to Roadside there would show a US Tow
 * Alliance owner somebody else's dispatch board.
 */
export function getActiveTenantId(): string {
  if (typeof window === 'undefined') return DEFAULT_TENANT_ID;

  const stored = window.localStorage.getItem(ACTIVE_TENANT_KEY);
  if (stored) return stored;

  const fromToken = tenantIdFromToken();
  if (fromToken) return fromToken;

  return DEFAULT_TENANT_ID;
}

export function getActiveTenantName(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACTIVE_TENANT_NAME_KEY);
}

/**
 * Record a switch. Call this with the token from POST /v1/auth/switch-tenant —
 * the token and the id must move together or they disagree.
 */
export function setActiveTenant(tenantId: string, companyName: string, accessToken: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem('access_token', accessToken);
  window.localStorage.setItem(ACTIVE_TENANT_KEY, tenantId);
  window.localStorage.setItem(ACTIVE_TENANT_NAME_KEY, companyName);
}

/**
 * Forget the switch. Used on sign-out, so the next person to sign in on this
 * browser does not inherit the previous one's tenant.
 */
export function clearActiveTenant(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACTIVE_TENANT_KEY);
  window.localStorage.removeItem(ACTIVE_TENANT_NAME_KEY);
}

/** The `tenantId` claim from the stored JWT, without verifying it. */
export function tenantIdFromToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = window.localStorage.getItem('access_token');
  if (!token) return null;
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    // base64url -> base64. atob rejects the url-safe alphabet.
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
    return typeof json.tenantId === 'string' ? json.tenantId : null;
  } catch {
    // A malformed token is not this function's problem — the API will reject
    // it. Returning null just falls through to the default.
    return null;
  }
}
