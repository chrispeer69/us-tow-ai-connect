// MUST be the first import — @sentry/nestjs binds its OpenTelemetry
// auto-instrumentation hooks inside Sentry.init(), and modules that have
// already been require()'d by the time init runs are not re-patched.
// See packages/api/src/instrument.ts for the init body.
import './instrument';
// eslint-disable-next-line no-console
console.log('[BOOT] main.ts: instrument loaded, loading reflect-metadata...');
import 'reflect-metadata';
import 'dotenv/config';

// S65 — Belt-and-suspenders: ensure Playwright finds the Chromium binary
// installed at /ms-playwright by the Dockerfile playwright stage. We set the
// env var here BEFORE anything imports `playwright`, because Playwright
// captures the path at module-load time. Railway sometimes scrubs ENV
// declarations from Dockerfiles; setting it in JS as a fallback means the
// container works whether or not the orchestrator honours the Dockerfile.
import './playwright-env';
// eslint-disable-next-line no-console
console.log('[BOOT] main.ts: loading NestJS + other imports...');
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
// eslint-disable-next-line no-console
console.log('[BOOT] main.ts: loading SentryGlobalFilter...');
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
// eslint-disable-next-line no-console
console.log('[BOOT] main.ts: loading helmet + app modules...');
import helmet from 'helmet';
import { AppModule } from './app.module';
import { initSentry } from './common/observability/sentry';
import { buildOriginMatcher, resolveAllowedOrigins } from './common/utils/allowed-domains';
// eslint-disable-next-line no-console
console.log('[BOOT] main.ts: all imports complete');

// Routes that must NOT enforce the CORS allow-list. Webhook providers
// (Thinkrr, Twilio) and the public Knowledge Pack consumer (Thinkrr's
// agent runtime) do not honour CORS preflight — blocking them here would
// only confuse debugging without adding security. Each of these surfaces
// has its own auth: the webhook secret in the URL path for Thinkrr,
// Twilio's request signature for Twilio, and tenant UUIDs for the public
// Knowledge Pack endpoint.
const CORS_EXEMPT_PATH_PREFIXES = ['/webhooks/', '/public/', '/health'];

function buildCorsOriginValidator(allowList: string[]) {
  const matches = buildOriginMatcher(allowList);
  return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Server-to-server callers + same-origin requests have no Origin header.
    if (!origin) return callback(null, true);
    if (matches(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not in allow-list`));
  };
}

function warnIfLocalhostInProd(logger: Logger) {
  if (process.env.NODE_ENV !== 'production') return;
  const offenders = (
    ['PUBLIC_BASE_URL', 'WEB_PUBLIC_URL'] as const
  )
    .map((name) => ({ name, value: process.env[name] ?? '' }))
    .filter(({ value }) => /localhost|127\.0\.0\.1/.test(value));
  for (const { name, value } of offenders) {
    logger.warn(
      `${name} is "${value}" while NODE_ENV=production — this URL is baked into the Knowledge Pack + webhook callbacks and will not be reachable from Thinkrr/Twilio.`,
    );
  }
}

async function bootstrap() {
  // eslint-disable-next-line no-console
  console.log('[BOOT] bootstrap() starting...');
  initSentry();

  const logger = new Logger('Bootstrap');
  // eslint-disable-next-line no-console
  console.log('[BOOT] bootstrap: creating NestFactory...');
  warnIfLocalhostInProd(logger);

  // CORS allow-list, resolved from ALLOWED_DOMAINS (comma-separated origins,
  // supports `scheme://*.suffix` wildcards). Legacy WEB_PUBLIC_URL +
  // CORS_EXTRA_ORIGINS are merged in for back-compat; when nothing is set we
  // fall back to localhost + *.up.railway.app so a fresh deploy is reachable.
  // Bringing a custom domain online is a one-variable change, no code edit.
  const allowList = resolveAllowedOrigins(process.env);

  let app: NestExpressApplication;
  try {
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      // CORS configured below so we can use the exempt-prefix middleware
      // pattern instead of the global toggle.
      cors: false,
      rawBody: true,
    });
    // eslint-disable-next-line no-console
    console.log('[BOOT] bootstrap: NestFactory.create succeeded');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[BOOT] bootstrap: NestFactory.create FAILED:', err);
    throw err;
  }

  // Helmet defaults are safe for an API; the one override is
  // crossOriginResourcePolicy so Thinkrr's agent runtime can pull the
  // public Knowledge Pack from a different origin without being blocked.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // contentSecurityPolicy default-off for the API tier — the only
      // HTML this service emits is error pages from Express; the
      // admin/web app sets its own CSP via Next.js headers.
      contentSecurityPolicy: false,
    }),
  );

  // Custom CORS gate: apply the allow-list for normal API requests, let
  // webhook + public routes through unconditionally.
  app.enableCors({
    origin: (origin, cb) => buildCorsOriginValidator(allowList)(origin, cb),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-tenant-id'],
  });

  // Express middleware running before the Nest CORS middleware: short-
  // circuit preflight + access-control for the exempt paths so a
  // mis-set origin can't break webhook ingress.
  const httpAdapter = app.getHttpAdapter().getInstance();
  httpAdapter.use((req: { path: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    if (CORS_EXEMPT_PATH_PREFIXES.some((p) => req.path.startsWith(p))) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    next();
  });

  // Raw-body capture for binary image uploads on the branding upload
  // routes. Reads the request stream into a Buffer (capped at 2 MB) so
  // the controller can `req.rawBody` it. Avoids adding multer as a dep.
  httpAdapter.use((req: any, _res: unknown, next: (err?: Error) => void) => {
    if (
      typeof req?.path === 'string' &&
      req.path.startsWith('/v1/admin/branding/upload/') &&
      (req.method === 'POST' || req.method === 'PUT')
    ) {
      const chunks: Buffer[] = [];
      let bytes = 0;
      req.on('data', (c: Buffer) => {
        bytes += c.length;
        if (bytes > 2 * 1024 * 1024) {
          req.destroy(new Error('Upload exceeds 2 MB limit'));
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        req.rawBody = Buffer.concat(chunks);
        next();
      });
      req.on('error', (err: Error) => next(err));
      return;
    }
    next();
  });

  // Sentry's global exception filter wraps Nest's default BaseExceptionFilter
  // so swallowed 500s — anything that bubbles past per-controller filters —
  // are captured with full request context. Stays inert when SENTRY_DSN is
  // unset because instrument.ts initialised Sentry with enabled:false.
  // BaseExceptionFilter wants the abstract HttpServer; HttpAdapterHost on a
  // NestExpressApplication narrows that to the Express instance, which is
  // structurally compatible at runtime but not at the type level — hence
  // the cast (matches how other Nest+Sentry templates do it).
  const adapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new SentryGlobalFilter(adapterHost.httpAdapter as never));

  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  logger.log(`US Tow AI-Connect API listening on :${port}`);
  logger.log(`CORS allow-list: ${allowList.join(', ')}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error', err);
  process.exit(1);
});
