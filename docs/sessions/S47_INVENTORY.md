# S47 — Admin page inventory & consistency audit

Audit of every page under `packages/web/src/app/admin/**`. Canonical reference
pattern: **`/admin/integrations`** (first page through the visual refresh —
uses `<PageHeader variant="hero">`, `Card`, `Button`, `Badge`, `Spinner`).

Legend: **PH** = uses `<PageHeader>`. **Boundaries** = per-page
`error.tsx`/`loading.tsx`. ✅ done this session · ⤳ follow-up · ⛔ DO-NOT-TOUCH.

| Page | H1 / header (as-found) | PH before→after | Table | Empty state | Boundaries (err/load) |
| --- | --- | --- | --- | --- | --- |
| integrations | `PageHeader variant="hero"` | ✅ canonical | — | inline copy | ✅ added |
| api-keys | `<header><h1 text-3xl></header>` | ✗ → ✅ | — | ✗ → ✅ EmptyState | ✅ added |
| billing | `<header><h1 text-3xl></header>` | ✗ → ✅ | `<Table>` | inline copy ⤳ | ✅ added |
| routing | `<header><h1 text-3xl></header>` | ✗ → ✅ | — | ✗ → ✅ EmptyState | ✅ added |
| digest | `<header><h1 text-2xl></header>` | ✗ → ✅ | — | inline copy | ✅ added |
| digital-dispatch | `<header><h1 text-3xl></header>` | ✗ → ✅ | raw `<table>` ⤳ | inline copy ⤳ | ✅ added |
| branding | `<div><h1 text-3xl></div>` | ✗ → ✅ | — | — | ✅ added |
| tenants | `<div><h1 text-3xl></div>` | ✗ → ✅ | — | — | ✅ added |
| knowledge-pack | `<div><h1 text-3xl></div>` | ✗ → ✅ | — | inline copy ⤳ | ✅ added |
| ai-agent | flex bar `<header>` + action | ✗ → ⤳ | — | — | ✅ added |
| company | flex bar `<header>` + action | ✗ → ⤳ | — | — | ✅ added |
| calls | flex bar + export btn + **tabs** | ✗ → ⤳ | `<Table>` | inline copy ⤳ | ✅ added |
| audit-log | `flex items-baseline justify-between` + count | ✗ → ⤳ | `<Table>` | — | ✅ added |
| sms-log | `flex items-baseline justify-between` + count | ✗ → ⤳ | `<Table>` | — | ✅ added |
| drivers-live | header inside bordered panel + controls | ✗ → ⤳ | raw `<table>` ⤳ | — | ✅ added |
| command-center | bespoke dashboard header (eyebrow+h1, token-based) | ✗ → ⤳ | custom grid | — | ✅ added |
| members | `<h1 text-3xl>` | ✗ → ⛔ | — | inline copy | ⛔ none |
| reports | `<h1 text-3xl>` | ✗ → ⛔ | charts | inline copy | ⛔ none |

## Deltas vs the canonical pattern (found)
- **PageHeader adoption:** only `integrations` used it. Every other page rolled
  a bespoke `<h1 className="text-3xl font-bold">` (sizes varied: `text-3xl` vs
  `text-2xl` vs `text-xl`; colors `text-zinc-100` vs none).
- **Boundaries:** zero pages had `error.tsx`/`loading.tsx` — only the segment
  root `admin/error.tsx` existed, and no `loading.tsx` anywhere.
- **Empty states:** ad-hoc `<p className="text-sm text-zinc-400">No … yet</p>`
  strings, no shared component.
- **Tables:** mixed — `audit-log`/`billing`/`calls`/`sms-log` use the `<Table>`
  primitive; `digital-dispatch`/`drivers-live` hand-roll `<table>`.
- **Buttons:** every page except `drivers-live` + `reports` imports the `ui`
  `Button`; those two use raw `<button>`. (Variant audit conflated
  Button/Badge/PageHeader `variant=` props — Button itself supports
  default/secondary/outline/ghost/destructive; `success` seen is the **Badge**
  variant, `hero` is the **PageHeader** variant.)
- **Sidebar groups:** were Operations/Configuration/Account/**Platform** — spec
  wants Operations/Communications/Configuration/Account/**Super Admin**.

## Fixed this session
- PageHeader: 8 pages migrated (see table). Sidebar regrouped + polished.
  Per-page boundaries added to all 16 non-DO-NOT-TOUCH pages. EmptyState created
  + adopted on api-keys + routing. New utility bar (breadcrumbs/search/bell/
  tenant switcher) + mobile drawer.

See `S47_DECISIONS.md` for rationale and `S47_FOLLOWUP.md` for what remains.
