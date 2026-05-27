# S64 — Web /accept-invite page — Blockers / Follow-ups

Owner unavailable until PR open. These need a future session (API-owning) to close.

## 1. No password / credential setup endpoint

**Brief:** form should collect a password, POST it with the accept request.
**Reality:** `POST /v1/auth/accept-invite` accepts only `{ token, email? }` (see `packages/api/src/modules/members/members.dto.ts:25-29`). The endpoint flips `tenant_members.status` to `ACTIVE`; no credential is created.

**Impact:** invitees cannot set a password through the web flow today. The page does **not** collect one (would be misleading — see S64_DECISIONS.md).

**Follow-up:** API session to (a) extend `AcceptInviteSchema` with `password` (min 8, complexity), (b) hash + store on a `users` table or `tenant_members.password_hash`, (c) return a session cookie. Web client already submits `name` in the request body in anticipation; add `password` the same way once the schema accepts it.

## 2. No invite-preview endpoint

**Brief:** show "You've been invited by <inviter> to join <tenant> as <role>."
**Reality:** no `GET /v1/auth/invite-preview` (or similar). The invite token is bearer-only — there's no read path that returns tenant / role / inviter without consuming the token.

**Impact:** the form shows neutral copy ("You've been invited") with no tenant or role details until the user submits.

**Follow-up:** API session to add `GET /v1/auth/accept-invite?token=...` returning `{ tenantName, role, inviterName, expiresAt }` without flipping status. Web client has a graceful no-data path — wiring the preview is a copy-only update.

## 3. "Already accepted" cannot be distinguished from "invalid"

On accept, the server nulls `invite_token`. A second visit with the same token gets `404 INVALID_TOKEN` — indistinguishable from a never-existed token. Web copy says "invalid" in both cases.

**Follow-up:** API could keep the token row with a `consumed_at` timestamp (instead of nulling), and return a dedicated `ALREADY_ACCEPTED` code with a 410. Web is wired to handle a 410 specifically; today that branch is unreachable.

## 4. No `/login` route

The "already accepted" copy would normally link to sign-in. There's no `/login` page in `packages/web/src/app/**`. Linking instead to `/admin/integrations`, which is also the success redirect destination.

**Follow-up:** when an auth flow exists, swap the link target.

## 5. No session established by accept

After 1.5s the page redirects to `/admin/integrations`. The invitee has no session cookie / JWT — they will hit whatever admin auth posture is in effect (RBAC_ENFORCE governs).

**Follow-up:** ties into blocker #1 — once accept-invite issues a session, the redirect lands a usable dashboard.
