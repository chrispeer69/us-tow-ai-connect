/**
 * Sentry browser SDK initialisation.
 *
 * Loaded automatically by the @sentry/nextjs build plugin (see
 * next.config.js `withSentryConfig`). Reads from NEXT_PUBLIC_SENTRY_DSN
 * because anything the browser needs has to be inlined at build time.
 *
 * `enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN` keeps local + CI
 * builds quiet when the DSN is unset — the SDK is still bundled but
 * stays inert so we never see "DSN missing" runtime warnings in dev.
 */
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'production',
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
});
