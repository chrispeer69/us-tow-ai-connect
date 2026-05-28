/**
 * Sentry instrumentation entry point.
 *
 * This file must be imported as the FIRST line of `main.ts` so the
 * OpenTelemetry-based auto-instrumentation hooks in @sentry/nestjs bind
 * before any other module (Nest, Express, pg, ioredis, …) is required.
 * Loading order matters: instrumentations that patch a module after it
 * has already been required are no-ops.
 *
 * `enabled: !!process.env.SENTRY_DSN` is the local-build escape hatch —
 * with no DSN configured (e.g. `pnpm build` on a contributor laptop or in
 * CI without secrets) Sentry stays inert and never tries to dial home.
 *
 * `dotenv/config` is loaded here as well as in main.ts: this module runs
 * before main.ts's own `import 'dotenv/config'` so without it
 * `process.env.SENTRY_DSN` would be undefined for local dev runs that
 * rely on packages/api/.env. In Railway the env vars are injected by the
 * platform so the dotenv load is a no-op there.
 */
import 'dotenv/config';
import * as Sentry from '@sentry/nestjs';

// @sentry/profiling-node ships a native C++ addon (.node binary). If the
// binary was compiled on a different distro than the runtime image (e.g.
// Debian Bookworm build → Ubuntu Jammy runtime) the require() will throw
// or segfault. Wrap defensively so the app boots regardless.
let profilingIntegration: (() => unknown) | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { nodeProfilingIntegration } = require('@sentry/profiling-node');
  profilingIntegration = nodeProfilingIntegration;
} catch {
  // eslint-disable-next-line no-console
  console.warn('[sentry] @sentry/profiling-node not available — profiling disabled');
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'production',
  tracesSampleRate: 0.1,
  profilesSampleRate: 0.1,
  integrations: profilingIntegration ? [profilingIntegration() as any] : [],
  enabled: !!process.env.SENTRY_DSN,
});
