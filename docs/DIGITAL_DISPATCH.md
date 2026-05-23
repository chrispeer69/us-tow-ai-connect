# Digital Dispatch

Digital Dispatch is the AI-driven auto-accept engine that evaluates each
new motor-club job against a tenant's rules and decides
`accept | decline | flag`. It's exposed at `/admin/digital-dispatch`.

Today the only source wired up is AAA Salesforce; the engine itself is
source-agnostic.

## Trigger

`JobPollerCron` runs every 60 s. For every new unified job whose source is
a configured motor club (currently `aaa_salesforce`), the cron fires
`DispatchRulesEngineService.evaluateForJob(tenantId, job)`. Updates do
NOT re-run the engine — a decision once recorded sticks until overridden.

`POST /v1/admin/digital-dispatch/rules/:id/test` lets the UI dry-run a
rule against an existing job without writing a decision row.

## Rule DSL

A rule has:

```ts
{
  id: string;
  name: string;
  enabled: boolean;
  priority: number;          // ascending — lower priorities run first
  action: 'accept' | 'decline' | 'flag';
  conditions: Condition[];   // implicit AND across the array
}
```

Conditions are typed JSON objects. The engine evaluates conditions
in array order; ALL must match for the rule to fire. To express OR,
create two rules with the same action and adjacent priorities.

### Condition reference

| `type`                          | Fields                            | Meaning |
|---------------------------------|-----------------------------------|---------|
| `distance_max_miles`            | `miles: number`                   | Closest available driver (within 30 min ping) is within N miles of the pickup. False if pickup not geocoded or no driver has coords. |
| `time_of_day`                   | `start: "HH:MM"`, `end: "HH:MM"`  | Current local time (tenant timezone) is in `[start, end]`. Windows that cross midnight are supported. |
| `day_of_week`                   | `days: number[]` (0=Sun…6=Sat)   | Today (tenant tz) is in the list. |
| `service_type_in`               | `values: string[]`                | Job's `service_type` (case-insensitive) is in the list. |
| `estimated_payout_min`          | `amount: number`                  | `source_payload.estimated_payout ?? .payout ?? .amount` ≥ N dollars. |
| `driver_available_count_min`    | `count: number`                   | Count of drivers with `status = 'available'` ≥ N. |
| `job_age_minutes_max`           | `minutes: number`                 | Job is at most N minutes old. |
| `caller_phone_blacklist`        | `phones: string[]`                | Caller phone (digits-only compare) is NOT on the list. Returns true (= "allowed") when phone missing. |
| `custom_jsonpath`               | `expression: string`              | `jsonpath-plus` expression against `source_payload`. Truthy result matches. Errors → false (logged in trace). |

### First-match-wins

Rules are loaded ordered by `priority ASC, created_at ASC`. The first rule
where every condition matches is the decision. If no rule matches the
default action is **`flag`** — better to over-flag than to silently take
an action.

### Decision side effects

| Decision   | Effect                                                                        |
|-----------|-------------------------------------------------------------------------------|
| `accepted` | `unified_jobs.status = 'assigned'`, `acceptedAt = now`. Calls `adapter.acceptJob(tenantId, source_job_id)` if the adapter implements it. |
| `declined` | `status = 'declined'`, `completedAt = now`. Calls `adapter.declineJob(tenantId, source_job_id, reason)`. |
| `flagged`  | No status change. Job remains visible in the Command Center for a human to decide. |

In all three cases, a `dispatch_decisions` row is inserted with the full
per-rule evaluation trace (visible in the UI's Decisions tab) and the
unified job's `auto_decision*` columns are updated.

> **Open blocker:** the AAA portal Accept/Decline selectors are not yet
> verified — the adapter logs the action and returns without performing
> it. See `docs/BLOCKERS.md`. The decision audit trail is still written.

## API reference

All under `/v1/admin/digital-dispatch`.

| Method | Path                  | Notes |
|--------|------------------------|-------|
| GET    | `/rules`              | List. |
| POST   | `/rules`              | Body validated by Zod (see condition reference above). |
| PUT    | `/rules/:id`          | Partial patch. |
| DELETE | `/rules/:id`          | Returns `{ deleted: true }`. |
| POST   | `/rules/:id/test`     | Body `{ job_id }`. Dry-run; returns `EngineResult` with full trace. |
| GET    | `/decisions`          | Paginated; filter by `decision`, `rule_id`, `job_id`. |
| GET    | `/stats`              | Totals, accept rate, 14-day daily counts by decision, top decline reasons. |

`EngineResult`:

```ts
{
  decision: 'accepted' | 'declined' | 'flagged',
  ruleId: string | null,
  reason: string,
  evaluatedConditions: Array<{
    ruleId: string;
    ruleName: string;
    matched: boolean;
    results: Array<{ type: string; matched: boolean; reason: string }>;
  }>
}
```

## Examples

Three seeded rules are inserted by
`pnpm --filter @ustow/api db:seed:command-center`:

1. **Accept AAA jobs within 25mi between 06:00-22:00 local** —
   priority 10, action `accept`, conditions
   `[ distance_max_miles 25, time_of_day 06:00-22:00 ]`.
2. **Decline AAA jobs over 50 miles** — priority 20, action `decline`.
3. **Flag jobs with no estimated payout** — priority 30, action `flag`,
   uses a `custom_jsonpath` expression that matches when none of the
   payout fields are present in `source_payload`.

## Testing

Unit tests in
`packages/api/src/modules/digital-dispatch/conditions.spec.ts` cover each
condition type. Run with `pnpm --filter @ustow/api test`.
