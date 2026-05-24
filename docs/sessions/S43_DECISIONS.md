# S43 — /track/[token] white-label verification + polish — DECISIONS

Session: 43 · Branch: `session/43-track-whitelabel` · Worktree: `~/Documents/usw-track`
Owner unavailable until PR open (per CLAW.md). Decisions logged additively.

## Context discovered
- Public tracking contract: `GET /v1/tracking/:token` → `{ status, data: TrackingStatusView }`.
- `TrackingStatusView` fields: `caller_name, status, assigned_driver_name, last_eta_minutes,
  pickup_lat, pickup_lng, driver_lat, driver_lng, expires_at, expired, caller_phone_last4`.
- Public branding endpoint EXISTS: `GET /branding/public/:tenantId` (no auth) → `BrandingBody`
  (`companyDisplayName, logoUrl, primaryColor, secondaryColor, accentColor, fontFamily,
  supportPhone, supportEmail, hidePoweredBy, ...`).
- Existing client hardcodes tenant "Roadside Towing" + dispatch phone `+17408129489`.

## Blockers — require API change (packages/api is NOT owned by this session)
Documented here per CLAW.md (cannot edit docs/BLOCKERS.md — not owned). Hand off to API session.

1. **`tenant_id` not exposed in `TrackingStatusView`.** The caller page holds only the token;
   white-label branding cannot be resolved without a tenant id (or inline branding) in the
   public payload. **Conservative fix shipped frontend-side:** page consumes
   `data.branding` (inline) OR fetches `/branding/public/:tenant_id` when `data.tenant_id`
   is present; falls back to neutral defaults otherwise. **API TODO:** add `tenant_id`
   (and optionally inline `branding`) to `getPublicView()`.
2. **`assigned_driver_phone` not exposed** (correctly — raw PII). "Call driver" CTA is
   therefore unbuildable today. **Shipped:** CTA renders only if a call handle is present
   (`data.driver_call_url`). **API TODO:** add a masked/relay `driver_call_url`.

Until (1)/(2) land, the page renders correctly with neutral fallbacks; it lights up
automatically once the API includes the fields. No hardcoded US Tow / Roadside branding remains.

## Decisions
- **D1 — Worktree as git worktree.** `~/Documents/usw-track` created via `git worktree add`
  on `session/43-track-whitelabel` (sibling worktrees S44/S45 confirm parallel-agent setup).
- **D2 — Status normalization at the boundary.** API emits
  `created/driver_assigned/en_route/on_scene/completed/expired`; spec names are aliases.
  Normalize to one union; render off normalized state. Map:
  `queued←created|queued · dispatched←driver_assigned|dispatched · en_route←en_route ·
  on_scene←on_scene · complete←completed|complete · cancelled←cancelled|canceled ·
  expired←expired|expired=true`. Don't fabricate states the API never emits.
- **D3 — Branding scoped to track shell.** Do NOT import shared `BrandingProvider` (sets
  `:root` vars → violates "track shell only"). Mirror the fetch pattern in owned
  `components/track/TrackShell.tsx`; apply `--brand-*` via inline `style` on the wrapper div.
- **D4 — Fallback wordmark = "US Tow"** text when no `logoUrl`. Scrubbed hardcoded
  "Roadside Towing" + `+17408129489`. Footer: "Tracked by <CompanyName>"; platform
  attribution respects `hidePoweredBy`.
- **D5 — Refresh cadence 30s** per spec (was 10s). Minor reactivity regression vs prior; spec wins.
- **D6 — Reuse `components/ui` (Button/Card) read-only;** brand color applied via CSS vars only.
