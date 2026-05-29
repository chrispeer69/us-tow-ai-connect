/**
 * Sentry instrumentation entry point.
 *
 * This file must be imported as the FIRST line of `main.ts` so the
 * OpenTelemetry-based auto-instrumentation hooks in @sentry/nestjs bind
 * before any other module (Nest, Express, pg, ioredis, …) is required.
 */
import 'dotenv/config';

let Sentry: any;
try {
  Sentry = require('@sentry/nestjs');
} catch (err) {
  console.error('Failed to load @sentry/nestjs:', (err as Error).message);
  // Create a stub so the rest of the app doesn't crash
  Sentry = {
    init: () => {},
    captureException: () => {},
  };
}

// @sentry/profiling-node ships a native C++ addon (.node binary). If the
// binary was compiled on a different distro than the runtime image (e.g.
// Debian Bookworm build → Ubuntu Jammy runtime) the require() will throw.
// Wrap defensively so the app boots regardless.
let profilingIntegration: (() => unknown) | undefined;
try {
  const { nodeProfilingIntegration } = require('@sentry/profiling-node');
  profilingIntegration = nodeProfilingIntegration;
} catch (err) {
  console.warn('@sentry/profiling-node not available:', (err as Error).message);
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'production',
  tracesSampleRate: 0.1,
  profilesSampleRate: 0.1,
  integrations: profilingIntegration ? [profilingIntegration() as any] : [],
  enabled: !!process.env.SENTRY_DSN,
});
