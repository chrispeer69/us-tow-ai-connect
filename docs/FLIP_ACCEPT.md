# Flip-Accept SMS Workflow (Session 24)

Lightweight SMS-driven manager approval for jobs that the Digital
Dispatch rules engine flags but cannot auto-decide. Managers reply by
text; we relay the decision to the underlying adapter
(`AaaPortalAdapter`) and update the audit trail.

---

## High-level loop

1. Digital Dispatch evaluates a new AAA job. If the matching rule's
   action is `flag`, the engine writes a `dispatch_decisions` row with
   `decision = 'flagged'`.
2. `DigitalDispatchBridge` cron (in `modules/flip-accept/`) polls the
   `dispatch_decisions` table every 30 s, finds flagged rows that
   don't have a corresponding `flip_accept_requests` entry yet, and
   calls `FlipAcceptService.createRequest()`.
3. `createRequest()` writes a row, looks up `tenants.manager_phones`
   (JSONB array of E.164 strings), and SMS-fans-out the approval
   template to each manager.
4. A manager replies. Twilio POSTs to
   `POST /webhooks/twilio/sms-inbound` (Twilio-signature-validated).
5. The webhook parses the body, applies the decision, calls the
   adapter's `acceptJob` / `declineJob`, sets status to
   `approved | auto_dispatched | declined`, and replies with a
   confirmation TwiML.
6. Pending rows past `expires_at` (5 min default) are swept to
   `expired` by `FlipAcceptExpiryCron` every 30 s.

---

## SMS protocol

### Outbound (us → manager)

```
NEW AAA JOB - APPROVAL NEEDED
{service_type} at {pickup_address}
Vehicle: {vehicle}
Payout est: ${estimated_payout}
Distance: {distance_miles} mi

REPLY:
YES - accept job
NO REASON - decline (then text reason)
YES NOTE - accept with notes (then text notes IN CAPS)
```

The `service_type / pickup_address / vehicle / estimated_payout /
distance_miles` keys are pulled from the `job_summary` JSONB passed to
`createRequest()`. Missing keys fall back to `'tow' / 'unknown
location' / 'vehicle TBD' / 'unknown' / 'unknown'` respectively so the
template still renders.

### Inbound (manager → us)

Parser in `flip-accept-parser.ts`. Case-insensitive on the keyword;
payload is preserved verbatim.

| reply | parsed kind | stored as |
|---|---|---|
| `YES` | `approve` | `approval_notes = null` |
| `YES NOTE BRING DOLLY` | `approve` | `approval_notes = "BRING DOLLY"` |
| `YES bring straps too` | `approve` | `approval_notes = "bring straps too"` (free-form tail) |
| `NO` | `decline` | `approval_notes = null` |
| `NO REASON wrong area` | `decline` | `approval_notes = "wrong area"` |
| `NO too far` | `decline` | `approval_notes = "too far"` |
| anything else | `unknown` | webhook replies with help text |
| `STOP` / `UNSUBSCRIBE` | opt-out | TwiML opt-out confirmation; no request mutated |

The "ALL CAPS" convention in the outbound template is for human
readability only; the parser preserves whatever the manager typed.

### Confirmation reply

```
Got it. Job [accepted|declined] for AAA #{source_job_id}.
```

For unparseable replies:

```
We did not understand that reply. Please reply YES to accept, NO REASON
to decline, or YES NOTES <your notes>.
```

---

## Adapter integration

`FlipAcceptService.acceptRequest()` resolves the adapter via
`AdapterFactory.getAdapter(source_adapter)` using this mapping:

| `source_adapter` in DB | Adapter resolved |
|---|---|
| `AAA_SALESFORCE` / `AAA_PORTAL` / `AAA` | `AaaPortalAdapter` |
| `TOWBOOK` | `TowbookAdapter` |
| anything else | not resolved; row stays `approved` (not `auto_dispatched`); blocker logged |

The current `AaaPortalAdapter.acceptJob` is a logged stub (DOM selectors
not yet captured — see `docs/BLOCKERS.md`). On a successful call the
flip-accept row flips to `auto_dispatched`; otherwise it stays
`approved` and a line is appended to `BLOCKERS.md` so the gap surfaces
at session close.

`declineJob` is best-effort: failures append to BLOCKERS but don't fail
the inbound webhook (we still mark the row `declined` so the audit log
is consistent).

---

## Manager phone setup

Each tenant has `tenants.manager_phones` — a JSONB array of E.164
strings. The seed migration sets Roadside's value to
`["+17408129489"]`. Update via SQL or the existing tenant config admin
endpoint (out of scope for this session):

```sql
UPDATE tenants
SET manager_phones = '["+17408129489", "+16146337935"]'::jsonb
WHERE id = '00000000-0000-0000-0000-000000000001';
```

Inbound replies are matched to a request by:
1. The latest 50 pending rows are loaded.
2. If the sender's phone matches a tenant's `manager_phones`, the
   newest pending row from that tenant wins.
3. Otherwise, the newest pending row across all tenants wins.

This is intentionally permissive for the single-tenant rollout; once
multiple AAA-style tenants are live the resolver should be tightened
to a strict tenant match.

---

## Manual override

```
POST /v1/flip-accept/manual-override
X-Tenant-API-Key: …
Content-Type: application/json

{
  "request_id": "…",
  "decision": "approve",     // or "decline"
  "notes": "BRING DOLLY",
  "actor": "admin@…"
}
```

Treats the action identically to a parsed SMS reply (same adapter
calls, same status transitions). Only `pending` requests can be
overridden; finished rows return 400.

---

## History endpoint

```
GET /v1/flip-accept/history?status=pending&limit=25&offset=0
X-Tenant-API-Key: …
```

Returns paginated rows for the tenant, newest first.

---

## Expiration cron

`FlipAcceptExpiryCron` runs every 30 s and bulk-updates pending rows
past `expires_at` to `status = 'expired'`, `responded_at = now()`. We
do NOT auto-decline at the adapter level on expiry — the dispatcher
sees the expired row in `/v1/flip-accept/history` and can override
manually if they want to act late.

---

## Files

```
packages/api/src/modules/flip-accept/
  flip-accept.module.ts
  flip-accept.service.ts
  flip-accept.service.spec.ts
  flip-accept-parser.ts
  flip-accept-parser.spec.ts
  flip-accept.controller.ts        POST /v1/flip-accept/request
                                   GET  /v1/flip-accept/history
                                   POST /v1/flip-accept/manual-override
                                   POST /webhooks/twilio/sms-inbound
  flip-accept-expiry.cron.ts       expire pending @ 30 s
  digital-dispatch-bridge.ts       poll dispatch_decisions @ 30 s
```
