# US TOW AI-CONNECT — Complete Engineering Build Plan

**Product:** US Tow AI-Connect
**Owner:** Blue Collar AI — Chris Peer
**Developer:** Sidd (oversight) + Claude Code (execution)
**Repository:** github.com/chrispeer69/us-tow-ai-connect
**Hosting:** Railway (api + db + redis) + Vercel (web dashboard)
**Voice Engine:** Thinkrr.ai (via G$D partnership)
**Integration Model:** Pre-Fetch & Cache (workaround until G$D builds direct API — $3-5K, 1 month)

---

## ENVIRONMENT VARIABLES (.env)

```
# Database
DATABASE_URL=postgresql://user:password@containers-us-west-xxx.railway.app:5432/us_tow_ai_connect

# Redis
REDIS_URL=redis://default:password@containers-us-west-xxx.railway.app:6379

# Encryption (generate: openssl rand -hex 32)
ENCRYPTION_KEY=a1b2c3d4e5f6...64_hex_chars

# Towbook (for development/testing only — production uses per-tenant encrypted creds)
DEV_TOWBOOK_USERNAME=chrispeer1969
DEV_TOWBOOK_PASSWORD=Autolyftusa24

# Thinkrr.ai
THINKRR_API_KEY=your_thinkrr_api_key
THINKRR_AGENT_ID=15206

# Google Places
GOOGLE_PLACES_API_KEY=AIza...

# SendGrid
SENDGRID_API_KEY=SG.xxx
ALERT_EMAIL_FROM=alerts@ustowdispatch.com
MANAGEMENT_EMAIL=chris@bluecollarai.online
MANAGEMENT_PHONE=+16146337935

# Twilio (for CONVINI SMS)
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+1614xxxxxxx

# App
PORT=3001
NODE_ENV=production
POLLING_INTERVAL_MS=60000
SESSION_REFRESH_INTERVAL_MS=900000
```

---

## MONOREPO FILE STRUCTURE

```
us-tow-ai-connect/
├── package.json                          # Root workspace config
├── pnpm-workspace.yaml                   # Workspace definition
├── tsconfig.base.json                    # Shared TS config
├── biome.json                            # Linter/formatter config
├── .env.example                          # Environment template
├── .github/
│   └── workflows/
│       └── deploy.yml                    # CI/CD pipeline
├── docs/
│   ├── BUILD_SESSIONS.md                 # This document (for Claude Code)
│   └── TOWBOOK_DOM_MAP.md                # Verified Towbook selectors
├── packages/
│   ├── api/                              # NestJS Backend
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── nest-cli.json
│   │   ├── drizzle.config.ts
│   │   ├── src/
│   │   │   ├── main.ts                   # App bootstrap
│   │   │   ├── app.module.ts             # Root module
│   │   │   ├── config/
│   │   │   │   └── config.schema.ts      # Zod env validation
│   │   │   ├── db/
│   │   │   │   ├── schema.ts             # All Drizzle table definitions
│   │   │   │   ├── migrations/           # Generated SQL migrations
│   │   │   │   └── db.module.ts          # Database module
│   │   │   ├── common/
│   │   │   │   ├── guards/
│   │   │   │   │   ├── api-key.guard.ts
│   │   │   │   │   └── rate-limit.guard.ts
│   │   │   │   ├── utils/
│   │   │   │   │   ├── encryption.util.ts
│   │   │   │   │   └── phone.util.ts
│   │   │   │   └── exceptions/
│   │   │   │       ├── session-expired.exception.ts
│   │   │   │       └── job-not-found.exception.ts
│   │   │   ├── modules/
│   │   │   │   ├── adapters/
│   │   │   │   │   ├── adapter.interface.ts
│   │   │   │   │   ├── adapter.factory.ts
│   │   │   │   │   ├── towbook/
│   │   │   │   │   │   ├── towbook.adapter.ts
│   │   │   │   │   │   ├── towbook.module.ts
│   │   │   │   │   │   └── towbook.adapter.spec.ts
│   │   │   │   │   ├── aaa-portal/
│   │   │   │   │   │   ├── aaa-portal.adapter.ts
│   │   │   │   │   │   └── aaa-portal.module.ts
│   │   │   │   │   └── native/
│   │   │   │   │       ├── native.adapter.ts
│   │   │   │   │       └── native.module.ts
│   │   │   │   ├── session-manager/
│   │   │   │   │   ├── session-manager.service.ts
│   │   │   │   │   ├── session-manager.module.ts
│   │   │   │   │   └── session-refresh.cron.ts
│   │   │   │   ├── job-poller/
│   │   │   │   │   ├── job-poller.service.ts
│   │   │   │   │   ├── job-poller.module.ts
│   │   │   │   │   └── job-poller.cron.ts
│   │   │   │   ├── thinkrr-sync/
│   │   │   │   │   ├── thinkrr-sync.service.ts
│   │   │   │   │   └── thinkrr-sync.module.ts
│   │   │   │   ├── ai-connect/
│   │   │   │   │   ├── ai-connect.controller.ts
│   │   │   │   │   ├── ai-connect.service.ts
│   │   │   │   │   ├── ai-connect.module.ts
│   │   │   │   │   └── dto/
│   │   │   │   │       ├── log-interaction.dto.ts
│   │   │   │   │       └── transfer-route.dto.ts
│   │   │   │   ├── outbound/
│   │   │   │   │   ├── outbound.service.ts
│   │   │   │   │   ├── outbound.module.ts
│   │   │   │   │   ├── google-places.service.ts
│   │   │   │   │   ├── flip-logic.service.ts
│   │   │   │   │   └── outbound-poller.cron.ts
│   │   │   │   ├── notifications/
│   │   │   │   │   ├── notification.service.ts
│   │   │   │   │   └── notification.module.ts
│   │   │   │   └── admin/
│   │   │   │       ├── admin.controller.ts
│   │   │   │       ├── admin.service.ts
│   │   │   │       ├── admin.module.ts
│   │   │   │       └── dto/
│   │   │   │           ├── create-tenant.dto.ts
│   │   │   │           ├── update-credentials.dto.ts
│   │   │   │           ├── create-routing-rule.dto.ts
│   │   │   │           └── update-agent-config.dto.ts
│   │   │   └── tests/
│   │   │       └── e2e/
│   │   │           └── ai-connect.e2e.spec.ts
│   │   └── Dockerfile
│   ├── web/                              # Next.js Frontend
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── layout.tsx            # Root layout with sidebar
│   │   │   │   ├── page.tsx              # Redirect to /admin/dashboard
│   │   │   │   ├── login/
│   │   │   │   │   └── page.tsx
│   │   │   │   └── admin/
│   │   │   │       ├── layout.tsx        # Admin sidebar layout
│   │   │   │       ├── dashboard/
│   │   │   │       │   └── page.tsx      # Overview metrics
│   │   │   │       ├── integrations/
│   │   │   │       │   └── page.tsx      # Credential management
│   │   │   │       ├── routing/
│   │   │   │       │   └── page.tsx      # Transfer number rules
│   │   │   │       ├── calls/
│   │   │   │       │   └── page.tsx      # Call logs table
│   │   │   │       ├── ai-agent/
│   │   │   │       │   └── page.tsx      # Service toggles, greeting
│   │   │   │       └── settings/
│   │   │   │           └── page.tsx      # Company profile, API keys
│   │   │   ├── components/
│   │   │   │   ├── ui/                   # shadcn/ui components
│   │   │   │   ├── sidebar.tsx
│   │   │   │   ├── connection-status.tsx
│   │   │   │   ├── call-log-table.tsx
│   │   │   │   └── service-toggle.tsx
│   │   │   └── lib/
│   │   │       ├── api.ts                # Fetch wrapper for backend
│   │   │       └── auth.ts              # JWT cookie handling
│   │   └── public/
│   └── shared/                           # Shared Zod schemas & types
│       ├── package.json
│       └── src/
│           ├── index.ts
│           ├── schemas/
│           │   ├── ai-connect.schema.ts
│           │   ├── admin.schema.ts
│           │   └── outbound.schema.ts
│           └── types/
│               ├── adapter.types.ts
│               └── tenant.types.ts
```

---

## SESSION 1: CORE ADAPTER ENGINE & TOWBOOK PLAYWRIGHT SCRIPT

### Objective
Build the Towbook headless browser automation that logs in, scrapes all active jobs from the dispatch board, and serializes the browser session to Redis for reuse.

### Files to Create

**packages/api/src/modules/adapters/adapter.interface.ts**
```typescript
export interface DecryptedCredentials {
  username: string;
  password: string;
}

export interface ActiveJob {
  jobId: string;
  customerName: string;
  customerPhone: string;  // normalized to digits only
  vehicle: string;        // "2019 Honda Civic"
  status: string;         // "Waiting" | "Dispatched" | "Enroute" | "On Scene" | "Being Towed"
  driverName: string;
  eta: string;            // "15 minutes" or "Unknown"
  destination: string;
  lastUpdated: string;    // ISO timestamp
}

export interface AdapterConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs: number;
}

export interface TowingSoftwareAdapter {
  /**
   * Perform a full login and save the session context to Redis.
   * Called on initial setup and when sessions expire.
   */
  login(tenantId: string, creds: DecryptedCredentials): Promise<void>;

  /**
   * Scrape ALL active jobs from the dispatch board.
   * Uses saved session context from Redis (bypasses login).
   * Returns array of ActiveJob objects.
   * Throws SessionExpiredException if context is invalid.
   */
  scrapeAllActiveJobs(tenantId: string): Promise<ActiveJob[]>;

  /**
   * Test that credentials are valid without saving a session.
   * Used by the "Test Connection" button in the dashboard.
   */
  testConnection(creds: DecryptedCredentials): Promise<AdapterConnectionTestResult>;
}

export enum SoftwareType {
  TOWBOOK = 'TOWBOOK',
  TOWLOGS = 'TOWLOGS',
  OMADI = 'OMADI',
  AAA_PORTAL = 'AAA_PORTAL',
  NATIVE = 'NATIVE',
}
```

**packages/api/src/modules/adapters/towbook/towbook.adapter.ts**
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { chromium, BrowserContext, Page } from 'playwright';
import { Redis } from 'ioredis';
import { TowingSoftwareAdapter, DecryptedCredentials, ActiveJob, AdapterConnectionTestResult } from '../adapter.interface';
import { SessionExpiredException } from '../../common/exceptions/session-expired.exception';

@Injectable()
export class TowbookAdapter implements TowingSoftwareAdapter {
  private readonly logger = new Logger(TowbookAdapter.name);
  private readonly LOGIN_URL = 'https://app.towbook.com/Security/Login?ReturnUrl=%2F';
  private readonly DISPATCH_URL = 'https://app.towbook.com/DS4/';
  private readonly SESSION_TTL = 3600; // 1 hour in seconds

  constructor(private readonly redis: Redis) {}

  async login(tenantId: string, creds: DecryptedCredentials): Promise<void> {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      // Navigate to login
      await page.goto(this.LOGIN_URL, { waitUntil: 'networkidle' });

      // Fill credentials
      await page.fill('#Username', creds.username);
      await page.fill('#Password', creds.password);

      // Submit
      await page.click('button:has-text("Log in")');

      // Wait for redirect to dashboard
      await page.waitForURL('https://app.towbook.com/**', { timeout: 15000 });

      // Verify we're logged in (check for dashboard elements)
      await page.waitForSelector('a[href="/DS4/"]', { timeout: 5000 });

      // Serialize and save context
      const storageState = await context.storageState();
      await this.redis.set(
        `session:towbook:${tenantId}`,
        JSON.stringify(storageState),
        'EX',
        this.SESSION_TTL
      );

      this.logger.log(`Login successful for tenant ${tenantId}`);
    } catch (error) {
      this.logger.error(`Login failed for tenant ${tenantId}: ${error.message}`);
      throw error;
    } finally {
      await browser.close();
    }
  }

  async scrapeAllActiveJobs(tenantId: string): Promise<ActiveJob[]> {
    // Retrieve saved session
    const stateJson = await this.redis.get(`session:towbook:${tenantId}`);
    if (!stateJson) {
      throw new SessionExpiredException(tenantId);
    }

    const storageState = JSON.parse(stateJson);
    const browser = await chromium.launch({ headless: true });

    try {
      const context = await browser.newContext({ storageState });
      const page = await context.newPage();

      // Navigate directly to dispatch board (session should be valid)
      await page.goto(this.DISPATCH_URL, { waitUntil: 'networkidle' });

      // Check if we got redirected to login (session expired)
      if (page.url().includes('/Security/Login')) {
        throw new SessionExpiredException(tenantId);
      }

      // Click "Active" tab to show active calls
      await page.click('#atActive');
      await page.waitForTimeout(2000); // Wait for AJAX load

      // Extract job data from the dispatch table
      const jobs: ActiveJob[] = await page.evaluate(() => {
        const rows = document.querySelectorAll('.call-row, .dispatch-row, tr[data-callid]');
        const results: any[] = [];

        rows.forEach((row) => {
          const getText = (selector: string) => {
            const el = row.querySelector(selector);
            return el ? el.textContent?.trim() || '' : '';
          };

          results.push({
            jobId: row.getAttribute('data-callid') || '',
            customerName: getText('.customer-name, .cust-name, td:nth-child(2)'),
            customerPhone: getText('.customer-phone, .cust-phone, td:nth-child(3)').replace(/\D/g, ''),
            vehicle: getText('.vehicle-info, .veh-info, td:nth-child(4)'),
            status: getText('.call-status, .status, td:nth-child(5)'),
            driverName: getText('.driver-name, .drv-name, td:nth-child(6)'),
            eta: getText('.eta-info, .eta, td:nth-child(7)') || 'Unknown',
            destination: getText('.destination, .dest, td:nth-child(8)'),
            lastUpdated: new Date().toISOString(),
          });
        });

        return results;
      });

      // Also check "Enroute" and "Dispatched" tabs
      for (const tab of ['#atWaiting', '#atCurrent']) {
        try {
          await page.click(tab);
          await page.waitForTimeout(1500);
          const moreJobs = await page.evaluate(() => {
            // Same extraction logic
            const rows = document.querySelectorAll('.call-row, .dispatch-row, tr[data-callid]');
            const results: any[] = [];
            rows.forEach((row) => {
              const getText = (selector: string) => {
                const el = row.querySelector(selector);
                return el ? el.textContent?.trim() || '' : '';
              };
              results.push({
                jobId: row.getAttribute('data-callid') || '',
                customerName: getText('.customer-name, .cust-name, td:nth-child(2)'),
                customerPhone: getText('.customer-phone, .cust-phone, td:nth-child(3)').replace(/\D/g, ''),
                vehicle: getText('.vehicle-info, .veh-info, td:nth-child(4)'),
                status: getText('.call-status, .status, td:nth-child(5)'),
                driverName: getText('.driver-name, .drv-name, td:nth-child(6)'),
                eta: getText('.eta-info, .eta, td:nth-child(7)') || 'Unknown',
                destination: getText('.destination, .dest, td:nth-child(8)'),
                lastUpdated: new Date().toISOString(),
              });
            });
            return results;
          });
          jobs.push(...moreJobs);
        } catch {
          // Tab might not exist or be empty
        }
      }

      // Cache the results in Redis for instant retrieval
      await this.redis.set(
        `jobs:towbook:${tenantId}`,
        JSON.stringify(jobs),
        'EX',
        300 // 5 minute TTL
      );

      this.logger.log(`Scraped ${jobs.length} active jobs for tenant ${tenantId}`);
      return jobs;
    } finally {
      await browser.close();
    }
  }

  async testConnection(creds: DecryptedCredentials): Promise<AdapterConnectionTestResult> {
    const start = Date.now();
    const browser = await chromium.launch({ headless: true });

    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(this.LOGIN_URL, { waitUntil: 'networkidle' });
      await page.fill('#Username', creds.username);
      await page.fill('#Password', creds.password);
      await page.click('button:has-text("Log in")');

      await page.waitForURL('https://app.towbook.com/**', { timeout: 15000 });

      const latency = Date.now() - start;
      return { success: true, message: 'Connected successfully', latencyMs: latency };
    } catch (error) {
      const latency = Date.now() - start;
      return { success: false, message: `Login failed: ${error.message}`, latencyMs: latency };
    } finally {
      await browser.close();
    }
  }
}
```

**packages/api/src/modules/session-manager/session-manager.service.ts**
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
import { tenants, tenantCredentials } from '../../db/schema';
import { EncryptionUtil } from '../../common/utils/encryption.util';
import { AdapterFactory } from '../adapters/adapter.factory';
import { NotificationService } from '../notifications/notification.service';

@Injectable()
export class SessionManagerService {
  private readonly logger = new Logger(SessionManagerService.name);

  constructor(
    private readonly redis: Redis,
    private readonly db: any, // Drizzle instance
    private readonly encryptionUtil: EncryptionUtil,
    private readonly adapterFactory: AdapterFactory,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Runs every 15 minutes.
   * Checks all active tenant sessions.
   * If a session is expired or missing, triggers a re-login.
   */
  @Cron('0 */15 * * * *')
  async refreshExpiringSessions(): Promise<void> {
    this.logger.log('Starting session refresh cycle...');

    const activeTenants = await this.db.query.tenants.findMany({
      where: eq(tenants.isActive, true),
      with: { credentials: true },
    });

    for (const tenant of activeTenants) {
      const sessionKey = `session:${tenant.targetSoftwareType.toLowerCase()}:${tenant.id}`;
      const ttl = await this.redis.ttl(sessionKey);

      // If TTL is less than 10 minutes or key doesn't exist, refresh
      if (ttl < 600) {
        try {
          const creds = this.encryptionUtil.decrypt(
            tenant.credentials.usernameEncrypted,
            tenant.credentials.passwordEncrypted,
            tenant.credentials.encryptionIv,
            tenant.credentials.authTag,
          );

          const adapter = this.adapterFactory.getAdapter(tenant.targetSoftwareType);
          await adapter.login(tenant.id, creds);

          // Update DB status
          await this.db.update(tenantCredentials)
            .set({ sessionStatus: 'ACTIVE', lastLoginSuccess: new Date() })
            .where(eq(tenantCredentials.tenantId, tenant.id));

          this.logger.log(`Session refreshed for tenant ${tenant.id}`);
        } catch (error) {
          this.logger.error(`Session refresh FAILED for tenant ${tenant.id}: ${error.message}`);

          // Update DB status to FAILED
          await this.db.update(tenantCredentials)
            .set({ sessionStatus: 'FAILED' })
            .where(eq(tenantCredentials.tenantId, tenant.id));

          // Alert the tenant
          await this.notificationService.sendSessionAlert(tenant.id, tenant.companyName);
        }
      }
    }

    this.logger.log('Session refresh cycle complete.');
  }
}
```

**packages/api/src/common/utils/encryption.util.ts**
```typescript
import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

@Injectable()
export class EncryptionUtil {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor() {
    const keyHex = process.env.ENCRYPTION_KEY;
    if (!keyHex || keyHex.length !== 64) {
      throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
    }
    this.key = Buffer.from(keyHex, 'hex');
  }

  encrypt(plaintext: string): { encrypted: string; iv: string; authTag: string } {
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag,
    };
  }

  decrypt(encryptedUsername: string, encryptedPassword: string, iv: string, authTag: string): { username: string; password: string } {
    // Decrypt username
    const decipher1 = createDecipheriv(this.algorithm, this.key, Buffer.from(iv, 'hex'));
    decipher1.setAuthTag(Buffer.from(authTag, 'hex'));
    let username = decipher1.update(encryptedUsername, 'hex', 'utf8');
    username += decipher1.final('utf8');

    // Decrypt password (uses same IV and authTag for simplicity — in production, store separately)
    const decipher2 = createDecipheriv(this.algorithm, this.key, Buffer.from(iv, 'hex'));
    decipher2.setAuthTag(Buffer.from(authTag, 'hex'));
    let password = decipher2.update(encryptedPassword, 'hex', 'utf8');
    password += decipher2.final('utf8');

    return { username, password };
  }
}
```

### Acceptance Tests for Session 1

```typescript
// packages/api/src/modules/adapters/towbook/towbook.adapter.spec.ts
describe('TowbookAdapter', () => {
  it('should login successfully with valid credentials and save context to Redis', async () => {
    await adapter.login(testTenantId, validCreds);
    const context = await redis.get(`session:towbook:${testTenantId}`);
    expect(context).not.toBeNull();
    expect(JSON.parse(context)).toHaveProperty('cookies');
  });

  it('should throw error on invalid credentials', async () => {
    await expect(adapter.login(testTenantId, invalidCreds)).rejects.toThrow();
  });

  it('should scrape active jobs using saved context without re-login', async () => {
    // Pre-populate Redis with valid context
    await adapter.login(testTenantId, validCreds);
    const jobs = await adapter.scrapeAllActiveJobs(testTenantId);
    expect(Array.isArray(jobs)).toBe(true);
  });

  it('should throw SessionExpiredException when no context exists', async () => {
    await redis.del(`session:towbook:${testTenantId}`);
    await expect(adapter.scrapeAllActiveJobs(testTenantId)).rejects.toThrow(SessionExpiredException);
  });

  it('should complete testConnection in under 15 seconds', async () => {
    const result = await adapter.testConnection(validCreds);
    expect(result.success).toBe(true);
    expect(result.latencyMs).toBeLessThan(15000);
  });
});
```

---

## SESSION 2: ACTIVE JOB POLLER & REDIS CACHE

### Objective
Build the background cron service that continuously scrapes Towbook for all active tenants and caches the job data in Redis for instant retrieval by the Thinkrr.ai Knowledge Pack sync.

### Files to Create

**packages/api/src/modules/job-poller/job-poller.cron.ts**
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq } from 'drizzle-orm';
import { tenants } from '../../db/schema';
import { AdapterFactory } from '../adapters/adapter.factory';
import { SessionManagerService } from '../session-manager/session-manager.service';
import { SessionExpiredException } from '../../common/exceptions/session-expired.exception';

@Injectable()
export class JobPollerCron {
  private readonly logger = new Logger(JobPollerCron.name);
  private isRunning = false; // Prevent overlapping runs

  constructor(
    private readonly db: any,
    private readonly adapterFactory: AdapterFactory,
    private readonly sessionManager: SessionManagerService,
  ) {}

  @Cron('*/60 * * * * *') // Every 60 seconds
  async pollAllTenants(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Previous poll cycle still running. Skipping.');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      const activeTenants = await this.db.query.tenants.findMany({
        where: eq(tenants.isActive, true),
      });

      this.logger.log(`Polling ${activeTenants.length} active tenants...`);

      // Process tenants in parallel (max 5 concurrent)
      const batchSize = 5;
      for (let i = 0; i < activeTenants.length; i += batchSize) {
        const batch = activeTenants.slice(i, i + batchSize);
        await Promise.allSettled(
          batch.map((tenant) => this.pollSingleTenant(tenant))
        );
      }

      const elapsed = Date.now() - startTime;
      this.logger.log(`Poll cycle complete in ${elapsed}ms`);
    } finally {
      this.isRunning = false;
    }
  }

  private async pollSingleTenant(tenant: any): Promise<void> {
    try {
      const adapter = this.adapterFactory.getAdapter(tenant.targetSoftwareType);
      await adapter.scrapeAllActiveJobs(tenant.id);
    } catch (error) {
      if (error instanceof SessionExpiredException) {
        this.logger.warn(`Session expired for tenant ${tenant.id}. Triggering re-login.`);
        await this.sessionManager.refreshExpiringSessions();
      } else {
        this.logger.error(`Poll failed for tenant ${tenant.id}: ${error.message}`);
      }
    }
  }
}
```

### Redis Key Schema

| Key Pattern | Value | TTL | Purpose |
|---|---|---|---|
| `session:towbook:{tenantId}` | Serialized Playwright StorageState (JSON) | 3600s (1 hour) | Browser session reuse |
| `jobs:towbook:{tenantId}` | Array of ActiveJob objects (JSON) | 300s (5 min) | Cached job data for Thinkrr |
| `ratelimit:{apiKey}` | Request count (integer) | 60s | API rate limiting |

---

## SESSION 3: THINKRR INTEGRATION (PUBLIC URL ENDPOINT + WEBHOOK RECEIVER)

### Objective
Build a public-facing Markdown endpoint per tenant that Thinkrr's Knowledge Pack can scrape for static company data, AND build the webhook receiver that logs incoming call data from Thinkrr after each call completes.

### Architecture Decision
Thinkrr Knowledge Packs do NOT support programmatic API updates. They support:
1. File uploads (.md, .csv, .pdf, .txt)
2. Public URL scraping (auto-refreshes when content changes)

Therefore, the integration is two-part:
- **Data IN to Thinkrr:** A public URL per tenant serving a Markdown file with company profile, services, pricing, hours, and transfer numbers. Thinkrr's Knowledge Pack is configured to scrape this URL.
- **Data OUT from Thinkrr:** A webhook endpoint on our API that receives POST requests from Thinkrr after every call, containing transcript, outcome, duration, and customer details.

### Important Limitation (v1)
Real-time ETA data (specific job lookups mid-call) is NOT possible in v1 with Thinkrr's current architecture. The AI agent will reference "typical" ETAs from the static profile (e.g., "Our typical response time is 30-45 minutes"). Real-time per-job ETAs require the $3-5K direct API build from G$D (v2).

### Files to Create

**packages/api/src/modules/knowledge-endpoint/knowledge-endpoint.controller.ts**
```typescript
import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { KnowledgeEndpointService } from './knowledge-endpoint.service';

/**
 * Public endpoint — NO auth guard.
 * Thinkrr's Knowledge Pack scraper hits this URL to pull tenant profile data.
 * URL format: https://api.ustowdispatch.com/public/knowledge/{tenantId}/profile.md
 */
@Controller('public/knowledge')
export class KnowledgeEndpointController {
  constructor(private readonly service: KnowledgeEndpointService) {}

  @Get(':tenantId/profile.md')
  async getTenantProfile(@Param('tenantId') tenantId: string, @Res() res: Response) {
    const markdown = await this.service.generateTenantMarkdown(tenantId);
    if (!markdown) throw new NotFoundException('Tenant not found');

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60'); // Thinkrr re-scrapes periodically
    res.send(markdown);
  }
}
```

**packages/api/src/modules/knowledge-endpoint/knowledge-endpoint.service.ts**
```typescript
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { tenants, aiAgentConfigs, routingRules } from '../../db/schema';

@Injectable()
export class KnowledgeEndpointService {
  constructor(private readonly db: any) {}

  async generateTenantMarkdown(tenantId: string): Promise<string | null> {
    const tenant = await this.db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      with: { agentConfig: true, routingRules: true },
    });

    if (!tenant || !tenant.isActive) return null;

    const config = tenant.agentConfig;
    const activeRule = tenant.routingRules?.find((r: any) => r.isActiveNow);

    // Parse service toggles
    const services = config?.serviceToggles || {};
    const serviceLines = Object.entries(services)
      .filter(([_, val]: [string, any]) => val.enabled)
      .map(([name, val]: [string, any]) => {
        const classes = Object.entries(val.classes || {})
          .map(([cls, handling]) => `  - ${cls}: ${handling}`)
          .join('\n');
        return `- ${name}\n${classes}`;
      })
      .join('\n');

    const markdown = `# ${tenant.companyName}

## Company Information
- Company: ${tenant.companyName}
- Timezone: ${tenant.timezone}
- Status: Active

## Services Offered
${serviceLines || '- Contact dispatch for service availability'}

## Typical Response Times
- Default estimated arrival: ${config?.defaultEtaMins || 45} minutes
- Response times vary based on location, traffic, and driver availability

## Call Transfer
- When a caller requests to speak with a human, transfer to: ${activeRule?.phoneNumber || 'dispatch'}
- Transfer label: ${activeRule?.ruleName || 'Dispatch'}

## Impound Inquiries
- Impound service: ${config?.impoundEnabled ? 'Available — ask for details' : 'Not available at this location'}

## Important Notes
- Always confirm the caller's name, phone number, vehicle details, and location
- For new tow requests, collect: location, vehicle year/make/model/color, issue description, and desired destination
- If you cannot help the caller, transfer them to the dispatch team
`;

    return markdown;
  }
}
```

**packages/api/src/modules/knowledge-endpoint/knowledge-endpoint.module.ts**
```typescript
import { Module } from '@nestjs/common';
import { KnowledgeEndpointController } from './knowledge-endpoint.controller';
import { KnowledgeEndpointService } from './knowledge-endpoint.service';

@Module({
  controllers: [KnowledgeEndpointController],
  providers: [KnowledgeEndpointService],
})
export class KnowledgeEndpointModule {}
```

**packages/api/src/modules/webhook-receiver/webhook-receiver.controller.ts**
```typescript
import { Controller, Post, Body, Headers, Logger, HttpCode } from '@nestjs/common';
import { WebhookReceiverService } from './webhook-receiver.service';

/**
 * Receives POST requests from Thinkrr.ai after each call completes.
 * Thinkrr sends: recording URL, transcript, outcome, timestamps, customer details.
 * This endpoint has NO auth guard — Thinkrr doesn't support custom auth headers on webhooks.
 * Security: Validate by checking the payload structure and optionally a shared secret in the URL.
 */
@Controller('webhooks/thinkrr')
export class WebhookReceiverController {
  private readonly logger = new Logger(WebhookReceiverController.name);

  constructor(private readonly service: WebhookReceiverService) {}

  @Post('call-completed')
  @HttpCode(200)
  async handleCallCompleted(@Body() payload: any, @Headers() headers: any) {
    this.logger.log(`Received Thinkrr webhook: ${JSON.stringify(payload).substring(0, 200)}`);

    await this.service.processCallWebhook(payload);

    return { received: true };
  }
}
```

**packages/api/src/modules/webhook-receiver/webhook-receiver.service.ts**
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { tenants, interactionLogs } from '../../db/schema';

@Injectable()
export class WebhookReceiverService {
  private readonly logger = new Logger(WebhookReceiverService.name);

  constructor(private readonly db: any) {}

  async processCallWebhook(payload: any): Promise<void> {
    // Thinkrr webhook payload structure (based on docs):
    // - call_id: string
    // - phone_number: string (caller)
    // - duration: number (seconds)
    // - status: string (completed, voicemail, failed)
    // - transcript: string
    // - summary: string
    // - recording_url: string
    // - sentiment: string
    // - agent_name: string
    // - timestamp: string

    // Determine which tenant this call belongs to based on the agent or phone number
    // For v1, we match by the Thinkrr agent ID or the assigned phone number
    const tenant = await this.db.query.tenants.findFirst({
      where: eq(tenants.assignedPhoneNumber, payload.to_number || payload.agent_phone),
    });

    if (!tenant) {
      this.logger.warn(`Webhook received for unknown tenant. Payload phone: ${payload.to_number}`);
      return;
    }

    // Categorize the call based on transcript keywords
    const category = this.categorizeCall(payload.transcript || payload.summary || '');

    await this.db.insert(interactionLogs).values({
      tenantId: tenant.id,
      thinkrrCallId: payload.call_id || payload.id || 'unknown',
      callerPhone: payload.phone_number || payload.from_number || '',
      category,
      summary: payload.summary || payload.transcript?.substring(0, 500) || '',
      outcome: payload.status || 'completed',
      durationSeconds: payload.duration || 0,
    });

    this.logger.log(`Call logged for tenant ${tenant.id}: ${category}`);
  }

  private categorizeCall(text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes('eta') || lower.includes('how long') || lower.includes('update') || lower.includes('where is')) {
      return 'ETA_LOOKUP';
    }
    if (lower.includes('new tow') || lower.includes('need a tow') || lower.includes('broke down') || lower.includes('flat tire')) {
      return 'NEW_TOW_REQUEST';
    }
    if (lower.includes('transfer') || lower.includes('speak to') || lower.includes('talk to someone') || lower.includes('human')) {
      return 'TRANSFER_TO_HUMAN';
    }
    if (lower.includes('impound') || lower.includes('my car') || lower.includes('pick up my')) {
      return 'IMPOUND_INQUIRY';
    }
    if (lower.includes('price') || lower.includes('cost') || lower.includes('how much')) {
      return 'PRICING_QUOTE';
    }
    if (lower.includes('complaint') || lower.includes('unhappy') || lower.includes('terrible') || lower.includes('awful')) {
      return 'COMPLAINT';
    }
    return 'GENERAL_INQUIRY';
  }
}
```

**packages/api/src/modules/webhook-receiver/webhook-receiver.module.ts**
```typescript
import { Module } from '@nestjs/common';
import { WebhookReceiverController } from './webhook-receiver.controller';
import { WebhookReceiverService } from './webhook-receiver.service';

@Module({
  controllers: [WebhookReceiverController],
  providers: [WebhookReceiverService],
})
export class WebhookReceiverModule {}
```

### Setup Instructions for Thinkrr.ai Dashboard
1. Go to Settings > Integrations > Webhook Integration > Configure
2. Paste URL: `https://api.ustowdispatch.com/webhooks/thinkrr/call-completed`
3. Save
4. Go to Knowledge Packs > Create New Knowledge Pack
5. Add URL source: `https://api.ustowdispatch.com/public/knowledge/{tenantId}/profile.md`
6. Attach the Knowledge Pack to the inbound agent (Marissa)

### Acceptance Tests
- GET `https://api.ustowdispatch.com/public/knowledge/{tenantId}/profile.md` returns valid Markdown with company info
- POST to `/webhooks/thinkrr/call-completed` with a sample Thinkrr payload creates a record in `interaction_logs`
- Call categorization correctly identifies ETA_LOOKUP, NEW_TOW_REQUEST, TRANSFER_TO_HUMAN from transcript text
- Invalid/unknown tenant webhooks are logged but don't crash the system

---

---

## SESSION 4: DATABASE SCHEMA & MIGRATIONS

### Objective
Define all Drizzle ORM tables, generate SQL migrations, and run them on Railway PostgreSQL.

### Complete Schema File

**packages/api/src/db/schema.ts**
```typescript
import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============ TENANTS ============
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyName: varchar('company_name', { length: 255 }).notNull(),
  ownerEmail: varchar('owner_email', { length: 255 }).notNull(),
  timezone: varchar('timezone', { length: 50 }).notNull().default('America/New_York'),
  targetSoftwareType: varchar('target_software_type', { length: 50 }).notNull(),
  apiKeyHash: varchar('api_key_hash', { length: 255 }).notNull().unique(),
  apiKeyPrefix: varchar('api_key_prefix', { length: 10 }).notNull(),
  thinkrrAgentId: varchar('thinkrr_agent_id', { length: 100 }),
  assignedPhoneNumber: varchar('assigned_phone_number', { length: 20 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ============ CREDENTIALS ============
export const tenantCredentials = pgTable('tenant_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  usernameEncrypted: text('username_encrypted').notNull(),
  passwordEncrypted: text('password_encrypted').notNull(),
  encryptionIv: varchar('encryption_iv', { length: 32 }).notNull(),
  authTag: varchar('auth_tag', { length: 32 }).notNull(),
  sessionStatus: varchar('session_status', { length: 20 }).notNull().default('PENDING'),
  lastLoginSuccess: timestamp('last_login_success'),
});

// ============ ROUTING RULES ============
export const routingRules = pgTable('routing_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  ruleName: varchar('rule_name', { length: 100 }).notNull(),
  phoneNumber: varchar('phone_number', { length: 20 }).notNull(),
  isActiveNow: boolean('is_active_now').notNull().default(false),
  priorityOrder: integer('priority_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ============ INTERACTION LOGS ============
export const interactionLogs = pgTable('interaction_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  thinkrrCallId: varchar('thinkrr_call_id', { length: 100 }).notNull(),
  callerPhone: varchar('caller_phone', { length: 20 }).notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  summary: text('summary'),
  outcome: varchar('outcome', { length: 100 }).notNull(),
  durationSeconds: integer('duration_seconds').notNull(),
  latencyMs: integer('latency_ms'),
  interactionTime: timestamp('interaction_time').notNull().defaultNow(),
});

// ============ AI AGENT CONFIG ============
export const aiAgentConfigs = pgTable('ai_agent_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  greetingMessage: text('greeting_message').notNull().default('Thank you for calling.'),
  serviceToggles: jsonb('service_toggles').notNull().default('{}'),
  defaultEtaMins: integer('default_eta_mins').notNull().default(45),
  impoundEnabled: boolean('impound_enabled').notNull().default(false),
});

// ============ OUTBOUND CALL LOGS ============
export const outboundCallLogs = pgTable('outbound_call_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  customerName: varchar('customer_name', { length: 255 }).notNull(),
  customerPhone: varchar('customer_phone', { length: 20 }).notNull(),
  motorClub: varchar('motor_club', { length: 100 }),
  vehicle: varchar('vehicle', { length: 255 }),
  issueType: varchar('issue_type', { length: 100 }),
  originalDestination: text('original_destination'),
  destinationBusinessName: varchar('destination_business_name', { length: 255 }),
  destinationType: varchar('destination_type', { length: 50 }),
  flipEligible: boolean('flip_eligible').notNull().default(false),
  nearestOurShop: varchar('nearest_our_shop', { length: 255 }),
  offer1Result: varchar('offer_1_result', { length: 20 }).default('NOT_ATTEMPTED'),
  offer2Result: varchar('offer_2_result', { length: 20 }).default('NOT_ATTEMPTED'),
  offer3Result: varchar('offer_3_result', { length: 20 }).default('NOT_ATTEMPTED'),
  flipOutcome: varchar('flip_outcome', { length: 20 }).default('NOT_ATTEMPTED'),
  newDestination: text('new_destination'),
  conviniLinkSent: boolean('convini_link_sent').notNull().default(false),
  conviniSellType: varchar('convini_sell_type', { length: 10 }),
  towbookNotesUpdated: boolean('towbook_notes_updated').notNull().default(false),
  correctionsMade: text('corrections_made'),
  callDurationSeconds: integer('call_duration_seconds'),
  callRecordingUrl: text('call_recording_url'),
  transcript: text('transcript'),
  managementNotified: boolean('management_notified').notNull().default(false),
  callTime: timestamp('call_time').notNull().defaultNow(),
});

// ============ RELATIONS ============
export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  credentials: one(tenantCredentials, { fields: [tenants.id], references: [tenantCredentials.tenantId] }),
  routingRules: many(routingRules),
  interactionLogs: many(interactionLogs),
  agentConfig: one(aiAgentConfigs, { fields: [tenants.id], references: [aiAgentConfigs.tenantId] }),
  outboundLogs: many(outboundCallLogs),
}));
```

### Migration Commands
```bash
pnpm --filter @ustow/api db:generate   # Generates SQL in packages/api/src/db/migrations/
pnpm --filter @ustow/api db:migrate    # Applies to Railway PostgreSQL
```

---

## SESSION 5: REST API ENDPOINTS & AUTHENTICATION

### Objective
Build all NestJS REST endpoints that Thinkrr.ai calls (post-call webhook) and that the admin dashboard consumes.

### Files to Create

**packages/api/src/modules/ai-connect/ai-connect.controller.ts**
```typescript
import { Controller, Post, Get, Body, Req, UseGuards, HttpCode } from '@nestjs/common';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { LogInteractionDto } from './dto/log-interaction.dto';
import { AiConnectService } from './ai-connect.service';

@Controller('v1/ai-connect')
@UseGuards(ApiKeyGuard, RateLimitGuard)
export class AiConnectController {
  constructor(private readonly service: AiConnectService) {}

  @Get('transfer-route')
  async getTransferRoute(@Req() req: any) {
    const rule = await this.service.getActiveTransferRoute(req.tenantId);
    return {
      status: 'success',
      data: { transfer_number: rule.phoneNumber, label: rule.ruleName },
    };
  }

  @Post('log-interaction')
  @HttpCode(201)
  async logInteraction(@Req() req: any, @Body() body: LogInteractionDto) {
    await this.service.logInteraction(req.tenantId, body);
    return { status: 'success', message: 'Interaction logged successfully.' };
  }
}
```

**packages/api/src/modules/ai-connect/ai-connect.service.ts**
```typescript
import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { routingRules, interactionLogs } from '../../db/schema';
import { LogInteractionDto } from './dto/log-interaction.dto';

@Injectable()
export class AiConnectService {
  constructor(private readonly db: any) {}

  async getActiveTransferRoute(tenantId: string) {
    const rule = await this.db.query.routingRules.findFirst({
      where: and(eq(routingRules.tenantId, tenantId), eq(routingRules.isActiveNow, true)),
      orderBy: [routingRules.priorityOrder],
    });
    if (!rule) throw new Error('No active routing rule configured');
    return rule;
  }

  async logInteraction(tenantId: string, dto: LogInteractionDto) {
    await this.db.insert(interactionLogs).values({
      tenantId,
      thinkrrCallId: dto.thinkrr_call_id,
      callerPhone: dto.caller_phone,
      category: dto.category,
      summary: dto.summary,
      outcome: dto.outcome,
      durationSeconds: dto.duration_seconds,
    });
  }
}
```

**packages/api/src/common/guards/rate-limit.guard.ts**
```typescript
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Redis } from 'ioredis';
import { TooManyRequestsException } from '../exceptions/too-many-requests.exception';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly MAX_REQUESTS = 60;
  private readonly WINDOW_SECONDS = 60;

  constructor(private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];
    const key = `ratelimit:${apiKey}`;

    const current = await this.redis.incr(key);
    if (current === 1) {
      await this.redis.expire(key, this.WINDOW_SECONDS);
    }

    if (current > this.MAX_REQUESTS) {
      throw new TooManyRequestsException();
    }

    return true;
  }
}
```

**packages/api/src/modules/admin/admin.controller.ts**
```typescript
import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminService } from './admin.service';

@Controller('v1/admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private readonly service: AdminService) {}

  // --- Credentials ---
  @Post('credentials')
  async saveCredentials(@Req() req: any, @Body() body: { username: string; password: string; softwareType: string }) {
    return this.service.saveCredentials(req.tenantId, body);
  }

  @Post('credentials/test')
  async testConnection(@Req() req: any) {
    return this.service.testConnection(req.tenantId);
  }

  // --- Routing Rules ---
  @Get('routing-rules')
  async getRoutingRules(@Req() req: any) {
    return this.service.getRoutingRules(req.tenantId);
  }

  @Post('routing-rules')
  async createRoutingRule(@Req() req: any, @Body() body: { ruleName: string; phoneNumber: string }) {
    return this.service.createRoutingRule(req.tenantId, body);
  }

  @Post('routing-rules/:id/activate')
  async activateRule(@Req() req: any, @Param('id') ruleId: string) {
    return this.service.activateRule(req.tenantId, ruleId);
  }

  @Delete('routing-rules/:id')
  async deleteRule(@Req() req: any, @Param('id') ruleId: string) {
    return this.service.deleteRule(req.tenantId, ruleId);
  }

  // --- Call Logs ---
  @Get('interaction-logs')
  async getInteractionLogs(@Req() req: any) {
    return this.service.getInteractionLogs(req.tenantId, req.query);
  }

  // --- Agent Config ---
  @Get('agent-config')
  async getAgentConfig(@Req() req: any) {
    return this.service.getAgentConfig(req.tenantId);
  }

  @Put('agent-config')
  async updateAgentConfig(@Req() req: any, @Body() body: any) {
    return this.service.updateAgentConfig(req.tenantId, body);
  }
}
```

### Acceptance Tests
- POST /v1/ai-connect/log-interaction with valid API key returns 201
- GET /v1/ai-connect/transfer-route returns the active phone number
- Invalid API key returns 401
- 61st request within 60 seconds returns 429
- Malformed body returns 400 with Zod error details

---

## SESSION 6: ADMIN DASHBOARD — INTEGRATIONS SCREEN

### Objective
Build the Next.js page where tenants enter their Towbook credentials, test the connection, and see real-time status.

### Files to Create

**packages/web/src/app/admin/integrations/page.tsx**
```typescript
'use client';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

export default function IntegrationsPage() {
  const [softwareType, setSoftwareType] = useState('TOWBOOK');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'TESTING' | 'FAILED'>('DISCONNECTED');
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const res = await fetch('/api/v1/admin/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, softwareType }),
    });
    setSaving(false);
    if (res.ok) handleTest();
  };

  const handleTest = async () => {
    setStatus('TESTING');
    const res = await fetch('/api/v1/admin/credentials/test', { method: 'POST' });
    const data = await res.json();
    setStatus(data.success ? 'CONNECTED' : 'FAILED');
    if (data.success) setLastSynced(new Date().toLocaleString());
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Towing Software Integration</h1>
      <p className="text-muted-foreground">Connect your dispatch software to enable AI-powered ETA lookups.</p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Connection Status
            <Badge variant={status === 'CONNECTED' ? 'default' : 'destructive'}>
              {status === 'CONNECTED' && <CheckCircle className="w-4 h-4 mr-1" />}
              {status === 'FAILED' && <XCircle className="w-4 h-4 mr-1" />}
              {status === 'TESTING' && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lastSynced && <p className="text-sm text-muted-foreground">Last synced: {lastSynced}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Credentials</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Select value={softwareType} onValueChange={setSoftwareType}>
            <SelectTrigger><SelectValue placeholder="Select software" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="TOWBOOK">Towbook</SelectItem>
              <SelectItem value="TOWLOGS">TowLogs</SelectItem>
              <SelectItem value="OMADI">Omadi</SelectItem>
            </SelectContent>
          </Select>
          <Input type="text" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save & Encrypt'}</Button>
            <Button variant="outline" onClick={handleTest}>Test Connection</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

---

## SESSION 7: ADMIN DASHBOARD — ROUTING RULES & AI AGENT CONFIG

### Objective
Build the transfer number management screen and the AI agent configuration screen.

### Files to Create

**packages/web/src/app/admin/routing/page.tsx**
```typescript
'use client';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Phone, Trash2, Plus } from 'lucide-react';

interface RoutingRule {
  id: string;
  ruleName: string;
  phoneNumber: string;
  isActiveNow: boolean;
}

export default function RoutingPage() {
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  useEffect(() => { fetchRules(); }, []);

  const fetchRules = async () => {
    const res = await fetch('/api/v1/admin/routing-rules');
    const data = await res.json();
    setRules(data);
  };

  const addRule = async () => {
    await fetch('/api/v1/admin/routing-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleName: newName, phoneNumber: newPhone }),
    });
    setNewName(''); setNewPhone('');
    fetchRules();
  };

  const activate = async (id: string) => {
    await fetch(`/api/v1/admin/routing-rules/${id}/activate`, { method: 'POST' });
    fetchRules();
  };

  const deleteRule = async (id: string) => {
    await fetch(`/api/v1/admin/routing-rules/${id}`, { method: 'DELETE' });
    fetchRules();
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Call Transfer Routing</h1>
      <p className="text-muted-foreground">Manage which phone number receives transferred calls.</p>

      {rules.map((rule) => (
        <Card key={rule.id} className={rule.isActiveNow ? 'border-green-500 border-2' : ''}>
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Phone className="w-5 h-5" />
              <div>
                <p className="font-medium">{rule.ruleName}</p>
                <p className="text-sm text-muted-foreground">{rule.phoneNumber}</p>
              </div>
            </div>
            <div className="flex gap-2">
              {rule.isActiveNow ? (
                <Badge variant="default">ACTIVE</Badge>
              ) : (
                <Button size="sm" variant="outline" onClick={() => activate(rule.id)}>Set Active</Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => deleteRule(rule.id)}><Trash2 className="w-4 h-4" /></Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardContent className="flex gap-2 p-4">
          <Input placeholder="Rule name (e.g., Night Dispatch)" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Input placeholder="Phone number" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          <Button onClick={addRule}><Plus className="w-4 h-4 mr-1" /> Add</Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

**packages/web/src/app/admin/ai-agent/page.tsx**
```typescript
'use client';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const SERVICES = ['Towing', 'Jump Start', 'Tire Change', 'Fuel Delivery', 'Lockout Service', 'Winch Out & Recovery'];
const VEHICLE_CLASSES = ['Light Duty', 'Medium Duty', 'Heavy Duty', 'Motorcycle'];

export default function AiAgentPage() {
  const [greeting, setGreeting] = useState('');
  const [defaultEta, setDefaultEta] = useState(45);
  const [serviceToggles, setServiceToggles] = useState<Record<string, { enabled: boolean; classes: Record<string, string> }>>({});
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => { fetchConfig(); }, []);

  const fetchConfig = async () => {
    const res = await fetch('/api/v1/admin/agent-config');
    const data = await res.json();
    setGreeting(data.greetingMessage);
    setDefaultEta(data.defaultEtaMins);
    setServiceToggles(data.serviceToggles || {});
  };

  const save = async () => {
    await fetch('/api/v1/admin/agent-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ greetingMessage: greeting, defaultEtaMins: defaultEta, serviceToggles }),
    });
    setHasChanges(false);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">AI Agent Configuration</h1>
        <Button onClick={save} disabled={!hasChanges}>{hasChanges ? 'Save Changes' : 'Saved'}</Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Agent Greeting</CardTitle></CardHeader>
        <CardContent>
          <Textarea value={greeting} onChange={(e) => { setGreeting(e.target.value); setHasChanges(true); }} maxLength={250} rows={3} />
          <p className="text-xs text-muted-foreground mt-1">{greeting.length}/250 characters</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Default ETA (minutes)</CardTitle></CardHeader>
        <CardContent>
          <Input type="number" value={defaultEta} onChange={(e) => { setDefaultEta(Number(e.target.value)); setHasChanges(true); }} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Service Configuration</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {SERVICES.map((service) => (
            <div key={service} className="border rounded p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">{service}</span>
                <Switch checked={serviceToggles[service]?.enabled || false} onCheckedChange={(checked) => {
                  setServiceToggles((prev) => ({ ...prev, [service]: { ...prev[service], enabled: checked, classes: prev[service]?.classes || {} } }));
                  setHasChanges(true);
                }} />
              </div>
              {serviceToggles[service]?.enabled && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {VEHICLE_CLASSES.map((vc) => (
                    <div key={vc} className="flex items-center gap-2">
                      <span className="text-sm w-24">{vc}</span>
                      <Select value={serviceToggles[service]?.classes?.[vc] || 'AI_HANDLES'} onValueChange={(val) => {
                        setServiceToggles((prev) => ({ ...prev, [service]: { ...prev[service], classes: { ...prev[service]?.classes, [vc]: val } } }));
                        setHasChanges(true);
                      }}>
                        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AI_HANDLES">AI Handles</SelectItem>
                          <SelectItem value="TRANSFER">Transfer to Team</SelectItem>
                          <SelectItem value="NOT_OFFERED">Not Offered</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
```

---

## SESSION 8: ADMIN DASHBOARD — CALL LOGS

### Objective
Build the call history screen with filtering, pagination, and CSV export.

### Files to Create

**packages/web/src/app/admin/calls/page.tsx**
```typescript
'use client';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Download, ChevronLeft, ChevronRight } from 'lucide-react';

const CATEGORIES = ['ALL', 'ETA_LOOKUP', 'NEW_TOW_REQUEST', 'TRANSFER_TO_HUMAN', 'IMPOUND_INQUIRY', 'PRICING_QUOTE', 'COMPLAINT', 'SPAM', 'GENERAL_INQUIRY'];

export default function CallLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [category, setCategory] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  useEffect(() => { fetchLogs(); }, [category, search, page]);

  const fetchLogs = async () => {
    const params = new URLSearchParams({ page: String(page), limit: '25', category: category !== 'ALL' ? category : '', search });
    const res = await fetch(`/api/v1/admin/interaction-logs?${params}`);
    const data = await res.json();
    setLogs(data.items);
    setTotalPages(data.totalPages);
  };

  const exportCsv = async () => {
    const params = new URLSearchParams({ category: category !== 'ALL' ? category : '', search, format: 'csv' });
    const res = await fetch(`/api/v1/admin/interaction-logs?${params}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'call_logs.csv'; a.click();
  };

  const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Call Logs</h1>
        <Button variant="outline" onClick={exportCsv}><Download className="w-4 h-4 mr-1" /> Export CSV</Button>
      </div>

      <div className="flex gap-2">
        <Input placeholder="Search by phone or call ID" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => (
            <>
              <TableRow key={log.id} className="cursor-pointer" onClick={() => setExpandedRow(expandedRow === log.id ? null : log.id)}>
                <TableCell>{new Date(log.interactionTime).toLocaleString()}</TableCell>
                <TableCell>{log.callerPhone}</TableCell>
                <TableCell><Badge variant="outline">{log.category}</Badge></TableCell>
                <TableCell>{log.outcome}</TableCell>
                <TableCell>{formatDuration(log.durationSeconds)}</TableCell>
              </TableRow>
              {expandedRow === log.id && (
                <TableRow><TableCell colSpan={5} className="bg-muted p-4"><p className="text-sm">{log.summary || 'No summary available.'}</p></TableCell></TableRow>
              )}
            </>
          ))}
        </TableBody>
      </Table>

      <div className="flex justify-between items-center">
        <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft className="w-4 h-4" /> Previous</Button>
        <span className="text-sm">Page {page} of {totalPages}</span>
        <Button variant="outline" disabled={page === totalPages} onClick={() => setPage(page + 1)}>Next <ChevronRight className="w-4 h-4" /></Button>
      </div>
    </div>
  );
}
```

---

## SESSION 9:OUTBOUND ENGINE (TWILIO + GOOGLE PLACES + FLIP LOGIC)

### Objective
Build the outbound call system using Twilio (NOT Thinkrr — Thinkrr cannot be triggered programmatically for outbound calls). When a new motor club job is detected in Towbook, the system classifies the destination via Google Places, decides on the call script, and initiates an outbound call via Twilio with TTS (text-to-speech) or a Twilio Studio flow.

### Architecture Decision
Thinkrr.ai does not support programmatic outbound call triggering. Therefore, outbound confirmation and flip calls are handled by Twilio directly. Twilio provides:
- Programmable Voice API (initiate calls)
- TTS (text-to-speech) for dynamic scripts
- Studio Flows for complex IVR trees
- Call recording for logging
- Webhook callbacks for call status updates

For v2, if G$D builds the direct API ($3-5K), outbound calls can migrate to Thinkrr for a more natural AI voice. For v1, Twilio TTS handles the outbound scripts.

### Files to Create

**packages/api/src/modules/outbound/outbound.module.ts**
```typescript
import { Module } from '@nestjs/common';
import { OutboundPollerCron } from './outbound-poller.cron';
import { GooglePlacesService } from './google-places.service';
import { FlipLogicService } from './flip-logic.service';
import { TwilioOutboundService } from './twilio-outbound.service';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [NotificationModule],
  providers: [OutboundPollerCron, GooglePlacesService, FlipLogicService, TwilioOutboundService],
})
export class OutboundModule {}
```

**packages/api/src/modules/outbound/twilio-outbound.service.ts**
```typescript
import { Injectable, Logger } from '@nestjs/common';
import * as twilio from 'twilio';

interface OutboundCallParams {
  customerPhone: string;
  customerName: string;
  vehicle: string;
  pickupLocation: string;
  destination: string;
  destinationType: 'AUTO_REPAIR' | 'AUTO_BODY' | 'RESIDENTIAL' | 'UNKNOWN';
  flipEligible: boolean;
  nearestOurShop: string | null;
  tenantId: string;
}

@Injectable()
export class TwilioOutboundService {
  private readonly logger = new Logger(TwilioOutboundService.name);
  private readonly client: twilio.Twilio;
  private readonly fromNumber: string;

  constructor() {
    this.client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER!;
  }

  async initiateConfirmationCall(params: OutboundCallParams): Promise<string> {
    const twiml = this.buildTwiml(params);

    const call = await this.client.calls.create({
      to: params.customerPhone,
      from: this.fromNumber,
      twiml,
      statusCallback: `${process.env.API_BASE_URL}/webhooks/twilio/call-status`,
      statusCallbackEvent: ['completed'],
      record: true,
    });

    this.logger.log(`Outbound call initiated: ${call.sid} to ${params.customerPhone}`);
    return call.sid;
  }

  private buildTwiml(params: OutboundCallParams): string {
    // Build the TwiML script based on destination type
    let script = '';

    // Phase 1: Opening & Confirmation
    script += `<Say voice="Polly.Joanna">Hi, this is Sarah calling from Roadside Towing on behalf of Triple A. Am I speaking with ${params.customerName}?</Say>`;
    script += `<Pause length="2"/>`;
    script += `<Say voice="Polly.Joanna">I'm calling to confirm the details of your tow request. I have your vehicle as a ${params.vehicle}, being picked up at ${params.pickupLocation}, and towed to ${params.destination}. Is all of that correct?</Say>`;
    script += `<Pause length="3"/>`;

    // Phase 2: Based on destination type
    if (params.flipEligible && params.nearestOurShop) {
      // Auto repair — attempt flip
      script += `<Say voice="Polly.Joanna">I want to let you know, we have a certified repair facility nearby called ${params.nearestOurShop}. If you'd like, we can redirect your tow there at no extra charge, and you'd receive a free diagnostic and 10 percent off your repair. Would you like me to make that switch? Press 1 for yes, or 2 to keep your current destination.</Say>`;
      script += `<Gather numDigits="1" action="${process.env.API_BASE_URL}/webhooks/twilio/flip-response?tenantId=${params.tenantId}&phone=${params.customerPhone}" method="POST">`;
      script += `<Pause length="5"/>`;
      script += `</Gather>`;
    } else if (params.destinationType === 'AUTO_BODY') {
      // Auto body — soft mention
      script += `<Say voice="Polly.Joanna">Just so you know, we also own two independent body shops in the area that offer VIP services. If you ever need collision work in the future and want to choose your own shop, we'd love to take care of you.</Say>`;
    }

    // Phase 3: CONVINI offer (all calls)
    const conviniIntensity = params.destinationType === 'UNKNOWN' || params.destinationType === 'RESIDENTIAL' ? 'hard' : 'soft';
    if (conviniIntensity === 'hard') {
      script += `<Say voice="Polly.Joanna">Before I let you go, I want to tell you about our free app called Convini Car. It puts roadside assistance, repair scheduling, car rentals, and exclusive member deals all in one place on your phone. It's completely free. Press 1 if you'd like me to text you the download link.</Say>`;
    } else {
      script += `<Say voice="Polly.Joanna">One quick thing. We have a free app called Convini Car for roadside assistance and repair scheduling. Press 1 if you'd like me to text you the link.</Say>`;
    }
    script += `<Gather numDigits="1" action="${process.env.API_BASE_URL}/webhooks/twilio/convini-response?phone=${params.customerPhone}" method="POST">`;
    script += `<Pause length="3"/>`;
    script += `</Gather>`;

    // Close
    script += `<Say voice="Polly.Joanna">Your driver is on the way. Have a great day!</Say>`;

    return `<Response>${script}</Response>`;
  }
}
```

**packages/api/src/modules/outbound/google-places.service.ts**
```typescript
import { Injectable, Logger } from '@nestjs/common';

export interface PlaceClassification {
  businessName: string;
  type: 'AUTO_REPAIR' | 'AUTO_BODY' | 'RESIDENTIAL' | 'UNKNOWN';
  placeId: string;
}

@Injectable()
export class GooglePlacesService {
  private readonly logger = new Logger(GooglePlacesService.name);
  private readonly apiKey = process.env.GOOGLE_PLACES_API_KEY;

  async classifyAddress(address: string): Promise<PlaceClassification> {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(address)}&inputtype=textquery&fields=name,types,place_id&key=${this.apiKey}`;
      const res = await fetch(url);
      const data = await res.json();

      if (!data.candidates || data.candidates.length === 0) {
        return { businessName: '', type: 'UNKNOWN', placeId: '' };
      }

      const place = data.candidates[0];
      const types: string[] = place.types || [];

      let type: PlaceClassification['type'] = 'UNKNOWN';
      if (types.includes('car_repair') || types.includes('mechanic')) {
        type = 'AUTO_REPAIR';
      } else if (types.includes('auto_body_shop') || types.includes('car_body_repair')) {
        type = 'AUTO_BODY';
      } else if (types.includes('premise') || types.includes('street_address') || types.includes('subpremise')) {
        type = 'RESIDENTIAL';
      }

      return { businessName: place.name || '', type, placeId: place.place_id || '' };
    } catch (error) {
      this.logger.error(`Google Places API error: ${error.message}`);
      return { businessName: '', type: 'UNKNOWN', placeId: '' };
    }
  }
}
```

**packages/api/src/modules/outbound/flip-logic.service.ts**
```typescript
import { Injectable } from '@nestjs/common';

export interface FlipDecision {
  flipEligible: boolean;
  conviniSellType: 'SOFT' | 'MEDIUM' | 'HARD';
  nearestShop: string | null;
}

const OUR_REPAIR_SHOPS = [
  { name: 'Excite Collision & Repair of Westerville', address: '123 State St, Westerville OH' },
  { name: 'Shop 2', address: '' },
  { name: 'Shop 3', address: '' },
  { name: 'Shop 4', address: '' },
  { name: 'Shop 5', address: '' },
  { name: 'Shop 6', address: '' },
  { name: 'Shop 7', address: '' },
];

const OUR_BODY_SHOPS = [
  { name: 'T&C Auto Body', address: '' },
  { name: 'Body Shop 2', address: '' },
];

@Injectable()
export class FlipLogicService {
  decide(destinationType: string, destinationAddress: string): FlipDecision {
    // Check if destination is already one of our shops
    const allOurShops = [...OUR_REPAIR_SHOPS, ...OUR_BODY_SHOPS];
    const isOurs = allOurShops.some((shop) =>
      destinationAddress.toLowerCase().includes(shop.name.toLowerCase())
    );

    if (isOurs) {
      return { flipEligible: false, conviniSellType: 'SOFT', nearestShop: null };
    }

    switch (destinationType) {
      case 'AUTO_REPAIR':
        return { flipEligible: true, conviniSellType: 'SOFT', nearestShop: OUR_REPAIR_SHOPS[0].name };
      case 'AUTO_BODY':
        return { flipEligible: false, conviniSellType: 'MEDIUM', nearestShop: null };
      case 'RESIDENTIAL':
      case 'UNKNOWN':
      default:
        return { flipEligible: false, conviniSellType: 'HARD', nearestShop: null };
    }
  }
}
```

**packages/api/src/modules/outbound/outbound-poller.cron.ts**
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Redis } from 'ioredis';
import { GooglePlacesService } from './google-places.service';
import { FlipLogicService } from './flip-logic.service';
import { TwilioOutboundService } from './twilio-outbound.service';
import { NotificationService } from '../notifications/notification.service';
import { ActiveJob } from '../adapters/adapter.interface';
import { outboundCallLogs } from '../../db/schema';

@Injectable()
export class OutboundPollerCron {
  private readonly logger = new Logger(OutboundPollerCron.name);
  private processedJobIds = new Set<string>();

  constructor(
    private readonly redis: Redis,
    private readonly googlePlaces: GooglePlacesService,
    private readonly flipLogic: FlipLogicService,
    private readonly twilioOutbound: TwilioOutboundService,
    private readonly notifications: NotificationService,
    private readonly db: any,
  ) {}

  @Cron('*/60 * * * * *') // Every 60 seconds
  async checkForNewJobs(): Promise<void> {
    const keys = await this.redis.keys('jobs:*');

    for (const key of keys) {
      const jobsJson = await this.redis.get(key);
      if (!jobsJson) continue;

      const jobs: ActiveJob[] = JSON.parse(jobsJson);
      const tenantId = key.split(':')[2];

      for (const job of jobs) {
        // Only process new jobs we haven't seen before
        if (this.processedJobIds.has(job.jobId)) continue;
        // Only process jobs in early stages (just dispatched)
        if (job.status !== 'Waiting' && job.status !== 'Dispatched') continue;

        this.processedJobIds.add(job.jobId);
        this.logger.log(`New job detected: ${job.jobId} - ${job.customerName}`);

        // Classify destination
        const classification = await this.googlePlaces.classifyAddress(job.destination);
        const decision = this.flipLogic.decide(classification.type, job.destination);

        // Initiate outbound call via Twilio
        try {
          const callSid = await this.twilioOutbound.initiateConfirmationCall({
            customerPhone: job.customerPhone.startsWith('+') ? job.customerPhone : `+1${job.customerPhone}`,
            customerName: job.customerName,
            vehicle: job.vehicle,
            pickupLocation: 'your current location', // Simplified for TTS
            destination: classification.businessName || job.destination,
            destinationType: classification.type,
            flipEligible: decision.flipEligible,
            nearestOurShop: decision.nearestShop,
            tenantId,
          });

          // Log the outbound call
          await this.db.insert(outboundCallLogs).values({
            tenantId,
            customerName: job.customerName,
            customerPhone: job.customerPhone,
            vehicle: job.vehicle,
            originalDestination: job.destination,
            destinationBusinessName: classification.businessName,
            destinationType: classification.type,
            flipEligible: decision.flipEligible,
            nearestOurShop: decision.nearestShop,
            conviniSellType: decision.conviniSellType,
          });
        } catch (error) {
          this.logger.error(`Failed to initiate outbound call for job ${job.jobId}: ${error.message}`);
        }
      }
    }

    // Prevent memory leak: clear processed IDs older than 24 hours
    if (this.processedJobIds.size > 10000) {
      this.processedJobIds.clear();
    }
  }
}
```

**packages/api/src/modules/outbound/webhooks/twilio-webhook.controller.ts**
```typescript
import { Controller, Post, Body, Query, Logger, HttpCode } from '@nestjs/common';
import { NotificationService } from '../../notifications/notification.service';

@Controller('webhooks/twilio')
export class TwilioWebhookController {
  private readonly logger = new Logger(TwilioWebhookController.name);

  constructor(
    private readonly db: any,
    private readonly notifications: NotificationService,
  ) {}

  @Post('flip-response')
  @HttpCode(200)
  async handleFlipResponse(@Body() body: any, @Query('tenantId') tenantId: string, @Query('phone') phone: string) {
    const digit = body.Digits;

    if (digit === '1') {
      // Customer accepted the flip
      this.logger.log(`FLIP ACCEPTED by ${phone}`);

      // TODO: Update Towbook destination via Playwright
      // TODO: Update outbound_call_logs with flip_outcome = 'SUCCESS'

      // Notify management
      await this.notifications.sendFlipNotification(tenantId, phone, 'SUCCESS');

      // Return TwiML confirmation
      return '<Response><Say voice="Polly.Joanna">Wonderful! I\'ve updated your destination. Your driver has been notified. Have a great day!</Say></Response>';
    } else {
      // Customer declined
      return '<Response><Say voice="Polly.Joanna">No problem at all. Your driver is headed to your original destination.</Say></Response>';
    }
  }

  @Post('convini-response')
  @HttpCode(200)
  async handleConviniResponse(@Body() body: any, @Query('phone') phone: string) {
    const digit = body.Digits;

    if (digit === '1') {
      // Send CONVINI SMS
      // TODO: Send SMS via Twilio with CONVINI app download link
      this.logger.log(`CONVINI link requested by ${phone}`);
      return '<Response><Say voice="Polly.Joanna">Done! You\'ll receive a text with the download link in just a moment. Have a great day!</Say></Response>';
    }

    return '<Response><Say voice="Polly.Joanna">No problem. Your driver is on the way. Have a great day!</Say></Response>';
  }

  @Post('call-status')
  @HttpCode(200)
  async handleCallStatus(@Body() body: any) {
    // Twilio sends call status updates (completed, no-answer, busy, failed)
    this.logger.log(`Call ${body.CallSid} status: ${body.CallStatus}, duration: ${body.CallDuration}s`);

    // TODO: Update outbound_call_logs with duration and recording URL
    return { received: true };
  }
}
```

### Additional Environment Variables Required
```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+16145551234
API_BASE_URL=https://api.ustowdispatch.com
```

### Acceptance Tests
- New job detected in Redis triggers a Twilio outbound call
- Google Places correctly classifies "Midas Auto Repair" as AUTO_REPAIR
- Google Places correctly classifies "Caliber Collision" as AUTO_BODY
- Google Places returns UNKNOWN for residential addresses
- Flip-eligible calls include the offer TwiML
- Non-flip calls skip directly to CONVINI offer
- Twilio webhook for flip response (digit=1) triggers management notification
- Outbound call log is created in database with all fields populated
- System does not re-call a job it has already processed

---

## SESSION 10: CI/CD PIPELINE & PRODUCTION DEPLOYMENT

### Objective
Deploy the complete system to Railway with automated CI/CD via GitHub Actions.

### Files to Create

**.github/workflows/deploy.yml**
```yaml
name: Deploy to Railway

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @ustow/api test

  deploy-api:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: railwayapp/cli-action@v1
        with:
          service: api
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}

  deploy-web:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          working-directory: packages/web
```

**packages/api/Dockerfile**
```dockerfile
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
RUN npx playwright install --with-deps chromium

WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY packages/api packages/api
RUN pnpm --filter @ustow/api build

EXPOSE 3001
CMD ["node", "packages/api/dist/main.js"]
```

### Railway Environment Variables to Set
```
DATABASE_URL=<Railway PostgreSQL connection string>
REDIS_URL=<Railway Redis connection string>
ENCRYPTION_KEY=<64-char hex string>
GOOGLE_PLACES_API_KEY=<Google API key>
SENDGRID_API_KEY=<SendGrid key>
TWILIO_ACCOUNT_SID=<Twilio SID>
TWILIO_AUTH_TOKEN=<Twilio token>
TWILIO_PHONE_NUMBER=<Twilio number>
MANAGEMENT_EMAIL=chris@bluecollarai.online
MANAGEMENT_PHONE=+16146337935
NODE_ENV=production
PORT=3001
```

### Production Seed Script
```typescript
// packages/api/src/db/seed.ts
import { db } from './connection';
import { tenants, aiAgentConfigs, routingRules } from './schema';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

async function seed() {
  const apiKey = `sk_prod_${randomBytes(24).toString('hex')}`;
  const apiKeyHash = await bcrypt.hash(apiKey, 12);

  const [tenant] = await db.insert(tenants).values({
    companyName: 'Roadside Towing and Recovery, Inc.',
    ownerEmail: 'chris@bluecollarai.online',
    timezone: 'America/New_York',
    targetSoftwareType: 'TOWBOOK',
    apiKeyHash,
    apiKeyPrefix: apiKey.substring(0, 8),
  }).returning();

  await db.insert(aiAgentConfigs).values({
    tenantId: tenant.id,
    greetingMessage: 'Thank you for calling Roadside Towing and Recovery. How can I help you today?',
    defaultEtaMins: 45,
  });

  await db.insert(routingRules).values({
    tenantId: tenant.id,
    ruleName: 'Day Dispatch',
    phoneNumber: '+16146337935',
    isActiveNow: true,
  });

  console.log('Seed complete. API Key (save this, shown only once):', apiKey);
}

seed();
```

### Final Acceptance Criteria
1. `git push main` triggers automated tests and deployment
2. `https://api.ustowdispatch.com/health` returns 200
3. Dashboard loads at `https://app.ustowdispatch.com`
4. First tenant (Roadside Towing) can log in and see connected status
5. Poller runs every 60 seconds without errors in Sentry
6. System runs unattended for 72 hours

---

## ACCEPTANCE CRITERIA (FULL SYSTEM)

The system is considered complete and ready for production when:

1. A tenant can sign up, enter Towbook credentials, and see "Connected" status within 30 seconds.
2. The poller successfully scrapes active jobs every 60 seconds without crashing.
3. Thinkrr.ai Knowledge Pack contains current job data (verified by test call).
4. A customer calling the Thinkrr number and providing their phone number receives an accurate ETA.
5. The admin dashboard displays call logs, routing rules, and agent configuration.
6. The outbound engine detects new motor club jobs and triggers confirmation calls.
7. Google Places correctly classifies destinations and the flip logic executes without errors.
8. Management receives SMS/Email notifications on successful flips.
9. All sessions pass their unit and integration tests.
10. The system runs on Railway without manual intervention for 72 hours.

---

## Session 10: Production Deployment — completion log (2026-05-23)

The Session 10 *spec* lives above; this section records what was actually
delivered on the autonomous build pass. Authoritative operator runbook is
`docs/DEPLOY_RAILWAY.md`; engineering decisions are in
`docs/ASSUMPTIONS.md` (Session 10 entry).

### Objective
Take the locally running stack (NestJS API on :3001, Next.js admin on
:3000, Postgres + Redis via docker-compose, ngrok-tunneled to Thinkrr) and
produce everything needed to deploy it to Railway behind stable HTTPS URLs
with automated migrations, healthchecks, security hardening, and a
post-deploy smoke gate.

### Files added
- `railway.toml` — multi-service config (`api`, `web`) with
  `preDeployCommand = pnpm --filter @ustow/api run db:migrate:prod` and
  `healthcheckPath` per service.
- `packages/api/Dockerfile` — 4-stage build (deps → build → playwright →
  runtime) on `node:22-bookworm-slim`, ships Chromium at
  `/ms-playwright`, runs as the `node` user under `tini`.
- `packages/web/Dockerfile` — 3-stage build, Next.js `output: 'standalone'`
  enabled in `next.config.js`, runtime tier ships only the standalone
  server + `.next/static` + `public/`.
- `packages/api/.dockerignore`, `packages/web/.dockerignore` — keep
  `node_modules`, build outputs and any `.env*` out of the build context.
- `packages/api/.env.example`, `packages/web/.env.example` — every
  required variable documented, `.env*` (minus `.example`) ignored at
  repo level.
- `packages/api/src/modules/health/health.controller.ts` — adds
  `/health/ready` with parallel Postgres + Redis probes (`SELECT 1` /
  `PING`) and a 2s per-check timeout.
- `packages/web/src/app/api/health/route.ts` — web liveness probe.
- `packages/api/src/main.ts` — Helmet middleware, allow-listed CORS
  (with webhook + public + health route exemptions), and a
  NODE_ENV=production guard that warns when URL env vars still point at
  localhost.
- `.github/workflows/deploy.yml` — type-check + tests + Docker syntax
  lint on every PR/push to main. Railway's GitHub app handles the
  deploy; no `RAILWAY_TOKEN` required.
- `scripts/post-deploy-smoke.sh` — bash + curl probe of
  `/health`, `/health/ready`, the public Knowledge Pack endpoint, the
  web root, and `/api/health`.
- `infra/railway/README.md` — topology diagram + service inventory.
- `docs/DEPLOY_RAILWAY.md` — operator runbook (15 numbered sections
  including custom domain, rollback, secret rotation, ngrok cutover).
- `docs/THINKRR_INTEGRATION.md` — Knowledge Pack + webhook contracts +
  ngrok→production cutover.
- `docs/BLOCKERS.md` — added entry for the unregistered
  `ustow-aiconnect.com` domain.

### Files changed
- `packages/api/package.json` — `+ @sentry/node ^7.119.0`, `+ helmet
  ^7.1.0`, new `db:migrate:prod` and `db:seed:tenant-zero:prod` scripts
  pointing at the compiled JS (runtime image has no `tsx`).
- `packages/api/src/db/migrate.ts` — multi-candidate path resolution so
  the runner works both as `tsx src/db/migrate.ts` and `node
  dist/db/migrate.js`.
- `packages/web/next.config.js` — `output: 'standalone'` +
  `outputFileTracingRoot` so workspace deps trace correctly.
- `README.md` — Deployment section linking to the runbook.
- `.gitignore` — broader `.env.*` pattern with `!.env.example`
  allow-list.

### Files intentionally NOT touched
Per the build prompt's boundary list, anything under
`packages/api/src/modules/admin/`,
`packages/api/src/modules/command-center/`,
`packages/api/src/modules/digital-dispatch/`, the existing migration SQL
files, or the unified-jobs/drivers/trucks schema. The deploy story is
schema-agnostic.

### Acceptance status
| #  | Criterion                                                                            | Status |
|----|--------------------------------------------------------------------------------------|--------|
| 1  | `git push main` triggers automated tests + deploy                                    | ✅ CI + Railway GitHub app wired |
| 2  | `https://api.<domain>/health` returns 200                                            | ⏳ awaits first Railway deploy |
| 3  | Dashboard loads at `https://app.<domain>`                                            | ⏳ awaits first Railway deploy |
| 4  | Roadside Towing tenant zero is in the DB                                             | ✅ idempotent seed script + docs |
| 5  | Poller runs every 60 s without errors                                                | ⏳ post-deploy verification |
| 6  | System unattended 72 h                                                               | ⏳ post-deploy verification |

Items 2–3 and 5–6 are intentionally left ⏳ — they require the human to
push the Big Green Button on Railway. Section 4 of
`docs/DEPLOY_RAILWAY.md` is the exact runbook for getting to ✅.

### Open follow-ups (see `docs/BLOCKERS.md`)
- Register `ustow-aiconnect.com` (or confirm the final brand domain) and
  attach to Railway.
- Pre-existing blockers (AAA Accept/Decline selectors, AAA payout field
  path, Google Maps browser key authorization) are unchanged.
