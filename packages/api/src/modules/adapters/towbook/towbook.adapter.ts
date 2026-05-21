import { Inject, Injectable, Logger } from '@nestjs/common';
import { chromium } from 'playwright';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { SessionExpiredException } from '../../../common/exceptions/session-expired.exception';
import {
  ActiveJob,
  AdapterConnectionTestResult,
  DecryptedCredentials,
  TowingSoftwareAdapter,
} from '../adapter.interface';

/**
 * Decision: Headless Chromium with sandboxing disabled — required on most
 * container images (Railway, Docker). 1-hour session TTL aligns with the
 * cron refresh cadence (every 15 min, refresh if expiring within 10 min).
 * See ASSUMPTIONS.md.
 */
const CHROMIUM_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];
const SESSION_TTL_SECONDS = 3600;
const JOBS_CACHE_TTL_SECONDS = 300;

const ROW_SELECTORS = '.call-row, .dispatch-row, tr[data-callid]';

@Injectable()
export class TowbookAdapter implements TowingSoftwareAdapter {
  private readonly logger = new Logger(TowbookAdapter.name);
  private readonly LOGIN_URL = 'https://app.towbook.com/Security/Login?ReturnUrl=%2F';
  private readonly DISPATCH_URL = 'https://app.towbook.com/DS4/';

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async login(tenantId: string, creds: DecryptedCredentials): Promise<void> {
    const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(this.LOGIN_URL, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.fill('#Username', creds.username);
      await page.fill('#Password', creds.password);
      await page.click('button:has-text("Log in")');

      await page.waitForURL('https://app.towbook.com/**', { timeout: 15_000 });
      // Wait for an authenticated-state element on dashboard.
      await page.waitForSelector('a[href="/DS4/"]', { timeout: 5000 });

      const storageState = await context.storageState();
      await this.redis.set(
        `session:towbook:${tenantId}`,
        JSON.stringify(storageState),
        'EX',
        SESSION_TTL_SECONDS,
      );

      this.logger.log(`Login successful for tenant ${tenantId}`);
    } catch (error) {
      this.logger.error(
        `Login failed for tenant ${tenantId}: ${(error as Error).message}`,
      );
      throw error;
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  async scrapeAllActiveJobs(tenantId: string): Promise<ActiveJob[]> {
    const stateJson = await this.redis.get(`session:towbook:${tenantId}`);
    if (!stateJson) {
      throw new SessionExpiredException(`No session context for tenant ${tenantId}`);
    }

    const storageState = JSON.parse(stateJson);
    const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    try {
      const context = await browser.newContext({ storageState });
      const page = await context.newPage();

      await page.goto(this.DISPATCH_URL, { waitUntil: 'networkidle', timeout: 30_000 });

      if (page.url().includes('/Security/Login')) {
        await this.redis.del(`session:towbook:${tenantId}`);
        throw new SessionExpiredException(`Session bounced to login for tenant ${tenantId}`);
      }

      // Active tab — best-effort; tab id may vary in different Towbook layouts.
      await page.click('#atActive').catch(() => undefined);
      await page.waitForTimeout(2000);

      const jobs: ActiveJob[] = await this.extractRows(page);

      for (const tab of ['#atWaiting', '#atCurrent']) {
        try {
          await page.click(tab);
          await page.waitForTimeout(1500);
          const moreJobs = await this.extractRows(page);
          jobs.push(...moreJobs);
        } catch {
          /* tab may not exist or be empty */
        }
      }

      const deduped = dedupeJobs(jobs);

      await this.redis.set(
        `jobs:towbook:${tenantId}`,
        JSON.stringify(deduped),
        'EX',
        JOBS_CACHE_TTL_SECONDS,
      );

      this.logger.log(`Scraped ${deduped.length} active jobs for tenant ${tenantId}`);
      return deduped;
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  async testConnection(creds: DecryptedCredentials): Promise<AdapterConnectionTestResult> {
    const start = Date.now();
    const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(this.LOGIN_URL, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.fill('#Username', creds.username);
      await page.fill('#Password', creds.password);
      await page.click('button:has-text("Log in")');
      await page.waitForURL('https://app.towbook.com/**', { timeout: 15_000 });
      return { success: true, message: 'Connected successfully', latencyMs: Date.now() - start };
    } catch (error) {
      return {
        success: false,
        message: `Login failed: ${(error as Error).message}`,
        latencyMs: Date.now() - start,
      };
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  private async extractRows(page: import('playwright').Page): Promise<ActiveJob[]> {
    return page.evaluate((selectors: string) => {
      const rows = document.querySelectorAll(selectors);
      const out: Array<Record<string, string>> = [];
      const getText = (root: Element, sel: string) => {
        const el = root.querySelector(sel);
        return el ? (el.textContent ?? '').trim() : '';
      };
      rows.forEach((row) => {
        out.push({
          jobId: row.getAttribute('data-callid') || '',
          customerName: getText(row, '.customer-name, .cust-name, td:nth-child(2)'),
          customerPhone: getText(row, '.customer-phone, .cust-phone, td:nth-child(3)').replace(/\D/g, ''),
          vehicle: getText(row, '.vehicle-info, .veh-info, td:nth-child(4)'),
          status: getText(row, '.call-status, .status, td:nth-child(5)'),
          driverName: getText(row, '.driver-name, .drv-name, td:nth-child(6)'),
          eta: getText(row, '.eta-info, .eta, td:nth-child(7)') || 'Unknown',
          destination: getText(row, '.destination, .dest, td:nth-child(8)'),
          lastUpdated: new Date().toISOString(),
        });
      });
      return out as unknown as ActiveJob[];
    }, ROW_SELECTORS);
  }
}

function dedupeJobs(jobs: ActiveJob[]): ActiveJob[] {
  const seen = new Set<string>();
  const out: ActiveJob[] = [];
  for (const j of jobs) {
    const key = j.jobId || `${j.customerPhone}|${j.customerName}|${j.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(j);
  }
  return out;
}
