# Railway deployment topology

This directory captures the production deployment shape on
[Railway](https://railway.app). The full step-by-step runbook for setting up
each piece lives in `docs/DEPLOY_RAILWAY.md`; this file is the
quick-reference for "what services exist and how do they talk to each other".

## Services

| # | Name                | Type             | Image / build              | Public? |
|---|---------------------|------------------|----------------------------|---------|
| 1 | `api`               | App (Dockerfile) | `packages/api/Dockerfile`  | yes     |
| 2 | `web`               | App (Dockerfile) | `packages/web/Dockerfile`  | yes     |
| 3 | `postgres`          | Railway plugin   | `postgres:16` (managed)    | no      |
| 4 | `redis`             | Railway plugin   | `redis:7` (managed)        | no      |

Service definitions are declared in the root `railway.toml`. Each app service
points at its package's Dockerfile and runs the production start command;
Railway's GitHub integration handles the actual build + deploy.

## Networking

```
                  Internet
                     |
   ┌─────────────────┴─────────────────┐
   │                                   │
   ▼                                   ▼
 app.<domain>                       api.<domain>
   │                                   │
   │    HTTPS                          │   HTTPS (browser & Thinkrr & Twilio)
   ▼                                   ▼
 ┌───────┐    fetch ${NEXT_PUBLIC_API_URL}/...   ┌───────┐
 │  web  │ ─────────────────────────────────────▶│  api  │
 └───────┘                                       └───┬───┘
                                                    │ private
                            ┌───────────────────────┤
                            │                       │
                            ▼                       ▼
                       ┌─────────┐             ┌─────────┐
                       │ postgres│             │  redis  │
                       └─────────┘             └─────────┘
```

- The `api` service connects to Postgres and Redis using Railway's **private
  network URLs** (`postgres.railway.internal`, `redis.railway.internal`),
  injected into the API container as `DATABASE_URL` / `REDIS_URL` via Railway
  variable references.
- The `web` service talks to the `api` service over the **public** API URL
  (because the browser also needs the same URL), set as `NEXT_PUBLIC_API_URL`
  on the web service.
- Until a custom domain is attached, both `api` and `web` are reachable at
  their auto-generated `*.up.railway.app` subdomains. The runbook in
  `docs/DEPLOY_RAILWAY.md` covers the CNAME flip to
  `api.ustow-aiconnect.com` / `app.ustow-aiconnect.com`.

## Build & deploy

- **CI:** push to `main` triggers `.github/workflows/deploy.yml` which runs
  type checks + tests. Railway's GitHub app watches the same branch and
  builds + deploys the API and web services on every successful push. No
  Railway tokens live in GitHub Secrets — auth is the Railway GitHub app.
- **Migrations:** the API container runs `pnpm --filter @ustow/api run
  db:migrate` as its pre-deploy command, configured in `railway.toml`.
  Migrations are idempotent (drizzle's migrator skips already-applied SQL).
- **Health checks:** Railway is configured to hit `GET /health/ready` on the
  API and `GET /api/health` on the web service; Railway only promotes a
  build after the healthcheck returns 200.

## Local equivalents

| Production           | Local dev                                         |
|----------------------|---------------------------------------------------|
| `api` service        | `pnpm dev:api` on `:3001`                         |
| `web` service        | `pnpm dev:web` on `:3000`                         |
| `postgres` plugin    | `docker-compose up postgres` on `:5433`           |
| `redis` plugin       | `docker-compose up redis` on `:6380`              |
| `api.<domain>` ingress | `ngrok http 3001` (temporary public URL)        |

See `docker-compose.yml` for the local Postgres / Redis containers.
