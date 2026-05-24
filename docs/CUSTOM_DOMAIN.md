# Custom domain — registrar → DNS → Railway → SSL

Goal: bring `ustow-aiconnect.com` (or the operator's chosen domain) online with
the least friction. The code is already domain-flexible — adding a domain is an
`ALLOWED_DOMAINS` env edit plus DNS + Railway config, **no code change**
(see §3). Work top-to-bottom; §10 is the order-of-operations summary.

Related: [`DEPLOY_RAILWAY.md`](./DEPLOY_RAILWAY.md) (deploy runbook),
[`scripts/domain/verify-domain.sh`](../scripts/domain/verify-domain.sh) (the gate).

---

## 1. Decision matrix — which domain

Chris flagged **`ustow-aiconnect.com`** as preferred. Recommendation: register it.

| Candidate              | Pros                                              | Cons                                  |
| ---------------------- | ------------------------------------------------- | ------------------------------------- |
| **ustow-aiconnect.com** (preferred) | Matches brand; `.com` = default trust, best deliverability/SEO | Hyphen is slightly harder to dictate verbally |
| ustowaiconnect.com     | No hyphen, cleaner to say                          | "ustowai..." reads ambiguously        |
| ustow-aiconnect.ai     | On-trend for an AI product                         | ~10× the price; weaker email trust; some spam filters distrust `.ai` |
| ustow-aiconnect.io     | Common for tech/SaaS                                | Pricier than `.com`; no brand upside here |

**TLD call:** `.com`. It carries the strongest default trust for email
deliverability (this matters once SPF/DKIM go live, §7) and avoids the price and
filter quirks of `.ai`/`.io`. **Defensive registrations** (optional, cheap):
grab `ustowaiconnect.com` and `.net` and 301-redirect them to the apex so a
mistyped/no-hyphen variant still lands.

---

## 2. Registrar — Cloudflare or Porkbun

Both give **free WHOIS privacy, free SSL, fast anycast DNS, and no renewal
upsells** — the qualities that matter. Pick one:

- **Cloudflare Registrar** — at-cost pricing (no markup), privacy on by default,
  excellent DNS UI + API, free proxy/CDN if wanted later. Requires moving DNS to
  Cloudflare (fine — we want their DNS anyway). *Recommended.*
- **Porkbun** — cheap, privacy free, clean UI, good if you'd rather not put DNS
  behind Cloudflare's proxy. Equally fine.

Avoid GoDaddy/Network Solutions: privacy and "premium DNS" are paid add-ons and
the renewal price jumps.

**Purchase flow (Cloudflare):**
1. Create a Cloudflare account → **Registrar → Register Domain**.
2. Search `ustow-aiconnect.com`, add to cart, complete purchase (WHOIS privacy
   is automatic). Optionally add the defensive names from §1.
3. The domain lands in your Cloudflare account with DNS already delegated to
   Cloudflare nameservers — go straight to §4.

**Purchase flow (Porkbun):**
1. Register the domain at porkbun.com (privacy auto-on).
2. Either keep Porkbun DNS, or point nameservers at Cloudflare. Add records in
   whichever DNS dashboard you chose (§4).

> ⚠️ Cloudflare proxy (orange cloud): for Railway custom domains, leave records
> **DNS-only (grey cloud)** initially so Railway can validate and issue the
> Let's Encrypt cert. You can enable the proxy afterward, but then Cloudflare
> terminates TLS and you must set SSL mode to **Full (strict)**. Simplest path:
> grey-cloud and let Railway own TLS (§5).

---

## 3. Code is already domain-flexible (Session 46)

No redeploy of a new image is needed to add a domain — only env:

- **CORS** (`packages/api/src/main.ts`) resolves its allow-list from
  **`ALLOWED_DOMAINS`** (comma-separated origins). Supports a
  `scheme://*.suffix` wildcard for one subdomain label
  (`https://*.up.railway.app`). Legacy `WEB_PUBLIC_URL` + `CORS_EXTRA_ORIGINS`
  are merged in for back-compat; empty everything falls back to
  localhost + `*.up.railway.app`.

  ```
  ALLOWED_DOMAINS=https://app.ustow-aiconnect.com,https://api.ustow-aiconnect.com,https://*.up.railway.app
  ```

- **CSP — `frame-ancestors`:** the API serves JSON and ships
  `default-src 'none'; frame-ancestors 'none'` (AdminCspMiddleware). That is
  stricter than any allow-list and is left as-is — do not weaken it.

- **CSP — `connect-src` (web tier):** the browser must be allowed to reach the
  API origin. `packages/web` owns its CSP via Next.js headers. Emit a
  `connect-src` built from the **same** allow-list — the API exports the
  contract helper `buildConnectSrcDirective()` in
  `packages/api/src/common/utils/allowed-domains.ts`:

  ```
  Content-Security-Policy: connect-src 'self' https://api.ustow-aiconnect.com; ...
  ```

- **Cookies:** the API is **header/token-auth and sets no cookies** — nothing to
  configure server-side. If/when the web tier issues a session cookie that must
  be shared across `app.` and `api.`, set its domain to the dotted apex
  `.ustow-aiconnect.com` (helper `parentCookieDomain()` in the same util) with
  `Secure; SameSite=Lax` (or `None` if truly cross-site).

---

## 4. DNS records required

Railway gives each custom domain a CNAME target (shown in the dashboard, §5),
typically `<id>.up.railway.app`. Create:

```
Type   Name        Value                          Proxy
CNAME  api         <api-service>.up.railway.app   DNS-only
CNAME  app         <web-service>.up.railway.app   DNS-only
CNAME  track       <web-service>.up.railway.app   DNS-only   (optional, §6)
CNAME  status      <status-host>                  DNS-only   (optional, §6)
```

Apex (`ustow-aiconnect.com`) → Railway doesn't take a bare apex via CNAME.
Options: (a) use Cloudflare's **CNAME flattening** at the apex pointing to the
web service, or (b) keep the apex as a redirect to `app.` (Cloudflare Redirect
Rule / Porkbun URL forward). Recommendation: `app.` is the product entry; flatten
or redirect the apex to it.

Verify each record before moving on:
```
dig +short api.ustow-aiconnect.com
```

---

## 5. Railway custom domains (per service) + SSL/TLS

Map subdomain → service:

| Subdomain                       | Railway service | Notes                         |
| ------------------------------- | --------------- | ----------------------------- |
| `api.ustow-aiconnect.com`       | `@ustow/api`    | NestJS API                    |
| `app.ustow-aiconnect.com`       | `@ustow/web`    | Next.js admin/web             |
| `marketing.ustow-aiconnect.com` | `@ustow/web` (or static host) | Optional landing page |

Per service:
1. Railway → service → **Settings → Networking → Custom Domain → +**.
2. Enter the FQDN (e.g. `api.ustow-aiconnect.com`). Railway shows the CNAME
   target — put it in DNS (§4) if not already.
3. Railway auto-provisions a **Let's Encrypt** cert once DNS resolves. The
   status flips **Pending → Active** ≈ 30 s–2 min after the CNAME propagates
   (propagation itself can take minutes to an hour depending on TTL). No manual
   cert steps; renewal is automatic.
4. After **both** services show **Active**, set the env vars (§8) and let Railway
   redeploy.

If a domain is stuck "Pending" > a few minutes: the CNAME is wrong, still
proxied (orange cloud — set grey), or DNS hasn't propagated. Check with
`dig +short` and `verify-domain.sh` (§9).

---

## 6. Subdomain strategy

| Sub          | Points to        | Purpose                                              |
| ------------ | ---------------- | ---------------------------------------------------- |
| `api`        | `@ustow/api`     | REST API + webhooks + public Knowledge Pack          |
| `app`        | `@ustow/web`     | Admin / operator web app (primary entry)             |
| `track`      | `@ustow/web`     | Public caller tracking links (white-label, S43)      |
| `driver`     | `@ustow/web`     | Driver PWA (or reuse `app`) — reserve now            |
| `status`     | status page host | Uptime/status page (Better Stack / Instatus) — reserve |
| `docs`       | docs host        | Public docs, if/when needed — reserve                |

Reserve `driver`/`status`/`docs` even if unused — add the CNAME + `ALLOWED_DOMAINS`
entry later. `api` and `app` are the only two required for launch; `track` if
white-label tracking is live.

---

## 7. Email DNS — claim it now even if not sending

Set these even before sending mail: it reserves your sending reputation and
blocks spoofing of your domain.

```
Type   Name              Value
MX     @                 (your mail provider's MX, e.g. Google/Fastly/SendGrid) — only if hosting mailboxes
TXT    @                 v=spf1 include:<provider-spf> ~all
TXT    <selector>._domainkey   v=DKIM1; k=rsa; p=<public-key>     (provider gives this)
TXT    _dmarc            v=DMARC1; p=none; rua=mailto:dmarc@ustow-aiconnect.com; fo=1
```

- **SPF:** start with the transactional provider only (this app sends via
  SendGrid — `include:sendgrid.net`). One SPF TXT record, not multiple.
- **DKIM:** SendGrid/your provider issues the selector + key when you verify the
  domain in their dashboard — paste the CNAME/TXT they give you.
- **DMARC:** begin at `p=none` (monitor-only) with `rua=` reporting; tighten to
  `quarantine` then `reject` after you've watched reports for a couple weeks.
- If you're **not** hosting mailboxes yet, skip MX but still publish SPF + DMARC
  so nobody can spoof `@ustow-aiconnect.com`.

> The API's `SENDGRID_API_KEY` (see `.env.example`) only sends mail; sender
> domain authentication (SPF/DKIM) is done in the SendGrid dashboard + these DNS
> records, independent of the app.

---

## 8. Env vars after cutover

Once both services are **Active** (§5), set in Railway (per §3 + DEPLOY §3):

```
# api service
ALLOWED_DOMAINS=https://app.ustow-aiconnect.com,https://api.ustow-aiconnect.com,https://*.up.railway.app
PUBLIC_BASE_URL=https://api.ustow-aiconnect.com
WEB_PUBLIC_URL=https://app.ustow-aiconnect.com

# web service
NEXT_PUBLIC_API_URL=https://api.ustow-aiconnect.com
NEXT_PUBLIC_WS_URL=https://api.ustow-aiconnect.com
```

Keep `https://*.up.railway.app` in `ALLOWED_DOMAINS` during the transition so the
old Railway URLs keep working; drop it once the custom domain is the sole entry.
Then re-point the Thinkrr Knowledge Pack + webhook URLs (DEPLOY §13).

---

## 9. Verification checklist

```bash
# 1. Automated gate — DNS + HTTPS 200 + cert > 30 days + SAN. Exit 0 = green.
bash scripts/domain/verify-domain.sh api.ustow-aiconnect.com
bash scripts/domain/verify-domain.sh app.ustow-aiconnect.com   # HEALTH_PATH=/api/health for web

# 2. DNS
dig +short api.ustow-aiconnect.com          # → <id>.up.railway.app → A record

# 3. HTTPS + cert
curl -fsSL https://api.ustow-aiconnect.com/health
echo | openssl s_client -servername api.ustow-aiconnect.com \
  -connect api.ustow-aiconnect.com:443 2>/dev/null | openssl x509 -noout -dates -ext subjectAltName

# 4. Live admin view (super-admin only)
curl -s https://api.ustow-aiconnect.com/v1/system/domain-status \
  -H "x-super-admin-email: <you@ustow-aiconnect.com>" | jq

# 5. Browser: load https://app.ustow-aiconnect.com, confirm padlock + no CORS/CSP
#    errors in the console (the app calls https://api.ustow-aiconnect.com).
# 6. Optional external grade: https://www.ssllabs.com/ssltest/analyze.html?d=api.ustow-aiconnect.com
```

The post-deploy smoke (`scripts/post-deploy-smoke.sh`) covers app behavior;
`verify-domain.sh` covers DNS/cert specifically — run both.

---

## 10. Operator follow-up — order of operations

Do these in order; each depends on the previous:

1. **Buy** `ustow-aiconnect.com` (Cloudflare or Porkbun, §2).
2. **Add CNAMEs** `api` + `app` — *DNS-only / grey cloud* (§4). Get the targets
   from Railway in step 3 first if needed.
3. **Add custom domains** in Railway for `@ustow/api` and `@ustow/web`; wait for
   each to flip **Active** (cert auto-issued, §5).
4. **Run** `verify-domain.sh` for both hosts — proceed only when green (§9).
5. **Set env vars** (§8) on both services; let Railway redeploy.
6. **Re-point Thinkrr** Knowledge Pack + webhook URLs (DEPLOY §13).
7. **Publish email DNS** SPF + DMARC (+ DKIM via SendGrid) (§7).
8. **Smoke** with `post-deploy-smoke.sh` + check `/v1/system/domain-status`.
9. Once stable, **drop** `*.up.railway.app` from `ALLOWED_DOMAINS`.

Until step 1 is done the domain isn't purchased — tracked in `docs/BLOCKERS.md`.
