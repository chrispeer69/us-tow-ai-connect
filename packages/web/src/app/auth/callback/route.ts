import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * SSO: GET /auth/callback — the redirect URI registered with US Tow SSO
 * (https://www.ustowaiconnect.com/auth/callback).
 *
 * US Tow SSO sends the browser here with `code` + `state`. The code exchange,
 * ID-token verification and session issue all happen in the NestJS API, so
 * this route forwards the query string untouched to /api/v1/auth/sso/callback
 * (same-origin rewrite to the API). The API finishes by redirecting to
 * /auth-callback with the dashboard session token in the URL fragment.
 */
export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  const { search } = request.nextUrl;
  return NextResponse.redirect(new URL(`/api/v1/auth/sso/callback${search}`, request.url));
}
