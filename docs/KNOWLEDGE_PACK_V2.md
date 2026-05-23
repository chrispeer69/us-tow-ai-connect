# Knowledge Pack v2

> Richer, sectioned per-tenant profile content. Ships in Session 27 /
> Bundle C. v1 still works for tenants that haven't published v2.

## Why v2?

The v1 Knowledge Pack lives in `ai_agent_configs.knowledge_pack` as an
unstructured jsonb blob — fine for one tenant, awkward to surface in an
editor, and missing fields the Thinkrr agent script wants (fleet
composition, transfer-rule triggers, escalation policy). v2 adds:

- A typed schema (`KnowledgePackV2Schema` in `@ustow/shared`).
- A `draft` / `content` split so operators can stage changes before
  publishing.
- A versioning column so a future "rollback" feature has the data it
  needs.
- A JSON endpoint for typed consumers in addition to the legacy
  markdown one.

## Schema

```ts
{
  identity: { name, brands, slogan, founded_year, license_numbers },
  services: [{ name, description, price_range_disclaimer, availability_24_7 }],
  service_areas: [{ county, cities, zip_prefixes }],
  hours: { regular: { mon_fri, sat, sun }, after_hours_premium },
  fleet: [{ type: 'light-duty'|...|'rotator', count }],
  transfer_rules: [{ trigger: 'human_request'|'impound'|'pricing'|'after_hours', phone, label }],
  pricing_policy: { quote_at_dispatch, accepts_motor_clubs, cash_accepted, cards_accepted },
  escalation: { manager_phones, escalate_after_min_on_hold }
}
```

Stored in `tenant_knowledge_pack` (migration `0017`):

| Column | Notes |
|---|---|
| `tenant_id` | unique FK → `tenants.id`, cascade delete |
| `content` | published blob (served by public endpoints) |
| `draft` | editor-stage blob (overwritten by `PUT /draft`) |
| `version` | increments on every publish |
| `published` | `true` after first publish |
| `last_published_at` | set on publish |

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/v1/admin/knowledge-pack` | `AdminAuthGuard` | Read current draft + published content + metadata. |
| `PUT` | `/v1/admin/knowledge-pack/draft` | `AdminAuthGuard` | Replace `draft` (zod-validated). |
| `POST` | `/v1/admin/knowledge-pack/publish` | `AdminAuthGuard` | Copy `draft → content`, ++version, set `published=true`, audit, fire Thinkrr refresh webhook (best-effort). |
| `GET` | `/public/knowledge/:tenantId/profile.v2.md` | none | Markdown rendered from `content`. |
| `GET` | `/public/knowledge/:tenantId/profile.json` | none | Structured JSON from `content`. |
| `GET` | `/public/knowledge/:tenantId/profile.md` | none | Legacy v1 path — auto-prefers v2 published `content` when available, falls back to v1 renderer. |

## Markdown rendering

`packages/api/src/modules/knowledge-pack/knowledge-pack-renderer.ts`
turns the structured content into a markdown document Thinkrr's
Knowledge Pack scraper consumes. Empty arrays render fallback copy
("Contact dispatch for service availability", "Local area",
"Fleet composition not specified", etc.) so the markdown is always
parseable even with a sparsely filled draft.

## Publish flow

1. Operator opens `/admin/knowledge-pack` and edits the draft.
2. **Save draft** → `PUT /v1/admin/knowledge-pack/draft` persists the
   blob and writes `knowledge_pack.draft.saved` to `audit_log`.
3. **Publish** → `POST /v1/admin/knowledge-pack/publish`:
   - Validates the draft against `KnowledgePackV2Schema`.
   - Copies `draft → content`, increments `version`, sets `published =
     true`, sets `last_published_at = now()`.
   - Writes `knowledge_pack.published` to `audit_log` with before/after
     state.
   - Best-effort POSTs `{tenantId, version, kind:
     'knowledge_pack_published'}` to `THINKRR_KP_REFRESH_WEBHOOK_URL`
     (env, optional). If unset, logs a warning and continues.
4. The legacy `/profile.md` endpoint immediately starts serving the v2
   markdown for that tenant; Thinkrr re-scrapes within 60s (per
   `Cache-Control`).

## Thinkrr cache invalidation

Today: Thinkrr scrapes the URL on its own cadence (no documented
"refresh-now" webhook). We expose `THINKRR_KP_REFRESH_WEBHOOK_URL` as
an env so the moment we learn the webhook contract from Thinkrr, ops
can flip it on without a redeploy. Logged to `docs/BLOCKERS.md`.

## Tenant-zero seed

Migration `0017_knowledge_pack_v2.sql` seeds a v2 row for tenant-zero
(Roadside Towing) from the existing v1 blob — preserving brands,
service area, hours, and transfer phone so the public endpoint
continues serving meaningful content even before anyone clicks
**Publish** in the admin UI.

## Testing

- Vitest: `packages/api/src/modules/knowledge-pack/knowledge-pack-renderer.spec.ts`
