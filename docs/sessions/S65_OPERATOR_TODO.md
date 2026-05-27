# Session 65 — Operator TODO

After this PR is merged and Railway has redeployed (~60-90 s):

1. **Confirm migration 0027 applied on prod**

   Open the prod Postgres console and run:

   ```sql
   SELECT column_name
     FROM information_schema.columns
    WHERE table_name = 'tenant_credentials'
      AND column_name IN (
        'failure_reason',
        'failure_kind',
        'failed_login_count',
        'last_failure_at'
      );
   ```

   You should see all four rows. If you see fewer, the post-merge
   migration didn't fire — apply it manually with the same proxy URL
   approach used during the May 27 tenant-zero recovery:

   ```bash
   DATABASE_URL="<railway-public-postgres-url>" \
     pnpm --filter @ustow/api db:migrate
   ```

2. **Re-enable tenant zero**

   The author of S65 paused tenant zero before pushing so the new code
   doesn't keep hammering Towbook. Once you've decided what to do about
   the failing credentials (rotate password? reset Towbook session?
   wait?), flip the flag back:

   ```sql
   UPDATE tenants
      SET is_active = TRUE, updated_at = NOW()
    WHERE id = '00000000-0000-0000-0000-000000000001';
   ```

3. **Watch the next failure surface in the admin UI**

   Reload `/admin/integrations`. The page should now show, in addition
   to "Sessions Status: FAILED":

   - **Failure kind** (LAUNCH / AUTH / CAPTCHA / SELECTOR / TIMEOUT /
     NAVIGATION / NETWORK / UNKNOWN)
   - **Failure reason** (the raw exception .message)
   - **Failed login count** (the monotonic counter)
   - **Last failure at**

   That tells you exactly which adapter step blew up. From there:

   - `LAUNCH` → Playwright Chromium isn't installed or its
     system libraries are missing in the container. Rebuild the Docker
     image with the playwright stage's COPY intact.
   - `SELECTOR` → Towbook changed its login markup. The adapter needs
     a selector update.
   - `AUTH` → Credentials are wrong, or Towbook is rejecting them
     (account lock / MFA gate).
   - `CAPTCHA` → Towbook fired a bot check. This is a Towbook-side
     event; there is no in-product fix.
   - `TIMEOUT` / `NETWORK` → Likely transient. Wait a cycle.

4. **Clear the failed_login_count after fixing the underlying issue**

   The circuit breaker stays open for an hour after the third
   consecutive failure. If you fix the credentials sooner than that,
   the next successful login will auto-clear the counter. If you want
   to force a retry immediately:

   ```sql
   UPDATE tenant_credentials
      SET failed_login_count = 0,
          updated_at = NOW()
    WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
   ```

5. **(Optional) Surface failure_reason in the admin UI**

   The API now exposes `failureReason`, `failureKind`,
   `failedLoginCount`, and `lastFailureAt` from
   `GET /v1/admin/integrations`. The web `/admin/integrations` page
   should render them as an alert banner when `sessionStatus = FAILED`.
   If they're not yet rendered, a follow-up session adds a single
   `IntegrationStatusBanner` component.
