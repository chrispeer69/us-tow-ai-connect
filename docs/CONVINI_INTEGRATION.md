# Convini SMS Integration — Stub Doc

Session 25 ships the receiver scaffolding for Convini-originated SMS jobs.
**The actual wire format and download URL are still pending from Chris.**
Once those land, this doc is the single source of truth for wiring them up.

## Current Status

| Piece | Status | Where |
| --- | --- | --- |
| Inbound SMS webhook endpoint | ✅ scaffolded | `POST /webhooks/twilio/convini-sms-inbound` |
| Payload parser | ✅ permissive stub | `ConviniService.parseBody` |
| Persistence (`convini_incoming_jobs` table) | ✅ live | migration `0011_driver_experience.sql` |
| Best-effort projection into `unified_jobs` | ✅ live (silently no-ops if missing) | `ConviniService.projectToUnifiedJobs` |
| Admin list endpoint | ✅ live | `GET /v1/admin/convini/incoming` |
| Twilio signature verification on the webhook | ❌ TODO — pending Twilio sub-account confirmation | `convini.controller.ts` |
| **`CONVINI_DOWNLOAD_URL` env var** | ❌ **PLACEHOLDER — actual URL TBD from Chris** | `packages/api/.env.example` |
| **Real Convini payload format** | ❌ **PLACEHOLDER — assumed `CONVINI: KEY=value …` until confirmed** | `ConviniService.parseBody` |

## Once Chris provides the download URL

1. Set `CONVINI_DOWNLOAD_URL` in Railway → `@ustow/api` service variables.
2. If Convini posts inbound jobs via SMS, configure their gateway to deliver
   to `POST {PUBLIC_BASE_URL}/webhooks/twilio/convini-sms-inbound`.
3. If Convini exposes a pull endpoint instead, add a NestJS cron job that
   `fetch()`-es the URL on a schedule and feeds each row through
   `ConviniService.ingest(tenantId, rawBody)`.
4. Confirm Twilio routes inbound SMS for the Convini number to the same
   webhook URL — if a separate Twilio sub-account is in play, add it to the
   CORS / signature trust list.

## Once Chris confirms the payload format

Currently `ConviniService.parseBody` accepts:

```
CONVINI: ID=cv-12345 NAME="Jane Doe" PHONE=+17408129489 \
  PICKUP_ADDRESS="123 Main St" PICKUP_LAT=40.123 PICKUP_LNG=-82.456 \
  VEHICLE_MAKE=Honda VEHICLE_MODEL=Civic SERVICE=tow
```

Or, with an embedded JSON blob:

```
CONVINI: ID=cv-12345 JOB={"caller_name":"Jane","pickup_address":"123 Main"}
```

**These keys are PLACEHOLDERS — actual Convini field names TBD.** When the
real format lands:

1. Update the `kvRe` regex / `raw_fields` field mapping in
   `convini.service.ts:parseBody` to match the real keys.
2. Run the back-fill: rows already stored in `convini_incoming_jobs` keep
   their `raw_body`, so re-running `parseBody` against historical entries
   can populate the corrected `parsed_payload` without losing data.
3. Add explicit Zod schema validation if the format is strict — replace the
   regex parser with a structured `JSON.parse + ZodSchema.parse` pipeline.

## Tenant-id resolution today

The webhook resolves `tenant_id` in this priority order:

1. `tenant_id` field embedded in the SMS body or POST body.
2. `x-tenant-id` HTTP header (debugging).
3. `?tenant_id=` query parameter.
4. `DEFAULT_ADMIN_TENANT_ID` env var (development fallback).

**Once production has more than one tenant**, this needs to map the
inbound `To=` Twilio number to a tenant via the existing
`tenants.assigned_phone_number` column. Add that lookup before flipping
the seed/default fallback off.

## Admin surface

`GET /v1/admin/convini/incoming?limit=50`

Returns the most recent rows from `convini_incoming_jobs`, newest first.
Each row exposes:

- `id`, `convini_id` (parsed), `status` (`received` | `processed` | `failed`)
- `raw_body` (always the verbatim SMS text)
- `parsed_payload` (best-effort parse — may be incomplete until format lands)
- `error_message` (populated when projection into unified_jobs failed)
- `received_at`, `processed_at`

## Stub behavior summary

- SMS arrives at `POST /webhooks/twilio/convini-sms-inbound` → 200 OK always.
- Bodies without the `CONVINI` marker are ignored (returns `{ignored: true}`).
- Recognised bodies persist into `convini_incoming_jobs` with `status=received`.
- If `unified_jobs` is reachable AND the payload has an `ID=`, the row is
  projected into `unified_jobs` (`source='convini'`) and status flips to
  `processed`. Otherwise it stays `received` and a one-time note is appended
  to `docs/BLOCKERS.md`.
- Twilio signature verification is **not yet wired** on this webhook — add
  it before exposing the endpoint to the public internet beyond Twilio.
