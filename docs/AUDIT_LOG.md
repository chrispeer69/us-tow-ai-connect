# Audit Log

Session 26 (Bundle B section 2). Unified record of every mutating action
that lands against the API. Backs the `/admin/audit-log` screen and
compliance / forensics queries.

## What gets logged automatically

The global `AuditLogInterceptor` writes a row for every:

- HTTP method ∈ {`POST`, `PUT`, `PATCH`, `DELETE`}
- Path prefix ∈ {`/v1/admin/`, `/v1/ai-connect/`, `/v1/partner/`}

…unless the handler is annotated with `@SkipAudit()`. No module wiring or
service-layer change is required — adding a new admin endpoint
automatically inherits audit coverage.

For each captured request the interceptor stores:

- `actor_type` / `actor_id` — derived from the request:
  - tenant API-key prefix when `req.tenant.apiKeyPrefix` is set
    (`actor_type='api_key'`)
  - `x-tenant-id` header (`actor_type='user'`)
  - fallback `system / unknown` if neither is present
- `action` — either the value from `@AuditAction()` or `${method} ${path}`
- `resource_type` — from `@AuditAction('action', 'resource_type')`
- `resource_id` — first matching route param of `id`, `jobId`, `ruleId`,
  `memberId`
- `before_state` — `null` for the interceptor path (explicit
  `AuditLogService.record()` calls fill this)
- `after_state` — sanitized request body
- `metadata` — `{ method, path, status, durationMs, ip, userAgent,
  requestId, responseShape }`

On exception, the interceptor writes a row with `action='<base>.failed'`
and `metadata.status='error'` so failed attempts show up in the same query.

## Adding explicit `@AuditAction` calls

When the auto-derived action name is too generic, decorate the handler:

```ts
@AuditAction('credential.update', 'tenant_credentials')
@Post('credentials')
saveCredentials(...) { ... }
```

For domain-specific before/after pairs, inject `AuditLogService` and call
`record()` directly:

```ts
constructor(private readonly auditLog: AuditLogService) {}

async deactivateMember(id: string) {
  const before = await this.repo.get(id);
  await this.repo.deactivate(id);
  const after = await this.repo.get(id);
  await this.auditLog.record({
    tenantId, actorType: 'user', actorId,
    action: 'member.deactivate',
    resourceType: 'tenant_member', resourceId: id,
    before, after,
  });
}
```

Audit writes are best-effort; a failure inside `record()` logs at WARN and
does **not** propagate to the caller.

## Skipping audit

```ts
@SkipAudit()
@Post('credentials/test')
testConnection(...) { ... }
```

Use sparingly. Reserved for non-mutating probe endpoints that happen to be
`POST` (test connections, dry-runs, etc.).

## Retention

Configured per tenant via `tenants.audit_retention_days` (default 365). The
daily `AuditLogRetentionService` cron at 03:00 server-local prunes rows
older than that cutoff per tenant. Set the column to a different value to
adjust:

```sql
UPDATE tenants SET audit_retention_days = 730 WHERE id = '...';
```

## Sanitization

Before each write the interceptor / service walks the payload and replaces
sensitive values with `'[REDACTED]'`. The block-list includes any key
matching:

- exact: `password`, `token`, `accessToken`, `refreshToken`, `apiKey`,
  `secret`, `authorization`, `cookie`, `set-cookie`,
  `twilioAuthToken`, `sendgridApiKey`, `encryptionKey`
- substring: `*password*`, `*secret*`, `*apikey*`, `*ssn*`
- suffix: `*token` (except `csrfToken`)

The sanitizer recurses up to 8 levels deep; deeper structures are truncated.

## Querying the table

```sql
-- All credential updates in the last 24h
SELECT created_at, actor_id, action, resource_id, metadata->>'status' AS status
FROM audit_log
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND action LIKE 'credential.%'
  AND created_at > now() - interval '24 hours'
ORDER BY created_at DESC;

-- Failed dispatch decisions
SELECT created_at, actor_id, action, metadata->>'error'
FROM audit_log
WHERE action LIKE '%.failed'
  AND created_at > now() - interval '7 days';
```

Indexed columns: `(tenant_id, created_at DESC)`, `(actor_type, actor_id)`,
`(resource_type, resource_id)`, `(action, created_at DESC)`.

## API

`GET /v1/admin/audit-log` — paginated list, filterable:

| Query param   | Type    | Notes                                          |
|---------------|---------|------------------------------------------------|
| `actorType`   | enum    | user / api_key / system / ai_agent / adapter / webhook |
| `action`      | string  | exact match (`credential.update`)              |
| `resourceType`| string  | exact match (`tenant_credentials`)             |
| `resourceId`  | string  | exact match                                    |
| `from`/`to`   | ISO8601 | window of `created_at`                         |
| `page`/`limit`| int     | default 1/50, max limit 200                    |

Response:

```json
{
  "items": [ AuditLogRow, ... ],
  "total": 1234,
  "page": 1,
  "limit": 50
}
```

The `/admin/audit-log` web page consumes this endpoint; expanding a row
shows before / after / metadata JSON side-by-side.
