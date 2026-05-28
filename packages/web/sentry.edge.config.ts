/**
 * Sentry SDK initialisation for the Next.js Edge runtime.
 *
 * Loaded by `instrumentation.ts` when NEXT_RUNTIME === 'edge'. The Edge
 * runtime does not support nodeProfilingIntegration or other Node-only
 * integrations, so this stays minimal.
 */
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'production',
  tracesSampleRate: 0.1,
  enabled: !!process.env.SENTRY_DSN,
});
