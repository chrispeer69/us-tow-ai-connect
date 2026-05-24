# S47 — Admin UX consistency sweep + sidebar polish — Decisions

Session 47. Branch `session/47-admin-ux-sweep`. Honored DO-NOT-TOUCH
(packages/api, app/admin/{members,reports} + track/driver/onboarding,
design-tokens.css read-only, scripts/**, the named docs).

## TopBar.tsx left untouched — task-4 features land in a new utility bar
- `TopBar.tsx` already exists under `components/admin/**`, which OWNED_PATHS
  marks **additive-only**. So it is NOT modified.
- Task 4 ("top bar: breadcrumb / avatar / search / bell") is delivered via a
  **new** `UtilityBar` component composed into `layout.tsx` (owned) directly
  under the existing TopBar. This satisfies the requirement additively and
  keeps the global brand bar intact. Reviewer note: this is why TopBar.tsx
  shows no diff.

## Icons — hand-rolled SVG, no new dependency
- `lucide-react` is not installed; task says "use existing dep if installed,
  else lightweight SVG." Added `components/ui/icons.tsx` — a 24×24 stroke icon
  set (currentColor, 1.75 stroke) in lucide's visual language. No package added.

## Sidebar group taxonomy (matches the spec, with item moves)
Spec groups: Operations / Communications / Configuration / Account / Super Admin.
The old sidebar had Operations / Configuration / Account / Platform. Changes:
- **Added Communications**; moved `calls` (Operations→Communications) and
  `sms-log` + `digest` (Account→Communications). Cleaner comms taxonomy.
- **Renamed** `Platform` → `Super Admin` (same item: Tenants).
- Single source of truth: `components/admin/nav-config.tsx`, consumed by both
  the desktop `Sidebar` and the mobile drawer so they cannot drift.

## Mobile nav as a separate additive component
- `Sidebar.tsx` (owned) stays the desktop `aside` (hidden < lg). The mobile
  hamburger + slide-in drawer is `AdminMobileNav.tsx` (additive), rendered in
  the UtilityBar. State is local to the drawer (no shared store needed); the
  desktop Sidebar exports `SidebarFooter` which the drawer reuses.

## Search / bell / tenant switcher are labelled placeholders
- No backend exists for these yet. Each renders as a real control with a
  "— coming soon" title/aria-label so it reads as intentional. Cmd/Ctrl+K is
  wired to focus the search affordance; the full command palette is a follow-up
  (S47_FOLLOWUP.md).

## Error / loading boundaries
- Lifted the existing root `admin/error.tsx` treatment into a reusable
  `components/ui/SectionError.tsx` (`'use client'`) and added
  `SectionLoading.tsx` (server-safe skeleton). Per-page `error.tsx`/`loading.tsx`
  are thin wrappers around these. `members` + `reports` are DO-NOT-TOUCH, so
  they keep falling back to the root `admin/error.tsx` and get no per-page
  boundary — logged to S47_FOLLOWUP.md. No root `admin/loading.tsx` was added
  (it would suppress the per-page granularity).

## PageHeader sweep scope
- Canonical reference: `/admin/integrations` (the only page already on
  `PageHeader`). Migration rule fixed up front: a page with a simple top-level
  `<h1>` (+ optional `<p>` subtitle) is migrated; a page whose header is woven
  into a flex/grid bar with inline controls, status pills, or tab strips is
  logged to follow-up rather than risk rewriting feature layout.
- `members` + `reports` excluded (DO-NOT-TOUCH).

## EmptyState
- New `components/ui/EmptyState.tsx`. Adopted on pages with obvious ad-hoc
  "no X yet" strings; remaining candidates logged to follow-up.

## Design tokens
- Consumed existing tokens only (`--surface*`, `--border*`, `--alliance-*`,
  `--text-*`, `--shadow-md`, `--radius*`). Did not edit design-tokens.css.
