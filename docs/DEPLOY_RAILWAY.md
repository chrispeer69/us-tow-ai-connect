# Production deployment runbook — Railway

This is the **single source of truth** for getting US Tow AI-Connect onto a
production URL. Follow it top-to-bottom the first time; bookmark the section
numbers for return visits (rollbacks, env-var changes, custom-domain flips).

Companion documents:

- `infra/railway/README.md` — topology diagram and service inventory.
- `docs/THINKRR_INTEGRATION.md` — how the Knowledge Pack URL is consumed by
  the voice agent (now points at the Railway URL instead of ngrok).
- `docs/BLOCKERS.md` — open items that need credentials the autonomous
  builder cannot obtain.

## 0. Prerequisites

Tools the human running this runbook needs locally:

1. **Railway CLI** — for verifying env vars and tailing logs from your
   terminal. Install:
   - macOS: `brew install railway`
   - Windows: `iwr https://railway.app/install.ps1 | iex`
   - Linux: `bash <(curl -fsSL https://railway.app/install.sh)`
   - Confirm: `railway --version` (expect ≥ 3.x).
2. **A Railway account** linked to the `chrispeer69` GitHub identity (so
   the GitHub app can read this repo).
3. **A real `ENCRYPTION_KEY`** generated with `openssl rand -hex 32`. Do not
   reuse the placeholder from `.env.example`.
4. **Real Thinkrr, Twilio, Google Places, and (optional) SendGrid + Sentry
   keys** — see the variable list in §3.
5. **`pnpm` 9.x and Node 22+** if you intend to run the smoke-test script
   locally after deploy.

## 1. Create the Railway project

1. `railway login` — opens the browser, picks up the GitHub identity above.
2. `railway init` from the repo root and choose **"Empty project"**.  Name
   it `us-tow-ai-connect` (or whatever — the name only shows in the
   Railway dashboard).
3. In the Railway dashboard for the new project, click **+ New → Database →
   Add PostgreSQL**. Wait ~30 s for it to provision.
4. Click **+ New → Database → Add Redis**. Wait ~30 s.
5. Click **+ New → GitHub Repo** and select `chrispeer69/us-tow-ai-connect`.
   Railway will scan the repo, find `railway.toml`, and offer to create the
   `api` and `web` services automatically. Accept both.

After this step the project should show **four resources**: `api`, `web`,
`Postgres`, `Redis`.

## 2. Link the GitHub repo for auto-deploys

This is what removes the need for any GitHub Actions step that pushes to
Railway directly.

1. In the Railway project, open **Settings → GitHub** and confirm the repo is
   linked.
2. For each app service (`api` and `web`), open **Settings → Source** and
   confirm:
   - **Branch:** `main`
   - **Root Directory:** `/` (the Dockerfile path is set via `railway.toml`).
   - **Watch Paths:** leave empty (any change in the repo triggers a build).
3. The CI workflow at `.github/workflows/deploy.yml` runs the type-check +
   tests in parallel; Railway's own GitHub app does the actual build. No
   `RAILWAY_TOKEN` is required in GitHub Secrets.

## 3. Set environment variables

Set each variable in the Railway dashboard for the matching service.
Variables marked **secret** must come from the upstream provider — never
commit real values.

### `api` service

| Variable                 | Source / value                                         |
|--------------------------|--------------------------------------------------------|
| `DATABASE_URL`           | Reference: `${{Postgres.DATABASE_URL}}`                |
| `REDIS_URL`              | Reference: `${{Redis.REDIS_URL}}`                      |
| `NODE_ENV`               | `production`                                           |
| `PORT`                   | `3001` (Railway also injects `PORT`; the app honours both) |
| `PUBLIC_BASE_URL`        | `https://api.ustow-aiconnect.com` (or the temporary `https://<api>.up.railway.app` until DNS is live) |
| `WEB_PUBLIC_URL`         | `https://app.ustow-aiconnect.com` (or `https://<web>.up.railway.app`) — used for the CORS allow-list |
| `ENCRYPTION_KEY`         | **secret** — `openssl rand -hex 32`                     |
| `THINKRR_API_KEY`        | **secret** — thinkrr.ai → Account → API Keys           |
| `THINKRR_WEBHOOK_SECRET` | **secret** — `openssl rand -hex 32`, then paste into Thinkrr's webhook settings |
| `TWILIO_ACCOUNT_SID`     | **secret** — console.twilio.com → Account Info         |
| `TWILIO_AUTH_TOKEN`      | **secret** — console.twilio.com → Account Info         |
| `TWILIO_PHONE_NUMBER`    | E.164 caller ID, e.g. `+16145551234`                   |
| `GOOGLE_PLACES_API_KEY`  | **secret** — Google Cloud → Credentials                |
| `SENDGRID_API_KEY`       | **secret** — leave blank to keep alerts at log-level   |
| `SENTRY_DSN`             | **secret** — leave blank to disable Sentry             |
| `DEFAULT_ADMIN_TENANT_ID`| `00000000-0000-0000-0000-000000000001`                 |
| `PLAYWRIGHT_HEADLESS`    | `true`                                                 |
| `PLAYWRIGHT_BROWSERS_PATH`| `/ms-playwright`                                      |

### `web` service

| Variable                          | Value                                                   |
|-----------------------------------|---------------------------------------------------------|
| `NEXT_PUBLIC_API_URL`             | `https://api.ustow-aiconnect.com` (or the Railway URL)  |
| `NEXT_PUBLIC_DEFAULT_TENANT_ID`   | `00000000-0000-0000-0000-000000000001`                  |
| `NODE_ENV`                        | `production`                                            |
| `PORT`                            | `3000` (Railway also injects `PORT`)                    |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | **secret, optional** — Maps JS key for Command Center; if unset, map renders a placeholder |
| `NEXT_PUBLIC_WS_URL`              | Same hostname as `NEXT_PUBLIC_API_URL` (Socket.io shares the HTTP origin) |

## 4. First deploy

1. Push the current `main` to GitHub: `git push origin main`. The Railway
   GitHub app starts building both services in parallel.
2. Watch the `api` build log for the Playwright install step (≈3–4 minutes
   on the first build; cached on subsequent ones).
3. Once both services show **"ACTIVE"**, click the `api` service → **Settings
   → Networking → Generate Domain**; do the same for `web`.
4. Copy the `.up.railway.app` URLs and set them back as `PUBLIC_BASE_URL`
   and `NEXT_PUBLIC_API_URL` (Railway will redeploy both services
   automatically when variables change).

## 5. Migrations + seed

Migrations run automatically every deploy via the `preDeployCommand`
declared in `railway.toml`:

```
pnpm --filter @ustow/api run db:migrate:prod
```

The `:prod` flavour runs the compiled JS (`node dist/db/migrate.js`) — the
runtime container does not include `tsx`. Use plain `db:migrate` only in
local dev.

Migration files live in `packages/api/src/db/migrations/` and are applied in
filename order by Drizzle's migrator, which records applied filenames in a
`drizzle.__drizzle_migrations` table. Re-running is a no-op.

To seed the **tenant zero** Roadside Towing row after the first deploy:

```
railway run --service api pnpm --filter @ustow/api run db:seed:tenant-zero:prod
```

The `:prod` variant runs the compiled `dist/db/seeds/...` so it works
inside the slim runtime container that does not carry `tsx`.

The seed is `INSERT … ON CONFLICT DO UPDATE`, so re-running is safe.

### Migration safety rules

- New migrations must be **additive** (new tables, new nullable columns,
  new indexes `CONCURRENTLY` when possible). Never drop a column in the same
  deploy that stops referencing it — split into two deploys.
- Backfills that touch more than a few thousand rows belong in a one-off
  script (`railway run --service api pnpm exec tsx …`), not in a migration
  file, so the deploy itself stays fast.
- Each migration file must be idempotent enough to survive a partial-apply
  re-run: prefer `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.

## 6. Health checks

The API exposes:

- `GET /health` — liveness, no dependencies. Returns 200 the moment the
  Nest app finishes booting.
- `GET /health/ready` — readiness, pings Postgres (`SELECT 1`) and Redis
  (`PING`). Returns 200 only when **both** succeed. Used by Railway's
  healthcheck (`railway.toml: healthcheckPath = "/health/ready"`).

The web service exposes:

- `GET /api/health` — returns 200 once the Next.js server is up. Used by
  Railway's healthcheck for the web service.

Both endpoints are documented further in §14.

## 7. Logs & monitoring

- All logs go to **stdout** (NestJS uses the default Pino-style logger).
  Railway aggregates these in the **Deployments → View Logs** tab and the
  per-service **Observability → Metrics** view.
- Real-time tail from the terminal:

  ```
  railway logs --service api --follow
  railway logs --service web --follow
  ```

- Setting `SENTRY_DSN` activates the soft-imported `@sentry/node` SDK at
  boot (`packages/api/src/common/observability/sentry.ts`). If the dep is
  not installed in the image, Sentry stays disabled and the boot log says
  so — no extra config needed.

## 8. Playwright in production

The API uses Playwright Chromium for the Towbook + AAA adapters. The
`packages/api/Dockerfile` runs:

```
pnpm exec playwright install --with-deps chromium
```

during the build stage and copies the browser to `/ms-playwright`. The
runtime container exports `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` so the
adapter picks the bundled binary instead of trying to download at first
use.

**RAM budget.** Chromium uses ~250 MB resident per session, but Playwright
keeps a single warm browser per tenant; with 10 active tenants and the
overhead of Node + Nest itself, expect ~1.5 GB steady-state. Railway's
**Hobby** plan caps at 512 MB and will OOM the API container during the
first batch poll. **Production minimum is the Pro plan (8 GB)**; pick the
8 GB / 8 vCPU tier when promoting the `api` service.

If a deploy fails with `Error: Executable doesn't exist at …` the
Playwright install step did not run — confirm the Dockerfile's order, then
trigger a clean rebuild (Railway → Deployments → ⋯ → **Rebuild**).

## 9. Cron / background jobs

`JobPollerCron` is the only scheduled task in the API right now. It uses
`@nestjs/schedule` and runs in-process every 60 s — fine while the API is
a **single instance**. If the `api` service is ever scaled past one
replica:

1. Move the cron into a **separate Railway service** running the same
   image with a CLI flag (`node dist/main.js --poll-only`); set its replica
   count to 1.
2. Or switch to BullMQ — Redis is already in the stack, so adding the
   `bullmq` dep and wrapping the poller in a queue worker is the smaller
   change. The cron-scheduling node remains single-instance, but the work
   is fan-out via Redis.
3. Or use **Railway Cron** (paid feature) to invoke a one-shot job; Railway
   spins a fresh container per fire, which avoids overlap entirely.

Until then: leave it as-is and document the single-instance constraint on
the `api` service (**Settings → Replicas → 1**).

## 10. Custom domain (`ustow-aiconnect.com`)

Once the domain is registered (currently *not* purchased — see
`docs/BLOCKERS.md`):

1. In Railway, open the `api` service → **Settings → Networking → Custom
   Domain → +**. Enter `api.ustow-aiconnect.com`. Railway shows a CNAME
   target like `<id>.up.railway.app`.
2. At the DNS provider, create:

   ```
   CNAME  api  →  <api-service>.up.railway.app
   CNAME  app  →  <web-service>.up.railway.app
   ```

3. Repeat step 1 for the `web` service with `app.ustow-aiconnect.com`.
4. Once Railway flips the cert from "Pending" to "Active" (≈ 30 s after
   DNS resolves), update the env vars from §3:
   - `PUBLIC_BASE_URL` → `https://api.ustow-aiconnect.com`
   - `WEB_PUBLIC_URL` → `https://app.ustow-aiconnect.com`
   - `NEXT_PUBLIC_API_URL` → `https://api.ustow-aiconnect.com`
   - `NEXT_PUBLIC_WS_URL` → `https://api.ustow-aiconnect.com`

   Both services redeploy automatically.

5. Update the Thinkrr Knowledge Pack URL — see §13.

## 11. Smoke test after every deploy

`scripts/post-deploy-smoke.sh` hits the production URLs and fails fast on
the first non-200. Run it after the dashboard shows both services as
"ACTIVE":

```
API_URL=https://api.ustow-aiconnect.com \
WEB_URL=https://app.ustow-aiconnect.com \
TENANT_ID=00000000-0000-0000-0000-000000000001 \
  bash scripts/post-deploy-smoke.sh
```

Defaults to the Railway-generated subdomains when those env vars are unset.

## 12. Rollback

Every deploy on Railway is preserved as an immutable snapshot.

1. Open the affected service → **Deployments**.
2. Find the last good deploy (look for the green check + matching git
   commit SHA).
3. Click the **⋯** menu → **Redeploy**. Railway promotes the prior image
   instantly; no rebuild required.
4. If the rollback was caused by a bad migration, also roll the DB forward
   manually — Drizzle does not auto-down migrations. Add a new migration
   that reverses the broken one and deploy it.

## 13. Switching Thinkrr from ngrok to production

Pre-cutover (current state): Thinkrr's agent has a Knowledge Pack URL
pointing at a rotating `https://<id>.ngrok.app/public/knowledge/<tenant>/profile.md`.

Cutover:

1. Confirm the production API answers the same URL pattern:

   ```
   curl -fsSL \
     https://api.ustow-aiconnect.com/public/knowledge/00000000-0000-0000-0000-000000000001/profile.md
   ```

   Should return a Markdown body starting with `# Roadside Towing`.

2. In the Thinkrr dashboard for agent **15206**, edit the Knowledge Pack
   URL to the production URL above.
3. Same Thinkrr screen: change the webhook URL from the ngrok hostname to
   `https://api.ustow-aiconnect.com/webhooks/thinkrr/<THINKRR_WEBHOOK_SECRET>/call-completed`.
4. Re-issue a test call from Thinkrr's "Test Agent" UI. Verify the agent
   loads the new Knowledge Pack (Thinkrr logs include the response body
   hash) and that the call-completed webhook lands in the API logs
   (`railway logs --service api`).
5. Once the test call succeeds, **stop the ngrok process locally** — the
   only thing keeping it alive was the Thinkrr integration.

If the production URL fails, do not flip the webhook — leave Thinkrr on
ngrok until the smoke test in §11 passes.

## 14. Health endpoint contracts

```
GET /health
200 OK
{ "status": "ok", "timestamp": "2026-05-23T10:11:12.345Z" }
```

```
GET /health/ready
200 OK
{
  "status": "ready",
  "checks": {
    "db": { "ok": true, "latencyMs": 4 },
    "redis": { "ok": true, "latencyMs": 1 }
  }
}

503 Service Unavailable (any check failing)
{
  "status": "not_ready",
  "checks": {
    "db": { "ok": false, "error": "connect ECONNREFUSED ..." },
    "redis": { "ok": true, "latencyMs": 1 }
  }
}
```

```
GET /api/health   (web service)
200 OK
{ "status": "ok" }
```

## 15. Operational checklist

Run through this list before declaring "we're live":

- [ ] Both services show **ACTIVE** in Railway with green healthchecks.
- [ ] `scripts/post-deploy-smoke.sh` exits 0.
- [ ] Thinkrr Knowledge Pack URL has been flipped (§13).
- [ ] `railway logs --service api` shows the 60-second job poller cycling
      without errors.
- [ ] A test call placed through Thinkrr loads the new Knowledge Pack and
      lands a `webhook-receiver` log line.
- [ ] `https://app.ustow-aiconnect.com/admin` loads and lists Roadside
      Towing as the default tenant.
- [ ] The Sentry dashboard (if `SENTRY_DSN` is set) shows the deploy as a
      new release with zero error events.
