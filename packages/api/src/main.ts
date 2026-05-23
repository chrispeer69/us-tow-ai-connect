import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { initSentry } from './common/observability/sentry';

// Routes that must NOT enforce the CORS allow-list. Webhook providers
// (Thinkrr, Twilio) and the public Knowledge Pack consumer (Thinkrr's
// agent runtime) do not honour CORS preflight — blocking them here would
// only confuse debugging without adding security. Each of these surfaces
// has its own auth: the webhook secret in the URL path for Thinkrr,
// Twilio's request signature for Twilio, and tenant UUIDs for the public
// Knowledge Pack endpoint.
const CORS_EXEMPT_PATH_PREFIXES = ['/webhooks/', '/public/', '/health'];

function buildCorsOriginValidator(allowList: string[]) {
  const allowed = new Set(allowList.filter(Boolean));
  return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Server-to-server callers + same-origin requests have no Origin header.
    if (!origin) return callback(null, true);
    if (allowed.has(origin)) return callback(null, true);
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
  initSentry();

  const logger = new Logger('Bootstrap');
  warnIfLocalhostInProd(logger);

  // CORS allow-list. The web app's public origin is the primary entry; any
  // extra origins (staging deploys, internal tooling) come through the
  // CORS_EXTRA_ORIGINS env as a comma-separated list.
  const webOrigin = process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000';
  const extra = (process.env.CORS_EXTRA_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowList = [webOrigin, ...extra];

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // CORS configured below so we can use the exempt-prefix middleware
    // pattern instead of the global toggle.
    cors: false,
    rawBody: true,
  });

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
