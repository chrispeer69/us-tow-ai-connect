# Driver App — Workflow Guide

The driver-facing PWA at `/driver` is the on-the-road counterpart to the
Command Center (`/admin/command-center`). It's mobile-first, GPS-driven,
and works through a Next.js BFF so the tenant API key never lives in
the browser.

## Quick start

1. From the truck's phone, open `https://{your-tenant-host}/driver`.
2. Tap **Profile** (bottom nav, 👤).
3. Enter your **name** and **E.164 phone** (e.g. `+17408129489`). Pick a
   **ping interval** (15s for hot routes, 60s to save battery). Toggle
   **high-accuracy GPS** off if you're in low-signal terrain. Save.
4. Back on **Home** (🏠), tap the **Off Shift** pill in the top bar →
   it flips green to **On Shift**. The first GPS prompt fires.
5. Allow location access. Pings start posting on the cadence you chose.
6. When dispatch sends you a job, the active-job card appears within
   30 s. The button row shows the next legal state transitions.

### Adding the app to your home screen

- **iOS Safari**: Share → "Add to Home Screen" → confirm.
- **Android Chrome**: ⋮ menu → "Add to Home screen" (or accept the
  install prompt that appears after the second visit).

After install the app opens in standalone mode (no browser chrome) and
the cached app shell loads instantly even with no signal.

## Layout

### Home (`/driver`)

- **Top bar**: driver name, battery %, **On Shift** toggle pill.
- **GPS-error banner**: appears if the browser denies geolocation. Retry
  button.
- **Active job card** (when assigned): caller name + tap-to-call,
  pickup address + tap-to-navigate (Google Maps directions), vehicle,
  service type, payout estimate, status pill, and state-machine
  buttons. The state machine:
  - `new | pending | flagged` → **Accept** / **Decline**
  - `assigned` → **En Route** / **Decline**
  - `en_route` → **On Scene**
  - `on_scene` → **In Tow** / **Complete**
  - `in_tow` → **Complete**
- **Queue section** (collapsible): jobs assigned to this driver but not
  yet active.
- **Ping status row**: last GPS fix age and accuracy.

### Map (`/driver/map`)

Full-screen dark-themed Google Map with:

- 🚛 marker at the driver's last GPS sample.
- **P** / **D** markers at the active job's pickup / dropoff (when
  coordinates are known).
- Emerald polyline between driver and pickup (straight-line — actual
  driving directions still live on the tap-to-navigate link).
- Collapsible bottom sheet with the same job summary as the home card.

If `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is unset, a hint card explains how
to wire it up. The driver app and the Command Center share this key.

### History (`/driver/history`)

Completed and cancelled jobs in the last 30 days, newest first. Per job:
date/time, caller, pickup → dropoff, status, payout estimate.

### Profile (`/driver/profile`)

- **Driver name** — used for ping labels and the top-bar greeting.
- **Phone (E.164)** — the natural key for everything driver-side.
  Changing it effectively logs you in as a different driver next page
  load.
- **Ping interval** — 15s / 30s / 60s.
- **High-accuracy GPS** — toggle. High accuracy uses GPS hardware and
  burns ~3× the battery; off uses cell-tower / Wi-Fi triangulation.
- **Log out** — clears local profile state. The ping history on the
  server is untouched.

## How the data flows

```
Driver PWA  →  /api/driver/*  →  NestJS /v1/driver/*  →  Postgres
                  ↑
            BFF attaches
            DRIVER_TENANT_API_KEY
            server-side
```

The browser never sees the tenant API key. The Next.js Route Handlers
under `packages/web/src/app/api/driver/**` forward each request to the
upstream NestJS API with `X-Tenant-API-Key` injected from
`DRIVER_TENANT_API_KEY` (or the dev-only
`NEXT_PUBLIC_DEMO_TENANT_API_KEY`).

Until per-driver bearer tokens land, scoping is done by the
`driver_phone` query parameter on every read. The API normalises the
phone to E.164 and JOINs `drivers.phone` to reach Command Center's
`unified_jobs`.

## Geolocation + pings

The home and map pages both run the `<Geolocator>` component, which
wraps `navigator.geolocation.getCurrentPosition`. Each successful fix
fires:

```
POST /v1/driver-pings
{
  driver_phone, driver_name?, lat, lng,
  heading?, speed_mph?, accuracy_m?,
  battery_pct?, source: 'phone_app'
}
```

Battery is read once on mount via the BatteryStatus API (where
available) and re-emitted on `levelchange`. The poll interval and
high-accuracy flag both come from the profile.

## State transitions

Every action tap calls:

```
POST /v1/driver/jobs/:job_id/status?driver_phone=…
{
  status: 'accept' | 'decline' | 'en_route' | 'on_scene'
        | 'in_tow' | 'completed' | 'cancel',
  notes?, lat?, lng?
}
```

The API **always** writes a row into `driver_job_events` first, then
best-effort updates `unified_jobs`. If the unified table is missing or
the update fails, the audit row is still durable and the failure is
appended to `docs/BLOCKERS.md` (once, idempotent).

## Push notifications

`POST /v1/driver/push/subscribe` persists web-push subscriptions into
`driver_push_subscriptions`. Actual sending is **not** wired yet — the
VAPID keys are blank in `.env.example`. See `docs/ASSUMPTIONS.md`
(Session 25) for the steps to enable delivery.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| "GPS required to receive jobs" banner | User denied location access | Tap Retry → grant permission in browser settings. iOS: Settings → Safari → Location → While Using. |
| Active job stuck on `assigned` | Tapped "En Route" but page didn't refresh | Pull-to-refresh or wait 30 s — the auto-poll picks it up. Check `driver_job_events` for the audit row. |
| "Refresh failed: HTTP 502" toast | BFF can't reach the upstream API | Verify `NEXT_INTERNAL_API_URL` / `NEXT_PUBLIC_API_URL` env on the web service. |
| Bottom nav showing no map | Add-to-home-screen install used wrong scope | Re-install from `/driver` directly (the manifest sets `scope: "/driver"`). |
| Drivers see each other's jobs | Profile phone collision | Confirm each driver entered the correct E.164. Two drivers with the same phone will both see jobs assigned to that phone. |
| Active card shows but tap-to-call does nothing | iOS PWA standalone mode disables `tel:` links by default | Open from Safari (not the home-screen icon) to dial, or add `target="_self"`-aware bypass in a future release. |

## Building / running locally

```
# In one shell — start the API
pnpm --filter @ustow/api dev

# In another — start the web
pnpm --filter @ustow/web dev
```

Then open `http://localhost:3000/driver`. For the BFF to talk to the
API, set in `packages/web/.env.local`:

```
DRIVER_TENANT_API_KEY=usk_…          # the tenant API key from /admin/api-keys
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=…    # same key as Command Center map
```

Run the E2E suite (after installing Playwright per
`docs/BLOCKERS.md`):

```
pnpm --filter @ustow/web exec playwright test
```
