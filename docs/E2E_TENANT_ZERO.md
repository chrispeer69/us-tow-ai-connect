# E2E_TENANT_ZERO — Tenant-zero end-to-end smoke harness

Black-box smoke that exercises the tenant-zero pipeline:
**inbound call (Thinkrr webhook) → API ingestion → agent dispatch-request → ETA → flip-accept SMS → audit trail.**
Catches regressions before a production deploy.

- Harness: `scripts/smoke/tenant-zero-e2e.ts`
- Post-deploy gate: `scripts/smoke/post-deploy-smoke.sh`
- Results: `docs/diagnostics/smoke-<YYYYMMDD-HHMMSS>.json`
- Tenant-zero: `00000000-0000-0000-0000-000000000001`

## How to run

The harness is dependency-free (global `fetch` + node builtins). `tsx` is a
devDependency of `@ustow/api`, so invoke it through that workspace.

**Local dev** (full flow — needs a booted stack on :3001):
```bash
SMOKE_BASE_URL=http://localhost:3001 \
TENANT_API_KEY=usk_xxxxx \
THINKRR_SECRET=dev-secret \
  pnpm --filter @ustow/api exec tsx scripts/smoke/tenant-zero-e2e.ts
```

**Production** (read-only — only GETs, no key, no mutations):
```bash
SMOKE_BASE_URL=https://ustowapi-production.up.railway.app \
  pnpm --filter @ustow/api exec tsx scripts/smoke/tenant-zero-e2e.ts --prod-readonly
```

> Note: `pnpm tsx <path>` from the repo root does **not** resolve — `tsx` lives
> only in `@ustow/api`'s `node_modules`. Use the `--filter @ustow/api exec`
> form above (logged in `docs/sessions/S42_DECISIONS.md`).

### Environment variables
| Var | Default | Purpose |
|-----|---------|---------|
| `SMOKE_BASE_URL` | `http://localhost:3001` | API base URL |
| `TENANT_ID` | tenant-zero UUID | tenant under test |
| `TENANT_API_KEY` | _(empty)_ | enables tenant-keyed steps (S7, S8, S10) |
| `THINKRR_SECRET` | `dev-secret` | URL-secret for the Thinkrr webhook |
| `SMOKE_APPROVER_PHONE` | `+15005550006` | flip-accept approver (Twilio magic test #) |
| `SMOKE_TIMEOUT_MS` | `15000` | per-request timeout |
| `SMOKE_DECISION_POLL_MS` | `30000` | decision-poll window |
| `SMOKE_VERBOSE` | _(unset)_ | print detail on PASS too |
| `NO_COLOR` | _(unset)_ | disable ANSI color |

### Output & exit code
- Color-coded `PASS` / `FAIL` / `SKIP` per step, per-step ms, total runtime.
- Exit `0` if **no** step FAILed; exit `1` if any FAILed. **SKIP never fails.**
- A JSON report is written to `docs/diagnostics/smoke-<ts>.json`.

## SKIP vs FAIL discipline
- **SKIP** = a *precondition* is documented and absent: prod-readonly mode skips
  mutating/keyed endpoints; `TENANT_API_KEY` unset skips keyed steps; no
  decision-eligible job exists to drive the engine.
- **FAIL** = an action ran and the expected effect is missing (e.g. posted a
  request but no decision appeared, or an endpoint 500s).

Prod-readonly's narrowness must **not** leak into the local full-flow's
tolerance — that's the whole point of the harness.

## Step plan

| ID | Step | Method / path | Mode | Expected | Notes |
|----|------|---------------|------|----------|-------|
| S1 | Liveness | `GET /health` | both | 200 `{status:"ok"}` | |
| S2 | Readiness | `GET /health/ready` | both | 200 `{status:"ready"}`, db+redis ok | sms may be unconfigured in prod |
| S3 | Knowledge pack | `GET /public/knowledge/<tz>/profile.md` | both | 200, body starts `#` | v2 JSON returns 404 NOT_PUBLISHED for tenant-zero (informational) |
| S4 | Audit baseline | `GET /v1/admin/audit-log` | both | 200, capture `total` | `x-tenant-id` header; baseline for S11 delta |
| S5 | Decisions list | `GET /v1/admin/digital-dispatch/decisions` | both | 200, `items[]` | **Currently 500 in prod — see S42_BLOCKERS.md** |
| S6 | Inbound call (intake) | `POST /webhooks/thinkrr/<secret>/call-completed` | full | 200/201 | the real "intake"; brief's `/v1/ai-connect/intake` does not exist |
| S7 | Agent dispatch | `POST /v1/ai-connect/dispatch-request` | full + key | 201, `data.id` | persists to `dispatch_requests` |
| S8 | ETA | `GET /v1/ai-connect/eta?lat&lng` | full + key | 200, `eta_minutes ≤ 60` | default 45 when no driver pings |
| S9 | Decision poll | `GET …/decisions` (≤30s) | full | shape if present, else SKIP | intake does not synchronously feed the engine — see S42_BLOCKERS.md |
| S10 | Flip-accept | `POST /v1/flip-accept/request` → `POST /webhooks/twilio/sms-inbound` (YES) → `GET /v1/flip-accept/history` | full + key | history status flips to approved | Twilio sig skipped in dev / when `TWILIO_AUTH_TOKEN` unset |
| S11 | Audit delta | `GET /v1/admin/audit-log` | full | `total - baseline ≥ 3` | |
| S12 | Cleanup | — | full | SKIP | no black-box delete; rows tagged `SMOKE-E2E <runId>` for manual purge |

## Endpoint reality vs. the original brief
The brief assumed a few endpoints that don't exist as written. The harness uses
the real surface (verified against `packages/api/src/modules/**`):

| Brief said | Reality |
|------------|---------|
| `POST /v1/ai-connect/intake` | no such route — inbound call = `POST /webhooks/thinkrr/<secret>/call-completed` |
| job persisted in `unified_jobs`, returns `job_id` | `dispatch-request` persists to `dispatch_requests`, returns `data.id`. `unified_jobs` is fed by adapter ingestion, not the public intake |
| `POST /v1/ai-connect/eta` | it's a **GET** with `lat`/`lng` query params |
| decision auto-fires from intake | decisions are produced from adapter-ingested `unified_jobs`, not synchronously from a webhook/dispatch-request (S9 SKIPs) |

## Authentication
- **Public**: `/health*`, `/public/knowledge/*` — none.
- **Admin GETs** (`/v1/admin/*`): `x-tenant-id: <uuid>` header (dev-trust), or
  `Authorization: Bearer <jwt>`, or `DEFAULT_ADMIN_TENANT_ID` env. The harness
  uses `x-tenant-id`.
- **Tenant-keyed** (`/v1/ai-connect/*`, `/v1/flip-accept/*`):
  `x-tenant-api-key: <key>` — mint via `/v1/admin/api-keys`.
- **Twilio webhook**: `x-twilio-signature`; skipped when `TWILIO_AUTH_TOKEN`
  unset or `NODE_ENV=test`.

## Troubleshooting
- **S2 FAIL `db=false`/`redis=false`** — stack not fully up; check
  `docker-compose up` and migrations.
- **S4/S5 401** — `x-tenant-id` rejected; ensure it's a valid UUID, or set
  `DEFAULT_ADMIN_TENANT_ID` on the server.
- **S5 500** — known prod issue; decisions list throws (likely the
  `innerJoin` on `unified_jobs`/`dispatch_rules` against empty/partial data).
  Tracked in `docs/sessions/S42_BLOCKERS.md`; fix belongs to the digital-dispatch owner.
- **S7/S8/S10 SKIP** — `TENANT_API_KEY` not set. Mint one and re-run.
- **S9 SKIP** — expected black-box: nothing creates a decision-eligible
  `unified_job` from the public intake path within the window.
- **S11 FAIL delta<3** — audit logging is best-effort and never blocks its
  parent request; if a mutation step also FAILed, fewer entries are written.

## Post-deploy gate
`scripts/smoke/post-deploy-smoke.sh` runs the harness in `--prod-readonly` and
exits non-zero on any FAIL. Wire it after a Railway deploy:
```bash
SMOKE_BASE_URL=https://ustowapi-production.up.railway.app \
  bash scripts/smoke/post-deploy-smoke.sh
```
Run it from CI after `railway up` reports healthy, or as a Railway
post-deploy command. It complements the existing lightweight
`scripts/post-deploy-smoke.sh` HTTP probes (left untouched).
