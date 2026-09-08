/**
 * SSO: remembers that the current dashboard session came from "Sign in with
 * US Tow", so that logging out of the dashboard also ends the US Tow SSO
 * session (RP-initiated logout) instead of leaving the person silently signed
 * in at the identity provider.
 *
 * Stored in localStorage beside `access_token` (see AuthContext) — the two are
 * set together on /auth-callback and cleared together on logout.
 */

export const SSO_PROVIDER_KEY = 'sso_provider';
export const SSO_ID_TOKEN_KEY = 'sso_id_token';

/** Returns the SSO logout URL to send the browser to, or null if the session was not an SSO one. */
export function takeSsoLogoutUrl(): string | null {
  try {
    const provider = localStorage.getItem(SSO_PROVIDER_KEY);
    const idToken = localStorage.getItem(SSO_ID_TOKEN_KEY);
    localStorage.removeItem(SSO_PROVIDER_KEY);
    localStorage.removeItem(SSO_ID_TOKEN_KEY);
    if (provider !== 'ustow') return null;
    const qs = idToken ? `?id_token_hint=${encodeURIComponent(idToken)}` : '';
    return `/api/v1/auth/sso/logout${qs}`;
  } catch {
    return null;
  }
}
