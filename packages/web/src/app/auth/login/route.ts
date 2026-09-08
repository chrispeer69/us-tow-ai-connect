import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * SSO: GET /auth/login — the "Sign in with US Tow" entry point.
 *
 * The OIDC client lives in the NestJS API (packages/api/src/modules/auth/
 * ustow-sso.service.ts); this route just hands the browser to it through the
 * same-origin /api/* rewrite (next.config.js), carrying an optional same-origin
 * `next` path and `login_hint`. The API then redirects to US Tow SSO.
 */
export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const params = new URLSearchParams();
  const next = searchParams.get('next');
  if (next && next.startsWith('/') && !next.startsWith('//')) params.set('next', next);
  const loginHint = searchParams.get('login_hint');
  if (loginHint) params.set('login_hint', loginHint);
  const qs = params.toString();
  return NextResponse.redirect(new URL(`/api/v1/auth/sso${qs ? `?${qs}` : ''}`, request.url));
}
