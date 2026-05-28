/**
 * Next.js instrumentation hook (server + edge entry points).
 *
 * Pattern from @sentry/nextjs v8+: re-export the runtime-specific Sentry
 * config files so they are imported exactly once when the server boots.
 *
 * Note for future maintainers: when `src/` is present, Next.js looks for
 * `src/instrumentation.ts` (NOT this file at the package root). The
 * working entry point lives at `packages/web/src/instrumentation.ts` and
 * forwards to this module; this file is kept at the package root because
 * the @sentry/nextjs build plugin + several existing tutorials assume
 * the project-root location.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export { captureRequestError as onRequestError } from '@sentry/nextjs';
