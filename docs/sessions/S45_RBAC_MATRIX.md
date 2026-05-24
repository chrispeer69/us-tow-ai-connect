# S45 — RBAC Permission Matrix

Authoritative role → permission map. Seeded into `role_permissions` by
`packages/api/src/db/migrations/0022_members_rbac.sql` and mirrored in
`packages/api/src/modules/members/permissions.ts`.

## Roles

Stored UPPERCASE in `tenant_members.role` (see S45_DECISIONS.md for the casing
rationale). Allowed set enforced by the `tenant_members_role_check` constraint.

| Role | Summary |
|------|---------|
| `OWNER` | Full access. Represented by the wildcard permission `*`. |
| `DISPATCHER` | Operational surfaces: command center, digital dispatch, live drivers, SMS log, calls. |
| `DRIVER` | Driver portal only — **not** the admin dashboard. |
| `ACCOUNTING` | Billing + reports; audit log read. |
| `VIEWER` | Read-only on a small surface. |

## Permission keys

Format: `<resource>.<action>` where `action ∈ { read, write }`. A `write` grant
does **not** imply `read` — both are seeded where a role needs both. `OWNER`
holds the single wildcard `*`, which matches every key.

| Permission key | OWNER | DISPATCHER | DRIVER | ACCOUNTING | VIEWER |
|----------------|:-----:|:----------:|:------:|:----------:|:------:|
| `*` (wildcard) | ✅ | | | | |
| `command-center.read` | ✅ | ✅ | | | ✅ |
| `command-center.write` | ✅ | ✅ | | | |
| `digital-dispatch.read` | ✅ | ✅ | | | |
| `digital-dispatch.write` | ✅ | ✅ | | | |
| `drivers-live.read` | ✅ | ✅ | | | |
| `drivers-live.write` | ✅ | ✅ | | | |
| `sms-log.read` | ✅ | ✅ | | | |
| `sms-log.write` | ✅ | ✅ | | | |
| `calls.read` | ✅ | ✅ | | | |
| `calls.write` | ✅ | ✅ | | | |
| `driver-portal.read` | ✅ | | ✅ | | |
| `driver-portal.write` | ✅ | | ✅ | | |
| `billing.read` | ✅ | | | ✅ | |
| `billing.write` | ✅ | | | ✅ | |
| `reports.read` | ✅ | | | ✅ | ✅ |
| `reports.write` | ✅ | | | ✅ | |
| `audit-log.read` | ✅ | | | ✅ | |
| `integrations.read` | ✅ | | | | ✅ |

## Enforcement

- Generic `PermissionGuard` + `@RequirePermission('resource.action')` decorator.
- A route with no `@RequirePermission` metadata is unaffected.
- Resolution: caller email (JWT `email`/`sub` → `x-user-email` → `DEFAULT_ADMIN_USER_EMAIL`)
  → member row → role → matrix.
- `OWNER` / `*` always passes. Identified user lacking the key → `403`.
- Identity absent → governed by `RBAC_ENFORCE` (default `false` ⇒ allow; `true` ⇒ deny).
- Example enforcement applied to `digital-dispatch.controller.ts` this session
  (`digital-dispatch.read` on GET, `.write` on mutations). Full rollout is a follow-up.
