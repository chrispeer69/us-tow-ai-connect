# Outbound Flip Rules (Sessions 49b/c/d)

## Overview

The flip engine watches the dispatch boards for new motor club jobs and
triggers an automated outbound call to the customer. On every call the AI
confirms tow details, optionally pitches a redirect to one of the operator's
partner shops, and offers the CONVINI customer-rewards app.

This document captures the **rules** that gate flip eligibility. The rules
sit between the destination classifier (49c) and the outbound voice
orchestrator (Session 49). Session 49b ships the data foundation — shop
registry, AAA-branded blocklist, tenant config — and the helper functions
the rules depend on.

The AI never writes back to Towbook or AAA. Every decision the AI makes is
captured in our database and texted to your managers as the source of
truth. Your team makes the actual job-system updates manually.

---

## Hard Rules (Never Overridden)

### Rule 1 — AAA call to a AAA-branded shop is **never** flipped

Source = AAA AND destination business name contains `AAA` as a standalone
word (regex `\bAAA\b`, case-insensitive) → flip suppressed, no exceptions.

Operators can extend this with the `aaa_branded_blocklist` table for regional
AAA brand variants (`Car Care Plus`, `AAA Auto Repair`, etc.) that may not
include the literal `AAA` word.

This rule is documented as a **fireable-offense-level guardrail** in
`packages/api/src/modules/flip-engine/aaa-branded.matcher.ts`. Every AAA call
runs the matcher first, before any classification. The matcher is also
covered by 13 unit tests in `aaa-branded.matcher.spec.ts`.

### Rule 2 — AI never writes to dispatch software

The flip engine **only places a call and sends a management SMS**. It does
not call any adapter `updateJobNotes` / `updateJobStatus` etc. The
manager SMS contains every detail the dispatcher needs to make the
write-back themselves.

### Rule 3 — Tenant must opt in

`tenants.flip_engine_enabled = true` is required. The poller (49c) skips
non-opted-in tenants at SQL level so an unconfigured tenant costs zero CPU.

---

## Confidence-Gated Exclusions

These categories are **excluded from flips ONLY when the AI classifier is
confident**. Default confidence threshold: **0.85**. Tenants can tune this
via `flip_engine_config.no_flip_confidence_threshold`.

| Category | Why no flip | Confidence threshold |
|----------|-------------|----------------------|
| `single_tire_issue` | Low repair value (~$30) — friction not worth the upside | ≥ 0.85 |
| `jump_start` | No shop work needed | ≥ 0.85 |
| `lockout` | No shop work needed | ≥ 0.85 |
| `fuel_delivery` | No shop work needed | ≥ 0.85 |
| `winch_out` | No shop work needed | ≥ 0.85 |
| `accident_with_airbags` | Insurance dictates body shop; no flip | ≥ 0.85 |

If confidence is **below** the threshold, the flip pitch proceeds. The audit
log captures both `issue_subcategory` and `confidence` so operators can tune
the threshold per category over time.

**Special case — full set of new tires.** When the customer says they need a
full set (4 tires), the classifier returns `full_tire_set` and the flip
proceeds. Single tire vs. full set is the most common ambiguity; the AI is
trained to ask a clarifying question when it can't tell.

---

## Destination-Type Behaviour

The classifier (49c) tags the destination using Google Places. Each tag has
its own pitch path:

| Destination | Flip pitch | CONVINI pitch | Body shop soft mention |
|-------------|------------|---------------|------------------------|
| **Competitor auto repair** | YES — 3-tier offers | Soft close at end | No |
| **Auto body / collision** | NO — insurance contracts dictate | Medium pitch | Yes — mention our 2 body shops |
| **Residence / unknown** | NO — no opportunity | Hard pitch | No |
| **Our shop already** | NO — no need | Soft close (already a customer) | No |
| **AAA-branded (when source = AAA)** | NEVER — Rule 1 | Standard | No |

---

## Three-Tier Flip Offer

When the destination is a competitor auto repair shop and Rule 1 doesn't
apply, the AI runs the offers in order. Each is presented once. The
moment one is accepted, subsequent offers are skipped.

| # | Offer | What the AI says |
|---|-------|------------------|
| 1 | Free diagnostic + 10% off | "I can redirect your tow to one of our shops. As a thank-you, we'll cover your diagnostic and take 10% off your repair." |
| 2 | Same-day priority + 1-hour written estimate | "We can guarantee same-day priority service and a written estimate in your hands within an hour of arrival." |
| 3 | $50 credit + Google review reward | "Final offer — we'll credit you $50 toward your invoice and another $25 once you leave us a Google review." |

Each offer mentions the **CONVINI rental fleet** (35 vehicles) on Offers 1
and 2. Offer 3 keeps the script tighter and skips the rental mention.

---

## CONVINI App Pitch (Three Intensities)

The pitch always closes the call (regardless of flip outcome) when
`flip_engine_config.mention_convini = true` (default).

| Intensity | When | Script body |
|-----------|------|-------------|
| **Soft** | Customer is going to our own shop, OR the flip succeeded | "Last thing — I'd love to text you our free CONVINI app. It's our all-in-one platform for towing, repairs, and rentals. Want me to send it?" |
| **Medium** | Auto-body destination (no flip), OR flip declined but customer kept original repair shop | "Before you go — we offer a free app called CONVINI that handles roadside assistance, repair scheduling, AND rentals. We have 35 rental cars in our fleet. Can I text you the link?" |
| **Hard** | Residential / unknown destination (no flip) | "I want to make sure you're covered next time. We have a free app called CONVINI — it gets you a tow, a rental, and a repair shop with one tap. We have 35 rentals on hand and 9 partner shops in the area. The app is free; can I text you the link?" |

Link: `https://convinicar.com/app` (or whatever URL is configured per
tenant).

---

## Source Adapters

The flip engine watches **two** dispatch boards in parallel today:

| Source | Adapter | Notes |
|--------|---------|-------|
| Towbook | `TowbookAdapter` (existing) | Job IDs prefixed `TB-` |
| AAA Salesforce contractor portal | `AaaPortalAdapter` (existing) | Work order IDs prefixed `AAA-`. Rule 1 always applies to AAA-source jobs. |

A new motor club job arriving on EITHER source triggers a flip evaluation.
AAA jobs never roll up into Towbook — they're a parallel stream.

---

## Pickup-Address-Based Shop Selection

When the flip is eligible, the engine picks the active partner shop of the
correct type (REPAIR for repair flips, BODY for body-shop soft mentions)
that is **nearest to the tow's pickup address** (haversine distance).

This is the shortest detour for the driver. It's not always the closest to
the customer's destination, by design — driver routing efficiency wins.

The selector is in `packages/api/src/modules/flip-engine/nearest-shop.selector.ts`
with 7 unit tests in `nearest-shop.selector.spec.ts`.

---

## Tenant Configuration

`tenants.flip_engine_enabled` (boolean, default false) — master switch.

`tenants.flip_engine_config` (jsonb, default `{}`) — per-tenant tuning:

```jsonc
{
  "poll_interval_seconds":          60,    // 49c
  "no_flip_confidence_threshold":   0.85,  // 49c
  "no_flip_categories":             ["single_tire_issue","jump_start","lockout","fuel_delivery","winch_out","accident_with_airbags"],
  "daily_report_hour_local":        21,    // 49d (9 PM)
  "batch_summary_size":             10,    // 49d
  "send_batch_summaries":           true,  // 49d
  "send_daily_report":              true,  // 49d
  "mention_rentals":                true   // 49c
}
```

All knobs are surfaced in the `/admin/flip-engine` Settings tab.

---

## Tenant-Zero Seed (Alpha Automotive)

Migration `0025_alpha_shops.sql` pre-seeds tenant zero
(`00000000-0000-0000-0000-000000000001`) with all 9 Alpha Automotive shops:

**Repair (7):**

1. Ernie's Automotive Service — 3906 E Main St, Columbus OH 43213
2. Complete Brake Service — 580 W Town St, Columbus OH 43215
3. Hilliard Auto Repair — 4462 Cemetery Rd, Hilliard OH 43026
4. Petty's Auto & Electric Service — 330 S Washington Ave, Columbus OH 43215
5. Wayne's Auto Repair — Columbus, 2375 Schrock Rd, Columbus OH 43229
6. Wayne's Auto Repair — Westerville, 5995 Westerville Rd, Westerville OH 43081
7. Wayne's Auto Repair — Powell, 361 Village Park Dr, Powell OH 43065

**Body (2):**

8. Excite Collision Repair — 5511 Westerville Rd, Westerville OH 43081
9. T&C Body Shop — 2856 Johnstown Rd, Columbus OH 43219

Other tenants start empty and add their own shops via the admin UI.

---

## Files Owned (Session 49b)

```
packages/api/src/db/migrations/0025_alpha_shops.sql
packages/api/src/db/migrations/0026_aaa_branded_blocklist.sql
packages/api/src/db/migrations/meta/_journal.json   (idx 23 + 24 added)
packages/api/src/db/schema.ts                       (alphaShops, aaaBrandedBlocklist, tenants config columns)
packages/api/src/modules/flip-engine/aaa-branded.matcher.ts          (+ .spec.ts, 13 tests)
packages/api/src/modules/flip-engine/nearest-shop.selector.ts        (+ .spec.ts, 7 tests)
packages/api/src/modules/flip-engine/flip-engine.service.ts
packages/api/src/modules/flip-engine/flip-engine.controller.ts
packages/api/src/modules/flip-engine/flip-engine.module.ts
packages/api/src/app.module.ts                      (+ FlipEngineModule import)
packages/web/src/app/admin/flip-engine/page.tsx     (Shops + Blocklist + Settings tabs)
packages/web/src/app/admin/flip-engine/loading.tsx
packages/web/src/app/admin/flip-engine/error.tsx
packages/web/src/components/admin/nav-config.tsx    (+ Flip Engine entry)
packages/web/src/components/ui/icons.tsx            (+ flip-engine icon)
docs/OUTBOUND_FLIP_RULES.md                         (this file)
docs/sessions/S49b_DECISIONS.md
docs/sessions/S49b_BLOCKERS.md
docs/sessions/S49b_OPERATOR_TODO.md
```
