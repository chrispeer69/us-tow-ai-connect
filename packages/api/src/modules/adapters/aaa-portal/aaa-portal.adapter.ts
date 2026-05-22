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

const CHROMIUM_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];
const SESSION_TTL_SECONDS = 3600;
const JOBS_CACHE_TTL_SECONDS = 300;

@Injectable()
export class AaaPortalAdapter implements TowingSoftwareAdapter {
  private readonly logger = new Logger(AaaPortalAdapter.name);
  private readonly LOGIN_URL =
    'https://aaacluballiance.my.site.com/ACACONTRACTORCOMMUNITY/login';
  private readonly WORK_ORDERS_URL =
    'https://aaacluballiance.my.site.com/ACACONTRACTORCOMMUNITY/s/workorder/WorkOrder/Default';

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async login(tenantId: string, creds: DecryptedCredentials): Promise<void> {
    const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(this.LOGIN_URL, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.fill('#username', creds.username);
      await page.fill('#password', creds.password);
      await page.click('#Login');

      await page.waitForURL('**/ACACONTRACTORCOMMUNITY/s/**', { timeout: 30_000 });

      const storageState = await context.storageState();
      await this.redis.set(
        `session:aaa_portal:${tenantId}`,
        JSON.stringify(storageState),
        'EX',
        SESSION_TTL_SECONDS,
      );

      this.logger.log(`AAA Portal login successful for tenant ${tenantId}`);
    } catch (error) {
      this.logger.error(
        `AAA Portal login failed for tenant ${tenantId}: ${(error as Error).message}`,
      );
      throw error;
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  async scrapeAllActiveJobs(tenantId: string): Promise<ActiveJob[]> {
    const stateJson = await this.redis.get(`session:aaa_portal:${tenantId}`);
    if (!stateJson) {
      throw new SessionExpiredException(`No session context for tenant ${tenantId}`);
    }

    const storageState = JSON.parse(stateJson);
    const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });

    try {
      const context = await browser.newContext({ storageState });
      const page = await context.newPage();

      await page.goto(this.WORK_ORDERS_URL, { waitUntil: 'networkidle', timeout: 30_000 });

      if (page.url().includes('/login')) {
        await this.redis.del(`session:aaa_portal:${tenantId}`);
        throw new SessionExpiredException(`Session bounced to login for tenant ${tenantId}`);
      }

      await page.waitForSelector('table[role="grid"] tbody', { timeout: 15_000 });

      const jobs: ActiveJob[] = await this.extractRows(page);

      await this.redis.set(
        `jobs:aaa_portal:${tenantId}`,
        JSON.stringify(jobs),
        'EX',
        JOBS_CACHE_TTL_SECONDS,
      );

      this.logger.log(
        `AAA Portal: Scraped ${jobs.length} In Progress jobs for tenant ${tenantId}`,
      );
      return jobs;
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
      await page.fill('#username', creds.username);
      await page.fill('#password', creds.password);
      await page.click('#Login');
      await page.waitForURL('**/ACACONTRACTORCOMMUNITY/s/**', { timeout: 30_000 });

      return {
        success: true,
        message: 'AAA Portal connected successfully',
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        message: `AAA Portal login failed: ${(error as Error).message}`,
        latencyMs: Date.now() - start,
      };
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  private async extractRows(page: import('playwright').Page): Promise<ActiveJob[]> {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    return page.evaluate(() => {
      const doc: any = (globalThis as any).document;
      const rows: any[] = Array.from(doc.querySelectorAll('table[role="grid"] tbody tr'));
      const out: Array<Record<string, string>> = [];
      rows.forEach((row: any) => {
        const cells: any[] = Array.from(row.querySelectorAll('td'));
        if (cells.length < 8) return;

        const status = (cells[3]?.textContent ?? '').trim();
        if (status !== 'In Progress') return;

        const phone = (cells[7]?.textContent ?? '').trim().replace(/\D/g, '');
        if (!phone) return;

        out.push({
          jobId: (cells[0]?.textContent ?? '').trim(),
          customerName: (cells[5]?.textContent ?? '').trim(),
          customerPhone: phone,
          vehicle: '',
          status,
          driverName: '',
          eta: 'Unknown',
          destination: '',
          lastUpdated: new Date().toISOString(),
        });
      });
      return out as unknown as ActiveJob[];
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }
}
