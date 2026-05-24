# S45 — Members + Roles RBAC — Decisions

Owner unavailable until PR open (CLAW.md). Every non-obvious call logged here. Additive.

## Reconciliation with existing code (recon findings)

- **`tenant_members` already exists** (migration `0002`) and is written by
  `tenant-onboarding.service.ts` (`role: 'OWNER'`, `status: 'ACTIVE'`) and read by
  `partner.service.ts` + a legacy CRUD in `admin.controller/service`.
  **Decision:** evolve `tenant_members` in place — do NOT create a parallel `members`
  table. A second table would split the source of truth and break onboarding/partner.
  → Migration named `0022_members_rbac.sql` per spec; it `ALTER`s `tenant_members`.

- **Legacy members CRUD lived in `admin.controller.ts` + `admin.service.ts`** at the
  exact routes the spec assigns to this session (`/v1/admin/members`). NestJS silently
  *shadows* duplicate route handlers (first registered wins), so leaving them would make
  the new controller dead code.
  **Decision:** remove the legacy handlers + their service methods + now-unused schema
  imports, and re-implement (with the good last-owner / dedupe logic ported) in the new
  `members` module. `admin.controller/service` are not in OWNED paths but not in
  DO-NOT-TOUCH; touching them is necessary to avoid a silently broken route.

- **Migration slot:** last applied is `0021`. Next free slot is **`0022`** (spec hedged
  "could be 0023" — verified it is 0022).

## Schema decisions

- **Role casing = UPPERCASE** (`OWNER, DISPATCHER, DRIVER, ACCOUNTING, VIEWER`).
  *Spec wrote them lowercase.* **Deviation, deliberate:** existing rows are uppercase and
  the onboarding writer (out of scope, not touched) inserts `'OWNER'`/`'ACTIVE'`. Matching
  the established casing keeps that writer valid against the new CHECK constraint.
  Rejected alternative: lowercase everywhere + adapter on the onboarding writer — rejected
  because onboarding is out of scope and changing it widens blast radius.
- **Status casing = UPPERCASE** (`INVITED, ACTIVE, SUSPENDED`) for the same reason.
- **`varchar(20)` + CHECK constraint, not Postgres `ENUM`.** Repo has zero `pgEnum` usage
  (convention is varchar + zod validation). `ALTER TYPE` on an in-use column with an
  existing default is risky; CHECK gives the same guarantee and matches convention.
  "enum" in the spec read as "enumerated allowed set."
- **Columns added to `tenant_members`:** `invited_by`, `accepted_at`, `last_login_at`,
  `invite_token`, `invite_token_expires_at`. Spec listed `user_email` and `last_login_at`;
  mapped `user_email` → existing `email` column (already indexed + referenced everywhere);
  added `last_login_at` as a new column distinct from the existing `last_active_at`
  (left intact to avoid breaking current readers).
- **`role` column default changed `'MEMBER'` → `'VIEWER'`** (least privilege). `MEMBER` is
  being dropped from the allowed set, so the old default would violate the new CHECK.
- **Legacy data migration** (runs BEFORE the CHECK is added, per migration ordering):
  `ADMIN → OWNER` (preserve full access, avoid lockout), `MEMBER → VIEWER` (least
  privilege). `OWNER`/`VIEWER` unchanged. This honours "existing single-user model
  migrates as owner."

## RBAC enforcement design

- **Identity gap:** `AdminAuthGuard` attaches only `req.tenantId` — no user email. RBAC
  needs the caller. Resolved (without touching the shared guard) by a `current-user`
  helper in the members module: JWT `email`/`sub` claim → `x-user-email` header →
  `DEFAULT_ADMIN_USER_EMAIL` env.
- **`PermissionGuard` + `@RequirePermission('resource.action')`** live in the OWNED
  `members/` module. Routes without the decorator are unaffected (guard returns true).
- **Fail-safe policy** (matches today's posture, no regression):
  - Identity resolvable (email present) → enforce: member's role must grant the permission
    (OWNER / `*` always passes); otherwise **403**. This is the real deny path and is
    demonstrable via `x-user-email`.
  - Identity absent → governed by **`RBAC_ENFORCE`** env (default `false`):
    `false` ⇒ allow (preserves legacy tenant-id-only dev/smoke flows), logs a debug line;
    `true` ⇒ fail closed (403).
  - Rationale: the existing auth layer trusts tenant-id-only requests as full admin (real
    JWT auth is an explicit future session per ASSUMPTIONS.md). Denying by default would
    break every existing admin flow + smoke tests. This design adds enforcement for the
    identified-user case without lowering the current baseline.

## Example enforcement (Task 7)

- Applied `@RequirePermission` to `digital-dispatch.controller.ts` (sanctioned by Task 7):
  `digital-dispatch.read` on GET routes, `digital-dispatch.write` on mutating routes.
  Full rollout across controllers is a follow-up session.

## Invite / accept flow (Task 8 — spec text was truncated at "accept-invi")

- Inferred endpoint: **`POST /v1/auth/accept-invite`** (the obvious completion). Hosted by
  an `AcceptInviteController` in the members module.
- **Invite token:** random `crypto.randomBytes(32)` hex stored in
  `tenant_members.invite_token` with a 7-day `invite_token_expires_at`. Self-contained —
  no JWT-secret dependency (impersonation HMAC service exists but is a different concern).
- Email sent via existing `SendGridEmailService`; if `SENDGRID_API_KEY` is unset it falls
  back to `logged_only` (its built-in behavior) — no hard dependency.

## Files touched outside OWNED paths (all necessary, none in DO-NOT-TOUCH)

- `packages/api/src/modules/admin/admin.{controller,service}.ts` — remove legacy members CRUD.
- `packages/api/src/db/schema.ts` — add columns + `role_permissions` table (Drizzle typing
  must mirror the SQL migration).
- `packages/api/src/db/migrations/meta/_journal.json` — append `0022` entry (this repo
  hand-maintains the journal; drizzle's migrator reads it to know which files to apply).
- `packages/api/src/app.module.ts` — register `MembersModule`.
- `packages/api/src/modules/digital-dispatch/digital-dispatch.{controller,module}.ts` —
  Task 7 example enforcement + import MembersModule for guard DI.

## Security note

- `invite_token` is a bearer credential (it authorizes `accept-invite`). The service
  redacts it from every API response (`list`, `me`, `invite`, `update`, `accept`). It is
  only read internally by the guard (role/status) and the accept flow.
- Public `POST /v1/auth/accept-invite` reachability verified against the global
  `AdminIpAllowListGuard`: it short-circuits to `allow` both when `req.tenantId` is unset
  (this route has no `AdminAuthGuard`) and when the path doesn't start with `/v1/admin/`.
  So invitees hitting it from arbitrary IPs are not blocked. No change needed there.

## Validation performed (no DB in CI for this worktree, so done locally)

- `pnpm --filter @ustow/api build` (tsc + nest build) → clean.
- `pnpm --filter @ustow/web exec tsc --noEmit` → clean.
- Full API vitest suite → 191/191 pass (unchanged) + 7 new `permission.guard.spec.ts` cases
  covering the fail-safe matrix (no-metadata, no-identity×RBAC_ENFORCE, non-member,
  inactive, lacks-permission, granted).
- Migration applied end-to-end against a throwaway Postgres DB:
  - 5 new `tenant_members` columns present; `role` default now `'VIEWER'`.
  - `role_permissions` seeded exactly (OWNER 1=`*`, DISPATCHER 10, ACCOUNTING 5, VIEWER 3,
    DRIVER 2 = 21 rows).
  - Both CHECK constraints present; onboarding values `OWNER`/`ACTIVE` accepted, omitted
    role defaults to `VIEWER`, dropped role `MEMBER` rejected.
  - Legacy-data mapping replayed: `ADMIN→OWNER`, `MEMBER→VIEWER`, unknown→`VIEWER`; the
    CHECK re-adds cleanly afterward.
- Note: repo `lint` script (`biome check .`) is not runnable locally — biome is not a
  dependency or global here and there's no biome.json; CI provides it. tsc is the
  meaningful local gate and passes.

## Follow-ups (not in scope this session)

- Real JWT verification + user identity on `AdminAuthGuard` (already flagged in
  ASSUMPTIONS.md) — until then RBAC enforces only when an email is resolvable.
- Roll `@RequirePermission` out across the remaining admin controllers.
- A web `/accept-invite` page to consume the emailed token (API endpoint exists).
- Flip `RBAC_ENFORCE=true` once identity is wired everywhere.
