# S82 — SSO: "Sign in with US Tow"

Wires the dashboard to the central US Tow SSO (OpenID Connect) alongside the
existing password, Google and Roadside logins. Nothing existing is removed.

## Flow

- `GET www/auth/login` (Next route) → `GET api/v1/auth/sso` → SSO `/oauth/authorize` (code + PKCE S256, scope `openid profile email ustow`).
- SSO → `https://www.ustowaiconnect.com/auth/callback` (the registered redirect URI, a Next route) → `api/v1/auth/sso/callback`.
- API exchanges the code (`client_secret_basic`), verifies the RS256 ID token against the SSO JWKS (`iss`, `aud`, `nonce`), reads `/oauth/userinfo`, issues the normal dashboard JWT, redirects to `/auth-callback#token=…&sso=ustow&id_token=…`.
- Logout: `AuthContext.logout` clears the token and, for an SSO session, goes to `api/v1/auth/sso/logout` → SSO `/oauth/logout?post_logout_redirect_uri=https://www.ustowaiconnect.com/`.
- Back-channel logout: `POST api/v1/auth/sso/backchannel-logout` verifies `logout_token`, revokes the `sid` in Redis (7d TTL). `JwtStrategy` rejects any dashboard token carrying a revoked `sid`.

## Decisions

- **Callback stays on the web origin.** The registration says `www/auth/callback`; the OIDC client lives in the API. The Next route forwards the query string through the existing `/api/*` rewrite, so the registered URI is honoured with no API-domain dependency. `redirect_uri` sent to the token endpoint is the web URL.
- **Identity by email, not `sub`.** Same rule as Google/Roadside so one person has one account. `users.sso_sub` is stamped for audit (migration 0058).
- **Org → tenant mapping.** `tenants.sso_org_slug` (new, nullable) is checked first; fallback is `slugify(company_name) === org_slug`. On a match: no membership → auto-join ACTIVE with role from SSO roles (`owner`/`admin` → OWNER, `dispatcher` → DISPATCHER, `driver` → DRIVER, `accounting`/`billing` → ACCOUNTING, else VIEWER); existing member → only `lastLoginAt` is stamped so `login()` lands them there. Local roles are never rewritten by the IdP; SUSPENDED stays suspended. No match → plain sign-in, no auto-join.
- **`apps` gate.** If the `apps` claim lacks `ustowaiconnect` the sign-in is refused with "This app is not on your US Tow dashboard" on `/sign-in`. No platform_admin bypass — the brief is explicit.
- **Roadside SSO left as-is.** It points at a different issuer with its own env vars; removing it is a separate decision. The US Tow button sits above it and is the prominent one.
- **Stateless state JWT** (verifier + nonce), same pattern as Roadside: no cookies, no server session.
- **`jose` added to `@ustow/api`** for JWKS verification (RS256). Only new dependency.
- **Redis revocation fails open** on a Redis error so a cache blip cannot lock every SSO user out.
- **`sid` propagates** through `switchTenant` / `impersonate` so back-channel logout still applies after a tenant switch.

## Env (api service)

`SSO_ISSUER` (default `https://us-tow-sso-production.up.railway.app`), `SSO_CLIENT_ID` (default `ustowaiconnect`), `SSO_CLIENT_SECRET` (required, Railway only), `SSO_REDIRECT_URI` (default `https://www.ustowaiconnect.com/auth/callback` in production).

## Not verified

- End-to-end against the live SSO — needs `SSO_CLIENT_SECRET` in Railway and the back-channel URL `https://www.ustowaiconnect.com/api/v1/auth/sso/backchannel-logout` registered on the SSO side.
- Migration 0058 runs on the next API boot (`node dist/db/migrate.js`); not run here (no DB).
