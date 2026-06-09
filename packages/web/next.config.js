/** @type {import('next').NextConfig} */
// Resolve the API target the web service proxies /api/* to.
//
// Order of preference:
//   1. NEXT_PUBLIC_API_URL (canonical — set this in Railway for the @ustow/web service)
//   2. API_URL (server-only alias; useful when you don't want the URL inlined into the client bundle)
//   3. Railway production fallback (so we never silently proxy to localhost in prod
//      if the operator forgets to set the env var — empirically that produced the
//      "browser shows 500 on every /admin/* page" symptom even though curl on the
//      static HTML returned 200, because next.js was ECONNREFUSED'ing to :3001)
//   4. Local dev default
const isProdLike =
  process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);
const apiTarget =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.API_URL ||
  (isProdLike ? 'https://ustowapi-production.up.railway.app' : 'http://localhost:3001');

// Loud startup log so deploys make it obvious where /api/* is being routed.
// eslint-disable-next-line no-console
console.log(`[next.config] /api/* → ${apiTarget} (env source: ${
  process.env.NEXT_PUBLIC_API_URL ? 'NEXT_PUBLIC_API_URL'
  : process.env.API_URL ? 'API_URL'
  : isProdLike ? 'prod-fallback'
  : 'dev-fallback'
})`);

const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle at .next/standalone for the Railway
  // Dockerfile to ship. Without this the runtime image needs the entire
  // node_modules tree.
  output: 'standalone',
  // Standalone mode resolves workspace deps from the repo root; tell Next
  // where that root lives so it traces files correctly.
  outputFileTracingRoot: require('path').join(__dirname, '../..'),
  env: {
    // Map backend env vars to Next.js public env vars at build time so the
    // client-side AuthContext can check if the logged-in user is a super admin.
    NEXT_PUBLIC_SUPER_ADMIN_EMAILS: process.env.SUPER_ADMIN_EMAILS || process.env.SUPER_ADMIN_DEV_EMAIL || process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || '',
  },
  transpilePackages: ['@ustow/shared'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiTarget}/:path*`,
      },
    ];
  },
};

// -----------------------------------------------------------------------------
// Sentry build-time wrap.
//
// `withSentryConfig` injects the Sentry webpack plugin so client/server
// bundles include the Sentry SDK and (when an auth token is available) uploads
// source maps to sentry.io. `silent: true` suppresses the upload-related
// console chatter on every build.
//
// Source-map upload is OFF until SENTRY_AUTH_TOKEN is set — without that
// guard, local `pnpm build` would warn loudly and CI would fail with a "no
// auth token" exit. When the token is set in Railway later (alongside
// SENTRY_ORG + SENTRY_PROJECT) source-map upload kicks in automatically.
// -----------------------------------------------------------------------------
const { withSentryConfig } = require('@sentry/nextjs');

module.exports = withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  disableLogger: true,
  widenClientFileUpload: false,
});
