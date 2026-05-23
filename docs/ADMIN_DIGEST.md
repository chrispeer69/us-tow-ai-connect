# Admin Digest

Session 26 (Bundle B section 3). Daily and weekly summary emails that
give the tenant operator a one-glance view of what AI-Connect did since
yesterday / since last week.

## What's in the email

| Section              | Metric                                  | Source table                    |
|----------------------|-----------------------------------------|---------------------------------|
| Call activity        | Calls handled by AI, count + total min  | `call_interactions`             |
| Call activity        | Avg call duration (s)                   | `call_interactions.duration_sec`|
| Call activity        | Conversion (calls → jobs) %             | derived                         |
| Jobs created         | Total + by-source breakdown             | `unified_jobs.source` (+ `dispatch_requests` fallback) |
| Jobs created         | Total jobs completed in window          | `unified_jobs.completed_at`     |
| Top decline reasons  | 5 reasons by count                      | `dispatch_decisions` where `decision='decline'` |
| Driver activity      | Active drivers, miles est, jobs/driver  | `driver_pings`, `driver_job_events` |
| Top callers          | 5 numbers by call count (last 4 only)   | `call_interactions.caller_phone`|
| Reliability signals  | Failed SMS sends, rate-limit hits       | `sms_messages` + `api_key_usage_stats` |

Each metric is wrapped in a `try/catch` — if the source table is missing
on a dev DB the section renders as zero rather than crashing the whole
digest. Production tenants should see real numbers.

## Configuring recipients & frequency

- UI: `/admin/digest` — enter comma-separated addresses, pick
  daily / weekly / off, save.
- API: `PUT /v1/admin/digest` with body
  `{ digestEmails: string[], digestFrequency: 'daily'|'weekly'|'off' }`.
- DB: `tenants.digest_emails` (jsonb[]) + `tenants.digest_frequency`
  (default `'daily'`).

Cron times (server-local):
- daily — `0 8 * * *` (08:00 every day)
- weekly — `0 8 * * 1` (08:00 Monday)

A tenant's row is included in a run only when `digest_frequency` matches
the run's range. Setting frequency to `'off'` opts the tenant out
without losing the recipient list.

## Send-now & preview

- `POST /v1/admin/digest/test?range=daily|weekly` — fires the digest
  immediately to the current tenant's recipient list, returns
  `{ sent, recipients, range }`.
- `GET /v1/admin/digest/preview?range=daily|weekly` — returns the HTML
  body without sending. Used by the admin UI's iframe preview.

## SendGrid setup

Set `SENDGRID_API_KEY` in the Railway environment. The from-address is
`DIGEST_EMAIL_FROM` (falls back to `ALERT_EMAIL_FROM`, then to
`alerts@ustowdispatch.com`).

When `SENDGRID_API_KEY` is unset or starts with `REPLACE_ME`:

- The email is **not** sent to SendGrid.
- A row still lands in `email_messages` with `status='logged_only'`.
- The subject + recipient are logged at INFO so a dev still sees what
  would have shipped.

This is the same pattern as `TwilioSmsService` (logged_only when
unconfigured). Blockers are documented in `docs/BLOCKERS.md`.

## `email_messages` table

Audit log of every send attempt. One row per (tenant, recipient,
attempt). Columns:

```
id, tenant_id, to_address, from_address, subject, html_body, text_body,
sendgrid_message_id, status, related_kind, related_id, sent_at,
delivered_at, error, created_at
```

`status` values:
- `queued` — row written, SendGrid call in flight
- `sent` — provider accepted (event webhook may upgrade to `delivered`
  later — not yet wired)
- `delivered` — reserved for inbound SendGrid event webhook
- `bounced` — reserved for inbound SendGrid event webhook
- `failed` — provider rejected; `error` column has the message
- `logged_only` — SendGrid not configured; nothing sent

Querying:

```sql
SELECT created_at, to_address, subject, status, error
FROM email_messages
WHERE tenant_id = '...' AND related_kind = 'admin_digest'
ORDER BY created_at DESC
LIMIT 20;
```

## HTML template

Built inline in `digest-renderer.ts`. No images, no external CSS, no web
fonts — every Gmail / Outlook / mobile client renders the same. Source
counts use a `█`/`░` sparkline bar so a text-only preview still shows
relative share.

Render is deterministic given `(metrics, tenantName, webBaseUrl)`; tests
snapshot the HTML for known fixture metrics.
