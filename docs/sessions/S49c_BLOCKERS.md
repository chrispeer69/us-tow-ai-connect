# Session 49c — Blockers

## fetchPendingFlipJobs not yet wired to JobPoller

The orchestrator's job-feed source returns `[]` until a follow-up
commit hooks the existing `JobPoller` queue into
`FlipEngineService.fetchPendingFlipJobs`. With 49c alone, setting
`OUTBOUND_FLIP_ENGINE_ENABLED=true` is a no-op — the cron runs but
finds zero jobs. That's intentional: it lets us verify the
orchestrator + classifiers + scripts in production read-traffic
before opening the floodgates.

**Action:** A 5-line follow-up in `flip-engine.service.ts` once 49b +
49c are merged.

## Google Places API key not set in production

`GOOGLE_PLACES_API_KEY` is the only new env var 49c introduces. While
it's missing the destination classifier degrades to regex-only and
defaults most destinations to `unknown` (safe — no flip pitch fires).

**Action:** Provision an unrestricted Places API key in Google Cloud,
set it on Railway (`@ustow/api`), and confirm the destination tagger
returns `competitor_repair` / `auto_body` correctly via the
diagnostic POST `/v1/admin/flip-engine/aaa-blocklist/check` (same
matcher chain).

## Thinkrr outbound key still required

The flip orchestrator calls `OutboundVoiceService.enqueueCall`. If
Thinkrr's keys are missing the call is logged and queued — Session 49
already handles that gracefully (queued status with
`thinkrr_unavailable_or_unconfigured` error). The flip orchestrator
still records the audit log row, so no data is lost.

## Issue classifier is keyword-based v1

A Forge LLM classifier would likely outperform the v1 regex
classifier on novel phrasings. v1 is good enough to ship; v2 (LLM)
is a future session.
