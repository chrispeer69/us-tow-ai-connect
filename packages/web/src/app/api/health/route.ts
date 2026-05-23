// Liveness probe for the Next.js admin server.
//
// Railway hits this on every deploy via the healthcheckPath declared in
// railway.toml. It is intentionally dependency-free — if the Next.js
// process is up and serving routes, we are ready to take traffic. The web
// app does not own any external dependencies of its own; the API service
// has the deep dependency check at /health/ready.
//
// Kept under /api/* (rather than /health) so it sits in the same route
// namespace as the existing API rewrites and does not collide with a
// future user-facing /health page.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET() {
  return Response.json({ status: 'ok', timestamp: new Date().toISOString() });
}
