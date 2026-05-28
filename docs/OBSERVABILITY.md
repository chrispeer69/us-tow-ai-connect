# Observability — Sentry

Production errors from `@ustow/api` (NestJS) and `@ustow/web` (Next.js)
are captured by Sentry so we get a stack trace, breadcrumb trail, and
request context instead of a generic `500` line in the Railway log.

## What gets captured

### `@ustow/api`
- Any unhandled exception thrown out of a controller / interceptor /
  guard — picked up by `SentryGlobalFilter` (wired in `main.ts`).
- Background job errors that bubble out of `@nestjs/schedule` cron
  handlers — picked up by the auto-instrumentation registered in
  `instrument.ts`.
- 10% of HTTP requests get a performance trace (`tracesSampleRate: 0.1`)
  and 10% of traces also get a CPU profile
  (`profilesSampleRate: 0.1`).

### `@ustow/web`
- Browser exceptions (uncaught errors, unhandled promise rejections)
  via the client SDK loaded by `withSentryConfig`.
- Server / Edge runtime exceptions via `instrumentation.ts` →
  `sentry.server.config.ts` / `sentry.edge.config.ts`.
- React Server Component errors via the `onRequestError` export from
  `instrumentation.ts`.

What Sentry does **not** see: anything the application catches and
turns into a structured `HttpException` (those become 4xx responses by
design), and synthetic errors emitted before `Sentry.init()` runs
(impossible in normal operation — `instrument.ts` is the first import
in `main.ts`).

## Configuring Sentry in Railway

For each service, set the following variables (Settings → Variables):

### `@ustow/api`
| Variable             | Value                                              |
| -------------------- | -------------------------------------------------- |
| `SENTRY_DSN`         | DSN from sentry.io → Project Settings → Client Keys |
| `SENTRY_DEBUG_ROUTE` | Leave unset normally. Set to `true` only to smoke-test the capture path. |

### `@ustow/web`
| Variable                  | Value                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| `NEXT_PUBLIC_SENTRY_DSN`  | Browser-facing DSN. Same project is fine; the value is inlined into the client bundle so set it **before** the first deploy. |
| `SENTRY_DSN`              | Server + Edge runtime DSN. Typically same value as above.          |
| `SENTRY_AUTH_TOKEN`       | (Optional, CI-only) personal/internal Sentry auth token used by `withSentryConfig` to upload source maps. When unset, the build still succeeds — source maps just aren't uploaded. |
| `SENTRY_ORG`              | (Optional, CI-only) Sentry org slug for source-map upload.         |
| `SENTRY_PROJECT`          | (Optional, CI-only) Sentry project slug for source-map upload.     |

The init code in `instrument.ts` (api) and `sentry.client/server/edge.config.ts`
(web) all guard on `!!process.env.<DSN_VAR>` so unset DSNs are a silent
no-op — local `pnpm build` and CI both stay green without any of the
variables above.

## Verifying the capture path (smoke test)

After setting `SENTRY_DSN` for `@ustow/api` and redeploying, set
`SENTRY_DEBUG_ROUTE=true` on that same service and redeploy a second
time. Then:

```bash
curl -H "x-tenant-id: 00000000-0000-0000-0000-000000000001" \
     https://ustowapi-production.up.railway.app/v1/admin/_debug/sentry-test
```

The route throws `new Error('sentry-test')` synchronously. Within a few
seconds the event should land in sentry.io. **Unset `SENTRY_DEBUG_ROUTE`
once confirmed** — the route returns 404 when the flag is anything
other than the literal string `"true"`, but leaving it on is still a
foot-gun (a tenant with any valid UUID can poke at it).

For the web side, throwing an error in a client component
(`throw new Error('sentry-test')` inside an event handler) is enough —
the browser SDK captures it on the next tick.

## Where to view the events

`https://sentry.io/organizations/<org-slug>/issues/?project=<project-id>`

Replace `<org-slug>` and `<project-id>` with the values from your
Sentry project URL. Drop them into a single shared TODO if/when the
ops account is provisioned — we'll bake the link in then.
