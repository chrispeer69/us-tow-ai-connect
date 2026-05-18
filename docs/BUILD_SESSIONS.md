# US Tow AI-Connect — Build Sessions

Each session below is a self-contained engineering prompt for Claude Code. Paste the session prompt into Claude Code. It will build that session's deliverables. Do NOT skip sessions. Each session depends on the previous.

---

## SESSION 1: Core Adapter Engine & Towbook Playwright Script

**Context:** You are building US Tow AI-Connect, a NestJS middleware that scrapes towing management software (starting with Towbook) via Playwright headless browser automation. The monorepo is already scaffolded with pnpm workspaces. The adapter interface is defined at `packages/api/src/modules/adapters/adapter.interface.ts`.

**Deliverables:**
1. Implement `packages/api/src/modules/adapters/towbook/towbook.adapter.ts` — a class implementing `TowingSoftwareAdapter` interface.
2. The `lookupByPhone()` method must:
   - Accept a tenantId and phone number.
   - Retrieve the tenant's decrypted Towbook credentials (for now, read from environment variables `TOWBOOK_USERNAME` and `TOWBOOK_PASSWORD`).
   - Launch a Playwright Chromium instance.
   - Navigate to `https://app.towbook.com/Security/Login?ReturnUrl=%2F`.
   - Fill the `#Username` input and `#Password` input.
   - Click the "Log in" button.
   - Wait for the dashboard to load.
   - Use the search functionality to find a job by phone number.
   - Extract: ETA, Driver Name, Job Status, Vehicle description.
   - Return a standardized `AdapterLookupResult`.
3. The `testConnection()` method must attempt login only and return success/failure.
4. Implement `packages/api/src/modules/session-manager/session-manager.service.ts`:
   - Method `saveContext(tenantId, storageState)` — serializes Playwright `browserContext.storageState()` to Redis.
   - Method `getContext(tenantId)` — retrieves serialized context from Redis.
   - Method `hasValidContext(tenantId)` — checks if a non-expired context exists.
5. Update the TowbookAdapter to check for a warm session first (via SessionManager) before doing a full login.

**Acceptance Criteria:**
- Running the TowbookAdapter with valid credentials logs in, searches a phone number, and returns structured data.
- Session context is saved to Redis after successful login.
- Subsequent calls use the saved context (bypassing login) and complete in under 3 seconds.

---

## SESSION 2: NestJS API Endpoints & Authentication

**Context:** The TowbookAdapter and SessionManager from Session 1 are complete. Now build the NestJS REST API layer that Thinkrr.ai will call during live phone conversations.

**Deliverables:**
1. Create `packages/api/src/modules/ai-connect/ai-connect.module.ts` — NestJS module.
2. Create `packages/api/src/modules/ai-connect/ai-connect.controller.ts` with these endpoints:
   - `POST /v1/ai-connect/lookup-eta` — Validates request with `LookupEtaRequestSchema` from `@ustow/shared`. Routes to correct adapter based on tenant config. Returns `LookupEtaResponse`.
   - `GET /v1/ai-connect/transfer-route` — Returns the currently active routing rule phone number for the tenant.
   - `POST /v1/ai-connect/log-interaction` — Validates with `LogInteractionRequestSchema`. Inserts into `interaction_logs` table.
3. Create `packages/api/src/common/guards/api-key.guard.ts`:
   - Extracts `x-api-key` header.
   - Hashes it with bcrypt and compares against `tenants.api_key_hash`.
   - Attaches the tenant object to the request if valid.
   - Returns 401 if invalid.
4. Create `packages/api/src/common/guards/rate-limit.guard.ts`:
   - Redis-backed token bucket. 60 requests per minute per API key.
   - Returns 429 if exceeded.
5. Apply guards to all ai-connect endpoints.

**Acceptance Criteria:**
- `POST /v1/ai-connect/lookup-eta` with a valid API key returns ETA data from Towbook.
- Invalid API keys return 401.
- Exceeding 60 requests/min returns 429.
- All request bodies are validated by Zod; invalid payloads return 400 with descriptive errors.

---

## SESSION 3: Database Schema & Migrations

**Context:** The API endpoints exist but currently use environment variables for credentials. Now implement the full PostgreSQL database with Drizzle ORM.

**Deliverables:**
1. Create `packages/api/src/db/schema.ts` — Full Drizzle schema with these tables:
   - `tenants` (id, company_name, timezone, dispatch_address, target_software_type, api_key_hash, api_key_prefix, is_active, created_at, updated_at)
   - `tenant_credentials` (id, tenant_id, username_encrypted, password_encrypted, encryption_iv, auth_tag, session_status, last_login_success, session_expires_at)
   - `routing_rules` (id, tenant_id, rule_name, phone_number, schedule_cron, is_active_now, priority_order)
   - `interaction_logs` (id, tenant_id, thinkrr_call_id, caller_phone, category, summary, outcome, duration_seconds, latency_ms, interaction_time)
   - `ai_agent_configs` (id, tenant_id, agent_phone_number, greeting_message, service_toggles, default_eta_mins, impound_enabled)
2. Create `packages/api/src/common/utils/encryption.util.ts`:
   - `encrypt(plaintext: string): { encrypted: string, iv: string, authTag: string }`
   - `decrypt(encrypted: string, iv: string, authTag: string): string`
   - Uses AES-256-GCM with the `ENCRYPTION_KEY` env variable.
3. Create `packages/api/drizzle.config.ts` for migrations.
4. Generate initial migration files.
5. Update TowbookAdapter and API endpoints to read from the database instead of environment variables.

**Acceptance Criteria:**
- `pnpm db:generate` creates migration SQL.
- `pnpm db:migrate` applies schema to PostgreSQL.
- Credentials are encrypted before storage and decrypted at runtime for Playwright.
- All API endpoints now query the database for tenant config.

---

## SESSION 4: Admin Dashboard — Integrations Screen

**Context:** The backend is functional. Now build the first admin dashboard screen where tenants configure their towing software credentials.

**Deliverables:**
1. Set up Next.js 15 App Router in `packages/web/` with Tailwind CSS and shadcn/ui.
2. Create layout at `packages/web/src/app/admin/layout.tsx` — Dark theme sidebar matching TowPilot's aesthetic. Navigation items: Integrations, Routing, Calls, AI Agent, Company, Members, API Keys, Billing.
3. Build `packages/web/src/app/admin/integrations/page.tsx`:
   - Software Selector Dropdown (Towbook, TowLogs, Omadi, Beacon, Tracker).
   - Username input field.
   - Password input field (masked).
   - "Save & Encrypt" button — POSTs to API, encrypts and stores credentials.
   - "Test Connection" button — Triggers a headless Playwright test login via API. Shows spinner while testing. Shows green checkmark or red X result.
   - Connection Status Card — Green dot "Connected" or Red dot "Disconnected". Shows "Last synced: [timestamp]".
   - "Force Refresh" button — Clears Redis session and forces new login.

**Acceptance Criteria:**
- Tenant can select Towbook, enter credentials, save them (encrypted in DB).
- "Test Connection" triggers a real Playwright login attempt and reports success/failure.
- Connection status updates in real-time after test.

---

## SESSION 5: Admin Dashboard — Routing Rules Screen

**Context:** Integrations screen is complete. Now build the screen where tenants manage their dynamic call transfer phone numbers.

**Deliverables:**
1. Build `packages/web/src/app/admin/routing/page.tsx`:
   - Active Route Card — Large display showing the currently active transfer number and its label (e.g., "Night Dispatch: +1 614-633-7935"). Green indicator.
   - Rules Table — Columns: Rule Name, Phone Number, Status (Active/Inactive), Actions (Edit, Delete).
   - Manual Toggle — Radio buttons or toggle switches to set which rule is currently active. Only one rule can be active at a time.
   - "Add Rule" button — Opens a modal/drawer with inputs: Rule Name (text), Phone Number (tel input with E.164 validation).
   - Edit and Delete functionality for existing rules.
2. Create corresponding API endpoints in the NestJS backend:
   - `GET /v1/admin/routing-rules` — List all rules for tenant.
   - `POST /v1/admin/routing-rules` — Create new rule.
   - `PATCH /v1/admin/routing-rules/:id` — Update rule.
   - `DELETE /v1/admin/routing-rules/:id` — Delete rule.
   - `POST /v1/admin/routing-rules/:id/activate` — Set as active (deactivates all others).

**Acceptance Criteria:**
- Tenant can add multiple transfer numbers with labels.
- Tenant can toggle which number is currently active.
- The `/v1/ai-connect/transfer-route` endpoint returns the currently active rule's phone number.

---

## SESSION 6: Admin Dashboard — Call Logs Screen

**Context:** Routing is complete. Now build the call history screen.

**Deliverables:**
1. Build `packages/web/src/app/admin/calls/page.tsx`:
   - Filter Bar: Date Range Picker (default: Last 24 hours), Category Dropdown (All, ETA_LOOKUP, NEW_TOW_REQUEST, TRANSFER, etc.), Outcome Dropdown, Search input (by phone number or call ID).
   - Data Table: Columns — Time (formatted), Caller Phone, Category (color-coded badge), Outcome, Duration (formatted mm:ss), Latency (ms).
   - Row Expansion: Clicking a row expands to show the full AI-generated summary text.
   - Pagination: 25 rows per page with Previous/Next controls.
   - "Export CSV" button — Downloads filtered results as CSV.
2. Create corresponding API endpoint:
   - `GET /v1/admin/interaction-logs` — Paginated, filterable query with query params for date_from, date_to, category, outcome, search, page, limit.

**Acceptance Criteria:**
- Call logs display with all columns populated.
- Filters narrow results correctly.
- CSV export works.
- Pagination works.

---

## SESSION 7: Admin Dashboard — AI Agent Config Screen

**Context:** Call logs are complete. Now build the AI agent configuration screen.

**Deliverables:**
1. Build `packages/web/src/app/admin/ai-agent/page.tsx`:
   - Agent Phone Number display (read-only, assigned by system).
   - Greeting Message textarea (max 250 chars) with character counter.
   - Service Toggles Accordion — Each service (Towing, Jump Start, Tire Change, Fuel Delivery, Lockout, Winch Out & Recovery) has:
     - Master toggle: "Offer this service" (on/off).
     - When ON, show sub-options for vehicle classes (Light Duty, Medium Duty, Heavy Duty, Motorcycle).
     - Each vehicle class has a dropdown: [AI Handles, Transfer to Team, Not Offered].
   - Default ETA input (number, in minutes).
   - Impound Enabled toggle.
   - "Save Changes" button with unsaved changes indicator.
2. Create corresponding API endpoints:
   - `GET /v1/admin/agent-config` — Returns current config.
   - `PUT /v1/admin/agent-config` — Updates config. Validates with Zod.

**Acceptance Criteria:**
- All service toggles save correctly to the `ai_agent_configs.service_toggles` JSONB column.
- Greeting message saves and displays correctly.
- Unsaved changes are indicated visually.

---

## SESSION 8: Session Cron Job & Error Recovery

**Context:** All dashboard screens are built. Now implement the background processes that keep sessions alive and handle failures gracefully.

**Deliverables:**
1. Create `packages/api/src/modules/session-manager/session-refresh.cron.ts`:
   - Runs every 15 minutes via NestJS `@Cron('0 */15 * * * *')`.
   - Queries all tenants where `tenant_credentials.session_status = 'ACTIVE'`.
   - For each tenant, checks if the Redis context is within 10 minutes of expiry.
   - If expiring soon, triggers a background re-login via Playwright and saves new context.
   - If login fails, sets `session_status = 'FAILED'` and sends alert email via SendGrid.
2. Implement graceful error handling in the `/lookup-eta` endpoint:
   - If adapter throws `SessionExpiredException`, return: `{ status: "error", code: "SESSION_EXPIRED", message: "Unable to access dispatch system. Transferring to dispatcher." }` and trigger async session refresh.
   - If adapter throws `JobNotFoundException`, return: `{ status: "success", job_found: false, data: null }`.
   - If adapter throws any other error, return 500 with Sentry capture.
3. Create `packages/api/src/common/utils/email.util.ts`:
   - `sendSessionAlert(tenantEmail, companyName)` — Sends "Your connection to [Towbook] has expired. Please log in to US Tow Dispatch and re-enter your credentials."

**Acceptance Criteria:**
- Cron job runs every 15 minutes and refreshes expiring sessions.
- Failed sessions trigger email alerts.
- API returns graceful error responses (never crashes on adapter failure).

---

## SESSION 9: End-to-End Integration Testing

**Context:** All features are built. Now write comprehensive tests.

**Deliverables:**
1. Create `packages/api/src/modules/ai-connect/__tests__/ai-connect.e2e.spec.ts`:
   - Test: Valid API key + valid phone returns ETA data.
   - Test: Valid API key + unknown phone returns job_found: false.
   - Test: Invalid API key returns 401.
   - Test: Rate limit exceeded returns 429.
   - Test: Malformed request body returns 400 with Zod errors.
2. Create `packages/api/src/modules/adapters/towbook/__tests__/towbook.adapter.spec.ts`:
   - Test: Successful login and search (mocked Playwright).
   - Test: Expired session triggers re-login.
   - Test: Invalid credentials throw appropriate error.
3. Create `packages/api/src/modules/session-manager/__tests__/session-manager.spec.ts`:
   - Test: Context saves to Redis.
   - Test: Context retrieves from Redis.
   - Test: Expired context returns null.
4. Create Playwright E2E test at `packages/web/e2e/integrations.spec.ts`:
   - Test: Navigate to integrations page, fill credentials, save, verify status card updates.

**Acceptance Criteria:**
- All unit tests pass with `pnpm test`.
- E2E test passes with `pnpm test:e2e`.
- Code coverage > 80% on critical paths (adapters, guards, session manager).

---

## SESSION 10: Production Deployment & CI/CD

**Context:** All code is tested. Now deploy to production.

**Deliverables:**
1. Create `.github/workflows/deploy.yml`:
   - Trigger: Push to `main` branch.
   - Steps: Install pnpm, install deps, run lint (Biome), run tests (Vitest), build API, build Web, deploy API to Railway, deploy Web to Railway (or Vercel).
2. Create `packages/api/Dockerfile` (if Railway needs it):
   - Multi-stage build: Install deps, build TypeScript, copy dist, install Playwright browsers.
3. Configure Railway services:
   - API service: `packages/api` with environment variables.
   - PostgreSQL add-on.
   - Redis add-on.
4. Set up custom domains:
   - API: `api.ustowdispatch.com`
   - Web: `app.ustowdispatch.com`
5. Configure Sentry project and add DSN to environment.
6. Seed the database with the first tenant (Auto Lyft USA, Inc) and generate an API key.

**Acceptance Criteria:**
- Push to `main` triggers automated deployment.
- `api.ustowdispatch.com/health` returns 200.
- `app.ustowdispatch.com` loads the admin dashboard.
- First tenant can log in and see their dashboard.
- Thinkrr.ai can hit the live API and get responses.
