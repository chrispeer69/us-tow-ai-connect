# S29 — Decisions (VAPID push notifications)

Additive log. Owner unavailable until PR open; calls made per CLAW.md.

## D1 — Reuse existing `driver_push_subscriptions` table, not a new `push_subscriptions`
Session 25 already shipped `driver_push_subscriptions` (migration 0011): `id, tenant_id,
driver_phone, endpoint, p256dh_key, auth_key, user_agent, created_at, last_seen_at`,
unique `(tenant_id, endpoint)` → already multi-device. Creating the spec's parallel
`push_subscriptions` table keyed on `driver_id` would fragment data and duplicate persistence.
**Call:** reuse the existing table. The new `push` module owns *delivery* (VAPID/web-push),
which was the genuinely missing capability (Session 25 deferred sending).

## D2 — Key delivery by driver phone (codebase identity), resolve id→phone
Drivers are identified by **phone** everywhere (`driver_pings`, `driver_locations`,
`driver_push_subscriptions`). `unified_jobs.assigned_driver_id` is a uuid → `drivers.id`,
and `drivers.phone` maps to the subscription's `driver_phone`. **Call:** `sendToDriver`
accepts the driver uuid, looks up `drivers.phone`, then fans out to all subscriptions for
that phone. Spec's "sendToDriver(driverId)" honored at the API; phone is the storage key.

## D3 — Migration 0020 (next free), not 0021
0019 is the latest committed migration; 0020 is next free. Spec said "0021 or next free".
**Call:** `0020_push_last_used.sql` — additive `last_used_at timestamptz` column for tracking
last successful push (distinct from `last_seen_at` = last subscribe/refresh). `IF NOT EXISTS`.

## D4 — New `modules/push/**`; leave Session 25's driver-pings push code intact
Old `POST /v1/driver/push/subscribe` (driver-pings) stays for backward compat. New module
adds the spec'd `/v1/driver-push/{subscribe,unsubscribe,vapid-public-key}` plus delivery.
Minor endpoint duplication accepted over editing a module I don't own. New endpoints are the
canonical ones (delivery-wired).

## D5 — web-push as runtime dependency (spec said `-D`)
web-push is imported at runtime by the API → must be a regular dependency, not dev.
`@types/web-push` is dev. **Call:** `dependencies: web-push`, `devDependencies: @types/web-push`.

## D6 — Assignment hook is fire-and-forget
`command-center.service.ts assignJob()` sets `assigned_driver_id`. Added a fire-and-forget
`PushService.sendToDriver(...).catch(log)` after the DB write so push failure never blocks
assignment. PushModule wired into CommandCenterModule.

## D7 — VAPID keys never committed
Keys live in `docs/sessions/S29_OPERATOR_TODO.md`, added to `.gitignore`. Send is a no-op
(with warning) when `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` unset → safe to deploy pre-config.

## D8 — Service worker reused
`packages/web/public/driver-sw.js` already exists; added `push` + `notificationclick`
handlers additively rather than introducing a second SW file. Tap → `clients.openWindow(url)`.
