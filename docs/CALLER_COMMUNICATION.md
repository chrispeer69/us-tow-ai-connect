# Caller Communication (Session 24)

Two integrated features ship in the same bundle because they share the
outbound SMS pipeline:

1. **Tracking links** — a short URL we SMS to every caller after we open a
   dispatch request. The link lands them on a public, no-auth page that
   shows status, live driver location, and ETA. Refreshes every 10 s.
2. **Flip-accept SMS workflow** — see [`FLIP_ACCEPT.md`](FLIP_ACCEPT.md).
   This doc covers the tracking + SMS substrate that both features sit on.

---

## Shared SMS substrate

Module: `packages/api/src/modules/outbound-sms/**`. Global module
(no `imports:` needed elsewhere).

### `TwilioSmsService`

```ts
await sms.sendSms({
  to: '+17408129489',
  body: 'Roadside Towing: Track your tow live → https://…/track/abc123',
  tenantId,
  related: { trackingLinkId },
});
```

Responsibilities:
- Records every outbound message into `sms_messages` (audit log).
- Idempotency: identical `(tenant_id, to_phone, body)` triplets within
  60 s return the prior row without re-hitting Twilio.
- Falls back to log-only when `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` are
  unset (local dev, CI). The row's `status` field reflects `'log_only'` so
  the admin log makes it obvious.
- `sendBulk(recipients, body, tenantId)` for the manager-fanout case.
- `recordInbound(...)` is called by the SMS-inbound webhook to capture
  caller replies.

### `POST /webhooks/twilio/sms-status-callback`

Twilio-signed callback that translates Twilio's status vocabulary
(`queued|sent|delivered|failed|...`) into our `sms_messages.status` keyed
by `twilio_sid`. Sets `delivered_at` when status flips to `delivered`.

---

## Tracking links

### Database

Migration `0009_caller_communication.sql` creates `tracking_links`:

| column | notes |
|---|---|
| `token` | 12-char URL-safe slug (alphabet excludes `0OIl1`) |
| `caller_phone` | E.164 |
| `pickup_lat / pickup_lng` | numeric(10,7) — optional |
| `status` | `'created' → 'driver_assigned' → 'en_route' → 'on_scene' → 'completed'`, or `'expired'` past `expires_at` |
| `assigned_driver_phone` | joined against `driver_pings` at read time |
| `last_eta_minutes` | tenant-updated whenever the dispatcher re-quotes |
| `expires_at` | default `now + 24h` |

### Endpoints

Auth header for tenant-keyed routes: `X-Tenant-API-Key`.

| method | path | auth | purpose |
|---|---|---|---|
| `POST` | `/v1/tracking/create` | tenant key | Allocate a token, send the initial SMS, return `{tracking_url, token, expires_at, sms_status}` |
| `GET` | `/v1/tracking/:token` | **public** | Status view consumed by the web page |
| `POST` | `/v1/tracking/:token/update` | tenant key | Patch `status`, `assigned_driver_phone`, `assigned_driver_name`, `last_eta_minutes` |

The public view returns `caller_phone_last4` only (not the full phone) for
privacy and never returns the tenant ID.

### Auto-creation from the AI agent

`POST /v1/ai-connect/dispatch-request` (the existing Thinkrr-callable
endpoint) now also calls `TrackingService.create()` after the dispatch
row is inserted. The response gains a `tracking` object:

```json
{
  "status": "success",
  "data": {
    "dispatch_request_id": "…",
    "status": "NEW",
    "dispatcher_notified": true,
    "tracking": {
      "tracking_url": "https://ustowapi-production.up.railway.app/track/abc123XYZ",
      "token": "abc123XYZ",
      "expires_at": "2026-05-24T15:00:00Z"
    }
  }
}
```

A failure in the tracking path does NOT fail the dispatch request — it's
logged and the caller still gets the dispatcher SMS notification.

### SMS template

```
Roadside Towing: Track your tow live → https://…/track/<token>. Reply STOP to opt out.
```

Sends are skipped (and logged as `'skipped_opt_out'`) when the tenant has
`sms_enabled = false`. The seed migration sets `sms_enabled=true` for
Roadside.

### Tracking URL base

Per-tenant column `tenants.tracking_url_base` (default
`https://ustowapi-production.up.railway.app/track`). Switch to the public
web domain once it's wired up by issuing a single UPDATE:

```sql
UPDATE tenants SET tracking_url_base = 'https://app.roadsidetowing.example/track'
WHERE id = '00000000-0000-0000-0000-000000000001';
```

### Public web page

Route: `packages/web/src/app/track/[token]/page.tsx`. Mobile-first.

- Polls `/v1/tracking/:token` every 10 s.
- Renders a colour-coded status badge, optional ETA card, embedded Google
  Map (pickup marker + live driver triangle + polyline), driver-name
  panel, and a sticky "Call dispatch" CTA tied to `+17408129489`.
- Shows distinct "Link expired" and "Tracking link not found" states
  with the same Call CTA, so a stale page never leaves the caller
  stranded.
- Map uses `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (same env as Command
  Center). Falls back to a textual placeholder if the key is unset.

---

## SMS audit log

Admin UI: `packages/web/src/app/admin/sms-log/page.tsx`. Reads
`GET /v1/admin/sms-log` (admin auth via `x-tenant-id`).

Filters: direction (inbound/outbound), status (queued/sent/delivered/
failed/received/log_only), date range. Rows expand to show Twilio SID,
delivery timestamps, related tracking link / flip request, and any error
string.

Sidebar nav is intentionally left untouched (the navigation component is
owned by another session); reach the page at `/admin/sms-log` directly.

---

## Opt-out handling

If a caller texts `STOP` (or `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`,
`STOPALL`) to our Twilio number, the inbound webhook (used by the
flip-accept module — see `FLIP_ACCEPT.md`) responds with the opt-out
confirmation TwiML. The `tenants.sms_enabled` flag is the long-term
opt-out switch; per-caller opt-out lives implicitly in Twilio's own
opt-out list (we never re-send to a number Twilio has blacklisted).

---

## Files

```
packages/api/src/modules/outbound-sms/
  outbound-sms.module.ts
  twilio-sms.service.ts
  twilio-sms.service.spec.ts
  sms-webhook.controller.ts            POST /webhooks/twilio/sms-status-callback
  sms-log.controller.ts                GET  /v1/admin/sms-log

packages/api/src/modules/tracking/
  tracking.module.ts
  tracking.service.ts
  tracking.service.spec.ts
  tracking.controller.ts               POST /v1/tracking/create
                                       GET  /v1/tracking/:token
                                       POST /v1/tracking/:token/update

packages/web/src/app/track/[token]/
  page.tsx
  tracking-client.tsx
  tracking-map.tsx

packages/web/src/app/admin/sms-log/
  page.tsx
```
