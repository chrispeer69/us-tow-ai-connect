# Session 34 — Onboarding visual refresh: decisions

Branch: `session/34-onboarding-refresh`
Owner unavailable until PR open. Decisions made autonomously per CLAW.MD; conservative path chosen and documented.

## Decisions

- **Navy CTA via `Button` `secondary` variant.** Spec said "Button primary (navy bg + white text)". Our `Button` primitive's *default* variant is alliance-blue (`#2563eb`, the design system's documented "primary CTA"), and the *secondary* variant is navy (`--alliance-navy`). Spec's explicit visual intent was "navy bg + white text", so the forward CTA (Continue / Create my AI dispatcher / Open admin dashboard) uses `variant="secondary"`. This ties the CTAs to the navy step indicator and navy hero. Documented because it diverges from the primitive's literal "default = primary" naming.

- **New `onboarding/layout.tsx` + `OnboardingShell`.** Onboarding had no shell of its own and was rendering legacy dark `zinc-*` classes that the `.admin-shell` remap never reached (it lives outside `/admin`), so it painted dark-on-light. Added a public shell that mirrors the admin treatment: light `--surface-bg`, glass brand bar, `PoweredByFooter`. Wrapped in `BrandingProvider source="public"` with **no tenantId** (pre-tenant flow) so it supplies default alliance branding/CSS vars without any network fetch.

- **Animations via scoped CSS module** (`onboarding.module.css`), not global CSS. `styles/**` and `globals.css` are read-only / out of owned paths, and the repo has no `tailwindcss-animate` plugin. Module keyframes (`stepEnter` slide, `checkPop`, `fadeUp`) honor `prefers-reduced-motion`.

- **Step transition** = remount-on-`key={step}` re-triggering the `stepEnter` slide. Simple, no extra deps, no layout shift.

- **Voice picker** migrated from a raw `<select>` to the `Select` primitive (matches admin integrations page), satisfying "form fields use Input/Select primitives".

- **Status/error banner** restyled to light tokens (green/red borders on tinted backgrounds). Used literal `#ecfdf5`/`#fef2f2` / `#065f46`/`#991b1b` tints because the token set has no light success/error *surface* tokens — only the accent line colors (`--alliance-green`, `--alliance-red`), which are used for the borders.

- **All logic, API calls, and `data-testid`s preserved** — this is a presentation-only refresh. `page.tsx` unchanged (still renders `OnboardingClient`; shell now comes from `layout.tsx`).

## Scope / verification notes

- `pnpm exec tsc --noEmit`: clean for all owned files. Remaining errors are pre-existing and out of scope — `@playwright/test` not installed + implicit-any in `tests/e2e/*` and `playwright.config.ts`.
- No files touched outside owned paths.
