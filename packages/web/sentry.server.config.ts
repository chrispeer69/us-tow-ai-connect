/**
 * Sentry Node.js SDK initialisation for the Next.js server runtime.
 *
 * Loaded by `instrumentation.ts` when NEXT_RUNTIME === 'nodejs'. Uses the
 * server-only SENTRY_DSN env var so the DSN isn't inlined into client
 * bundles (operational hygiene — a leaked NEXT_PUBLIC_SENTRY_DSN is fine
 * because Sentry rate-limits per-DSN, but we still prefer server-scoped
 * captures to carry the unredacted DSN).
 */
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'production',
  tracesSampleRate: 0.1,
  enabled: !!process.env.SENTRY_DSN,
});
