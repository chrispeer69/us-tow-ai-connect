# Rate Limiting

Session 26 (Bundle B section 1). Global Redis-backed throttle guard applied
to every HTTP request through the API. Failures emit `429 Too Many
Requests` with a `Retry-After` header and a JSON body `{ status: "error",
code: "RATE_LIMITED", message: "Too many requests" }`.

## Tiers

| Group       | Limit          | Window | Identifier                              | Routes                                                         |
|-------------|----------------|--------|-----------------------------------------|----------------------------------------------------------------|
| `public`    | 60 req / min   | 60 s   | client IP                               | `/health`, `/public/*`, `/track/*`                             |
| `tenant_api`| 120 req / min  | 60 s   | tenant API-key prefix (12 chars)        | `/v1/ai-connect/*`, `/v1/driver/*`, `/v1/partner/*`            |
| `admin`     | 600 req / min  | 60 s   | `x-tenant-id` header (jwt later)         | `/v1/admin/*`                                                  |
| `webhook`   | 600 req / min  | 60 s   | client IP                               | `/webhooks/*`                                                  |

Tier resolution is purely path-based — see `throttle-tiers.ts:resolveEndpointGroup`.
Anything that doesn't match a tier is **not throttled** (websocket upgrades,
internal cron triggers).

## Response headers

Every throttled request — and every allowed request that passed through —
gets:

- `X-RateLimit-Limit` — the tier's limit
- `X-RateLimit-Remaining` — limit minus the in-window count (floored at 0)
- `X-RateLimit-Group` — `public` | `tenant_api` | `admin` | `webhook`
- `Retry-After` — seconds until the window resets (only on 429)

## Per-tenant override

To bump a tier for a single tenant (or single API key), set the override
key in Redis directly:

```
SET throttle:override:tenant_api:usk_a1b2c3d4 240 EX 86400
```

The guard reads `throttle:override:{group}:{identifier}` before each request
and uses the override value as the limit when present. There is no TTL
enforcement in code — set EX yourself when staging a temporary lift.

The admin API exposes a thin write-through at
`POST /v1/admin/system/limits` (Section 4) for tenant operators.

## Failure modes

- **Redis unreachable** — the guard logs a warning and lets the request
  through. We prefer false negatives (a request that should have been
  throttled) to a complete outage when Redis flaps. The readiness probe
  (`/health/ready`) already reports Redis status, so a real outage is
  visible to operators.
- **Identifier missing** — the guard falls back to IP. An unauthenticated
  request to `/v1/ai-connect/*` therefore counts against IP, not against
  any tenant.

## Statistics archive

The hot-path counters live in Redis (`throttle:{group}:{identifier}` and
`throttle:stats:{epoch}:{group}:{identifier}`). Every 5 min,
`RateLimitStatsService` scans for closed 5-minute windows and upserts them
into `api_key_usage_stats` (Postgres). Use that table for billing-grade
reporting; treat Redis as ephemeral.

Schema:

```sql
api_key_usage_stats (
  id, tenant_id, api_key_id, identifier, endpoint_group,
  request_count, throttled_count, window_start, created_at
)
```

Tenant + key attribution is best-effort. Requests authenticated with a
known prefix are attributed to the matching tenant; IP-only requests have
NULL tenant_id.

## Adding a new route

If the new path falls under one of the four existing prefixes
(`/v1/ai-connect/*` etc.) you don't need to do anything — the guard
auto-buckets it.

If you're introducing a new prefix (`/v1/something/...`), edit
`throttle-tiers.ts:resolveEndpointGroup` to map it to the right group.

## Testing

```
pnpm --filter @ustow/api test src/modules/rate-limiting
```

The vitest suite simulates 200 sequential public requests against a real
Redis (or the in-memory mock used in CI) and asserts the 60-request cutoff
and the `Retry-After` header are correct.
