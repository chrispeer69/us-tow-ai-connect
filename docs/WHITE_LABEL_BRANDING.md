# White-Label Branding

> Per-tenant theming, logo/favicon hosting, and signature copy. Ships in
> Session 27 / Bundle C.

## Schema

Branding lives on the existing `tenants` table as a `jsonb` column
(`tenants.branding`). Single read per request, no JOIN required. The
schema is validated by `BrandingSchema` in `@ustow/shared`:

| Field | Type | Default | Notes |
|---|---|---|---|
| `companyDisplayName` | string | `tenants.companyName` | Falls back to tenant company name. |
| `logoUrl` | string (url) | `''` | Either an external URL or a `/branding/:id/logo.png` URL from our upload endpoint. |
| `faviconUrl` | string (url) | `''` | Same options. Applied via runtime `<link rel="icon">` swap. |
| `primaryColor` | hex | `#3b82f6` | Sets `--brand-primary`. |
| `secondaryColor` | hex | `#1e293b` | Sets `--brand-secondary`. |
| `accentColor` | hex | `#facc15` | Sets `--brand-accent`. |
| `fontFamily` | enum (7 presets) | `Inter` | Sets `--brand-font` to a curated stack. |
| `emailSignatureHtml` | string | `''` | Appended to outbound emails by the (future) signature-aware sender. |
| `smsSignature` | string | `''` | ≤160 chars, used by the SMS service. |
| `supportPhone` | E.164 | `''` | Shown on driver + tracking pages. |
| `supportEmail` | email | `''` | Shown on driver + tracking pages. |
| `customDomain` | string \| null | `null` | Marker for ops — Railway DNS still needs to be configured by hand. |
| `hidePoweredBy` | boolean | `false` | When true, `PoweredByFooter` renders nothing. Defaults to `true` for partner-resold tenants. |

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/v1/admin/branding` | `AdminAuthGuard` | Admin read (defaults merged in). |
| `PUT` | `/v1/admin/branding` | `AdminAuthGuard` | Replace branding (validated). |
| `POST` | `/v1/admin/branding/upload/:kind` | `AdminAuthGuard` | Upload `logo` or `favicon`. Raw image bytes; `Content-Type` header is the MIME. Returns `{url, branding}`. |
| `GET` | `/v1/branding/me` | `TenantApiKeyGuard` | Driver PWA / tracking page read. |
| `GET` | `/branding/public/:tenantId` | none | Public JSON (used by PWA before any user logs in). |
| `GET` | `/branding/:tenantId/:filename` | none | Asset serving. 5-min cache header. |

## Upload limits + storage

- **Max size**: 2 MB. Enforced both in `BrandingAssetsService.validate`
  and by the raw-body middleware (which hard-aborts the request stream
  when the cap is exceeded).
- **Allowed MIME**: `image/png`, `image/jpeg`, `image/webp`,
  `image/svg+xml`, `image/x-icon`.
- **Storage modes** (`PROD_FILE_STORAGE` env):
  - `local` (default): `./data/branding/<tenant_id>/{logo,favicon}.{ext}`
  - `volume`: `/data/branding/<tenant_id>/...` — for Railway Volume
    mounts
  - `s3`: not implemented today. Logs a warning and falls back to local.
    See `docs/BLOCKERS.md` for the unblock checklist.

## Frontend integration

`BrandingProvider` (`packages/web/src/components/branding/BrandingProvider.tsx`)
wraps every admin page via `app/admin/layout.tsx` and accepts a
`tenantId` + `source` (`admin` | `public`). It:

1. Hydrates from defaults so SSR HTML matches the published CSS
   variables in `globals.css`.
2. On mount, fetches the latest branding and applies it via
   `applyBrandingCssVars` — which writes `--brand-primary`,
   `--brand-secondary`, `--brand-accent`, and `--brand-font` to
   `document.documentElement` and swaps the favicon link.

To opt a component into the brand color, use the CSS variable directly:

```tsx
<h2 style={{ color: 'var(--brand-primary)' }}>…</h2>
```

The Tailwind config is not extended — themes ship pre-built and
templates select via CSS vars. This avoids per-tenant Tailwind builds.

## Outbound integration

- `PoweredByFooter` (`packages/web/src/components/branding/PoweredByFooter.tsx`)
  reads `branding.hidePoweredBy` and either renders the footer or
  returns `null`.
- Email + SMS callsites consult `branding.smsSignature` /
  `emailSignatureHtml` (wiring is per-template; the
  `NotificationService` does not auto-append today — see followups).

## Testing

- Vitest: `packages/api/src/modules/branding/branding.service.spec.ts`
- Playwright: `packages/web/tests/e2e/branding.spec.ts` (asserts
  `--brand-primary` reflects the saved color).
