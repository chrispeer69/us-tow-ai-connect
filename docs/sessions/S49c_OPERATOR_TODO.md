# Session 49c — Operator TODO

## 1. Provision Google Places API key

- Cloud Console → Enable Places API on a project tied to the prod
  billing account.
- Generate an unrestricted API key (or restrict to `Places API` +
  Railway egress IPs if your security model requires it).
- Set on the `@ustow/api` Railway service:
  - `GOOGLE_PLACES_API_KEY=<key>`

## 2. Enable the flip orchestrator cron

After 49c merges and the JobPoller wiring follow-up lands:

- `OUTBOUND_FLIP_ENGINE_ENABLED=true` on `@ustow/api` Railway.
- Set `tenants.flip_engine_enabled = true` for tenant zero from
  `/admin/flip-engine` → Settings tab.

## 3. Verify with a dry-run

- Insert a synthetic Towbook job with a known competitor repair shop
  destination and a high-confidence mechanical issue.
- Watch `outbound_call_logs` for the new row and the linked
  `outbound_calls` row created by Session 49's enqueue.
- Confirm the call body contains the rendered confirm + 3 offers +
  CONVINI pitch.

## 4. Tune the no-flip confidence threshold

After ~50 real flips, audit the `outbound_call_logs.issueType` +
`outbound_calls.outcome` and decide if 0.85 is too cautious or too
permissive. Adjust via `/admin/flip-engine` → Settings.
