# S64 — Web /accept-invite page — Decisions

Owner unavailable until PR open (CLAW.md). Every non-obvious call logged here.

## Recon — what already exists

- **POST `/v1/auth/accept-invite`** (S45) accepts `{ token, email? }`. Path is **not** parameterized — body carries the token. The brief said `/v1/auth/accept-invite/:token`; we use the real contract.
- Server-side error shape (NestJS exception filter): `{ status, code, message }`. Codes encountered: `INVALID_TOKEN` (400 / 404), `TOKEN_EXPIRED` (403), `EMAIL_MISMATCH` (403).
- Email-bound URL from the invite email: `/accept-invite?token=<hex>&email=<urlencoded>` (see `members.service.ts → sendInviteEmail`). The email param is the disambiguator the server uses for `EMAIL_MISMATCH` checks.
- No GET `/v1/auth/invite-preview` exists — we cannot read the tenant name, inviter, or role before the user submits. Page renders neutral "You've been invited" copy until a richer endpoint lands.
- No `/login` route exists in `packages/web/src/app/**` — "already accepted" state cannot link to a sign-in page; we link to `/admin/integrations` instead (the post-accept destination) and the existing admin auth will gate as needed.

## Page structure

- **`accept-invite/page.tsx`** — server component; reads `searchParams.token` and `searchParams.email`; renders `AcceptInviteClient`. Async `searchParams` (Next 15 convention, mirrors `/track/[token]/page.tsx`).
- **`accept-invite/AcceptInviteClient.tsx`** — client component; owns form state, validation, submission, all UI states.
- **`accept-invite/layout.tsx`** — wraps the route in `OnboardingShell` so we reuse the alliance navbar + PoweredByFooter without duplicating shell markup. The `/onboarding` route already uses this shell exclusively; layout reuse keeps the visual language identical.
- **`accept-invite/loading.tsx`** — neutral alliance skeleton (no branding fetch needed pre-submit).
- **`accept-invite/error.tsx`** — alliance-themed boundary; reset button.

## API contract gap — name & password

The brief says "collects name + password, POSTs `/v1/auth/accept-invite/:token` with `{ name, password }`."
The real API (S45, frozen since merge) accepts only `{ token, email? }` and does **not** create login credentials — there is no auth layer wired through `/accept-invite`. Accepting an invite flips `tenant_members.status` INVITED → ACTIVE; nothing else.

**Decision — do NOT collect a password.** Showing a password field that is silently dropped server-side is a security trap (users will reuse credentials thinking they're protected). Build the page honest to today's contract. Per CLAW.md: pick the conservative path, document, continue.

- Form collects: **full name** (optional cosmetic), **continue** button.
- Submit sends `{ token, email, name? }`. The `name` field is currently stripped by `AcceptInviteSchema` (`z.object` defaults to strip-unknown); harmless and forward-compatible — when the API is extended (see S64_BLOCKERS.md), the same client code will populate it.
- Success copy explicitly tells the user "your administrator will follow up about sign-in" so we don't imply a credential was set.

## State coverage

| State | Trigger | Copy |
| --- | --- | --- |
| **Missing token** | no `token` in URL | "This invite link is incomplete. Ask your administrator to resend it." |
| **Submit form** | token present | name field + Accept button |
| **Invalid / not found** | API `404 INVALID_TOKEN` | "This invite is invalid. Contact your administrator." |
| **Already accepted** | API returns `404 INVALID_TOKEN` *after* flip (token cleared on accept) | Same as invalid; cannot disambiguate without API change. Documented gap. |
| **Expired** | API `403 TOKEN_EXPIRED` | "This invite expired. Ask an owner to send a new one." |
| **Email mismatch** | API `403 EMAIL_MISMATCH` | "This invite belongs to a different email." |
| **Generic 5xx / network** | fetch throws or non-2xx fallthrough | "Something went wrong. Try again in a moment." with retry |
| **Success** | 200/201 | Alliance check pop, "You're in." 1.5s timer → `/admin/integrations` |

## Visual

- Mirror `/onboarding` shell exactly (`OnboardingShell` already mounted as layout).
- Hero `PageHeader variant="hero"` with eyebrow "Invitation", title "You've been invited" (or branded variant if branding API ever returns tenant name pre-accept — today it does not without an authenticated session, so we keep neutral copy).
- Card with form. Reuse `Button`, `Card`, `Input`, `PageHeader`. No new primitives.
- Success uses the same `checkPop` keyframe + alliance green circle as `OnboardingClient → SuccessState` (reuses `onboarding.module.css`).
- Mobile breakpoint: shell already constrains to `max-w-3xl` and is mobile-first.

## Mobile breakpoints

- `sm` (640px): horizontal padding shifts from `px-5` → `px-8`; vertical padding `py-8` → `py-10` (inherited from `OnboardingShell`).
- The accept form has no multi-column layouts to break; all controls are full-width stacked.

## Stubbed / out of scope

- **Password setup** — not collected (see contract gap above). API enhancement filed in S64_BLOCKERS.md.
- **Invite preview** — no GET endpoint; we don't fetch tenant/role/inviter pre-submit. Filed in BLOCKERS.
- **Auto-login post-accept** — no session is established by `accept-invite`. The 1.5s redirect to `/admin/integrations` will hit the admin auth layer; behavior there is governed by S45's `RBAC_ENFORCE` posture and is out of scope here.
- **`name` field server-side persistence** — sent in the request body, silently stripped by the Zod schema today. Forward-compatible no-op.
