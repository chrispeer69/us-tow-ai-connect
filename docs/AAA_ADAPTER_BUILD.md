# AAA Club Alliance Portal Adapter — Build Prompt

## Context
This project uses a pnpm monorepo. The shared package (`@ustow/shared`) must be built before API or Web packages. Prebuild hooks handle this automatically. Follow the existing `TowbookAdapter` pattern exactly.

## Objective
Build a Playwright adapter that logs into the AAA Club Alliance contractor portal (Salesforce Community), navigates to Work Orders, and scrapes job data for outbound confirmation calls.

## Target Platform
- URL: `https://aaacluballiance.my.site.com/ACACONTRACTORCOMMUNITY/login`
- Platform: Salesforce Experience Cloud (Community)
- Authentication: Username (email) + Password form
- Data Location: Calls > Work Orders list view

## Verified DOM Selectors (Mapped May 2026)

### Login Flow
| Step | Action | Selector |
|------|--------|----------|
| 1 | Navigate | `https://aaacluballiance.my.site.com/ACACONTRACTORCOMMUNITY/login` |
| 2 | Fill username | `#username` (type: email) |
| 3 | Fill password | `#password` (type: password) |
| 4 | Click submit | `#Login` (type: submit) |
| 5 | Wait for redirect | URL contains `/ACACONTRACTORCOMMUNITY/s/` |

### Navigation to Work Orders
| Step | Action | Selector / URL |
|------|--------|----------------|
| 1 | Navigate directly | `https://aaacluballiance.my.site.com/ACACONTRACTORCOMMUNITY/s/workorder/WorkOrder/Default` |
| 2 | Wait for table | Wait for `table[role="grid"]` or `tbody` to be visible |

### Work Order Table Structure
The table contains these columns (in order):
1. Work Order Number
2. Call ID
3. Call Date
4. Status (In Progress, Cleared, etc.)
5. Service Territory (e.g., "OH744-AUTO LYFT USA INC.")
6. Contact (customer name)
7. Member Number
8. Phone Number

### Key Notes
- This is a Salesforce Lightning Web Component (LWC) page — DOM loads asynchronously
- Must wait for `tbody` rows to appear after navigation (use `waitForSelector` with timeout)
- The list view defaults to "Recently Viewed" — filter for "In Progress" status only
- Session cookies persist (no auto-logout observed)
- No CAPTCHA or MFA

## File to Create

**packages/api/src/modules/adapters/aaa-portal/aaa-portal.adapter.ts**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { chromium } from 'playwright';
import { Redis } from 'ioredis';
import { TowingSoftwareAdapter, DecryptedCredentials, ActiveJob, AdapterConnectionTestResult } from '../adapter.interface';
import { SessionExpiredException } from '../../../common/exceptions/session-expired.exception';

@Injectable()
export class AaaPortalAdapter implements TowingSoftwareAdapter {
  private readonly logger = new Logger(AaaPortalAdapter.name);
  private readonly LOGIN_URL = 'https://aaacluballiance.my.site.com/ACACONTRACTORCOMMUNITY/login';
  private readonly WORK_ORDERS_URL = 'https://aaacluballiance.my.site.com/ACACONTRACTORCOMMUNITY/s/workorder/WorkOrder/Default';
  private readonly SESSION_TTL = 3600;

  constructor(private readonly redis: Redis) {}

  async login(tenantId: string, creds: DecryptedCredentials): Promise<void> {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(this.LOGIN_URL, { waitUntil: 'networkidle' });

      // Fill login form
      await page.fill('#username', creds.username);
      await page.fill('#password', creds.password);
      await page.click('#Login');

      // Wait for Salesforce redirect chain to complete
      await page.waitForURL('**/ACACONTRACTORCOMMUNITY/s/**', { timeout: 30000 });

      // Serialize and save context
      const storageState = await context.storageState();
      await this.redis.set(
        `session:aaa_portal:${tenantId}`,
        JSON.stringify(storageState),
        'EX',
        this.SESSION_TTL
      );

      this.logger.log(`AAA Portal login successful for tenant ${tenantId}`);
    } catch (error) {
      this.logger.error(`AAA Portal login failed for tenant ${tenantId}: ${error.message}`);
      throw error;
    } finally {
      await browser.close();
    }
  }

  async scrapeAllActiveJobs(tenantId: string): Promise<ActiveJob[]> {
    const stateJson = await this.redis.get(`session:aaa_portal:${tenantId}`);
    if (!stateJson) {
      throw new SessionExpiredException(tenantId);
    }

    const storageState = JSON.parse(stateJson);
    const browser = await chromium.launch({ headless: true });

    try {
      const context = await browser.newContext({ storageState });
      const page = await context.newPage();

      await page.goto(this.WORK_ORDERS_URL, { waitUntil: 'networkidle' });

      // Check if redirected to login (session expired)
      if (page.url().includes('/login')) {
        throw new SessionExpiredException(tenantId);
      }

      // Wait for the Salesforce Lightning table to render
      await page.waitForSelector('table[role="grid"] tbody', { timeout: 15000 });

      // Extract work order data from the table
      const jobs: ActiveJob[] = await page.evaluate(() => {
        const rows = document.querySelectorAll('table[role="grid"] tbody tr');
        const results: any[] = [];

        rows.forEach((row) => {
          const cells = row.querySelectorAll('td');
          if (cells.length < 8) return;

          const status = cells[3]?.textContent?.trim() || '';

          // Only capture "In Progress" jobs for outbound calls
          if (status !== 'In Progress') return;

          const phone = cells[7]?.textContent?.trim().replace(/\D/g, '') || '';
          if (!phone) return;

          results.push({
            jobId: cells[0]?.textContent?.trim() || '',
            customerName: cells[5]?.textContent?.trim() || '',
            customerPhone: phone,
            vehicle: '', // AAA portal doesn't show vehicle in list view
            status: status,
            driverName: '', // Not available in list view
            eta: 'Unknown',
            destination: '', // Not available in list view
            lastUpdated: new Date().toISOString(),
          });
        });

        return results;
      });

      // Cache results
      await this.redis.set(
        `jobs:aaa_portal:${tenantId}`,
        JSON.stringify(jobs),
        'EX',
        300
      );

      this.logger.log(`AAA Portal: Scraped ${jobs.length} In Progress jobs for tenant ${tenantId}`);
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
      await page.fill('#username', creds.username);
      await page.fill('#password', creds.password);
      await page.click('#Login');

      await page.waitForURL('**/ACACONTRACTORCOMMUNITY/s/**', { timeout: 30000 });

      const latency = Date.now() - start;
      return { success: true, message: 'AAA Portal connected successfully', latencyMs: latency };
    } catch (error) {
      const latency = Date.now() - start;
      return { success: false, message: `AAA Portal login failed: ${error.message}`, latencyMs: latency };
    } finally {
      await browser.close();
    }
  }
}
```

## Additional Files to Create

**packages/api/src/modules/adapters/aaa-portal/aaa-portal.module.ts**
```typescript
import { Module } from '@nestjs/common';
import { AaaPortalAdapter } from './aaa-portal.adapter';

@Module({
  providers: [AaaPortalAdapter],
  exports: [AaaPortalAdapter],
})
export class AaaPortalModule {}
```

## Update Required

**packages/api/src/modules/adapters/adapter.factory.ts** — Add `AAA_PORTAL` case:
```typescript
case 'AAA_PORTAL':
  return this.aaaPortalAdapter;
```

**packages/api/src/modules/adapters/adapter.interface.ts** — Add to SoftwareType enum:
```typescript
export enum SoftwareType {
  TOWBOOK = 'TOWBOOK',
  AAA_PORTAL = 'AAA_PORTAL',
  TOWLOGS = 'TOWLOGS',
  OMADI = 'OMADI',
  NATIVE = 'NATIVE',
}
```

## Acceptance Tests
- Login with valid credentials saves session to Redis key `session:aaa_portal:{tenantId}`
- `scrapeAllActiveJobs` returns only "In Progress" work orders (not "Cleared")
- Each returned job has `customerPhone` normalized to digits only
- `testConnection` completes in under 30 seconds
- Expired session throws `SessionExpiredException`
- Redis cache key `jobs:aaa_portal:{tenantId}` has 300s TTL

## Workspace Build Note
This project uses prebuild hooks. When adding new exports to `@ustow/shared`, ensure `packages/shared` builds first. The `prebuild` script in `packages/api/package.json` handles this: `"prebuild": "pnpm --filter @ustow/shared build"`
