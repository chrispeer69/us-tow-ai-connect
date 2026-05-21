import { Logger } from '@nestjs/common';

const log = new Logger('Sentry');

type SentryModule = {
  init: (cfg: { dsn: string; environment?: string }) => void;
  captureException: (err: unknown) => void;
};

let sentry: SentryModule | null = null;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    log.log('SENTRY_DSN not set — Sentry disabled (errors will log via Pino only)');
    return;
  }
  try {
    // Soft import — if @sentry/node isn't installed in this environment, fall back to logs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    sentry = require('@sentry/node') as SentryModule;
    sentry.init({ dsn, environment: process.env.NODE_ENV ?? 'development' });
    log.log('Sentry initialized');
  } catch (err) {
    log.warn(`@sentry/node not available: ${(err as Error).message}`);
    sentry = null;
  }
}

export function captureException(err: unknown): void {
  if (sentry) {
    try {
      sentry.captureException(err);
      return;
    } catch (e) {
      log.warn(`Sentry capture failed: ${(e as Error).message}`);
    }
  }
  log.error(err instanceof Error ? err.stack ?? err.message : String(err));
}
