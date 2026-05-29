import { Inject, Injectable, Logger } from '@nestjs/common';
import { chromium } from 'playwright';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { SessionExpiredException } from '../../../common/exceptions/session-expired.exception';
import {
  ActiveJob,
  AdapterActionResult,
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

// Verified 2026-05-22 against a live Towbook DS4 dashboard with 3 active jobs.
// Calls render as <li class="entryRow" data-id="<callId>"> children of
// <ul id="dcslist">. Field values are <div class="text"> elements identified
// by a numeric `columnid` attribute (legacy column model).
const ROW_SELECTOR = 'li.entryRow[data-id]';
const CANDIDATE_SELECTORS = [
  ROW_SELECTOR,
  '#dcslist li.entryRow',
  'li.entryRow',
  '[data-id][data-call-number]',
  // legacy / spec guesses, kept for visibility:
  '.call-row',
  '.dispatch-row',
  'tr[data-callid]',
];
const DEBUG_DUMP_ENABLED = process.env.TOWBOOK_DEBUG_DUMP === '1';

@Injectable()
export class TowbookAdapter implements TowingSoftwareAdapter {
  private readonly logger = new Logger(TowbookAdapter.name);
  private readonly LOGIN_URL = 'https://app.towbook.com/Security/Login?ReturnUrl=%2F';
  private readonly DISPATCH_URL = 'https://app.towbook.com/DS4/';

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async login(tenantId: string, creds: DecryptedCredentials): Promise<void> {
    let browser: import('playwright').Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
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
      if (browser) await browser.close().catch(() => undefined);
    }
  }

  async scrapeAllActiveJobs(tenantId: string): Promise<ActiveJob[]> {
    const stateJson = await this.redis.get(`session:towbook:${tenantId}`);
    if (!stateJson) {
      throw new SessionExpiredException(`No session context for tenant ${tenantId}`);
    }

    const storageState = JSON.parse(stateJson);
    let browser: import('playwright').Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
      const context = await browser.newContext({ storageState });
      const page = await context.newPage();

      await page.goto(this.DISPATCH_URL, { waitUntil: 'networkidle', timeout: 30_000 });

      if (page.url().includes('/Security/Login')) {
        await this.redis.del(`session:towbook:${tenantId}`);
        throw new SessionExpiredException(`Session bounced to login for tenant ${tenantId}`);
      }

      // Wait for the calls list to populate. DS4 renders all active calls in
      // <ul id="dcslist"> on the landing dispatch page — no tab click needed.
      await page
        .waitForSelector(ROW_SELECTOR, { timeout: 10_000 })
        .catch(() => undefined);

      await this.dumpDiagnostics(page, tenantId, 'dispatch').catch((e) => {
        this.logger.warn(`Diagnostic dump failed: ${(e as Error).message}`);
      });

      const jobs: ActiveJob[] = await this.extractRows(page);
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
      if (browser) await browser.close().catch(() => undefined);
    }
  }

  async testConnection(creds: DecryptedCredentials): Promise<AdapterConnectionTestResult> {
    const start = Date.now();
    let browser: import('playwright').Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(this.LOGIN_URL, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.fill('#Username', creds.username);
      await page.fill('#Password', creds.password);
      await page.click('button:has-text("Log in")');

      // Try to wait for the dashboard URL, but catch it early if we stay on the login screen
      try {
        await page.waitForURL('https://app.towbook.com/**', { timeout: 8000 });
      } catch (e) {
        // Timeout exceeded, we are likely still on the login page due to bad credentials
      }

      // Check if we are still stuck on the login page
      if (page.url().includes('/Security/Login')) {
        const errorText = await page.evaluate(() => {
          const doc: any = (globalThis as any).document;
          // Standard selectors for ASP.NET / bootstrap login validation errors
          const el = doc.querySelector('.validation-summary-errors, .alert-danger, .text-danger, #val-summary');
          return el ? el.textContent?.replace(/\s+/g, ' ').trim() : 'Invalid username or password';
        });
        return { 
          success: false, 
          message: errorText || 'Invalid username or password', 
          latencyMs: Date.now() - start 
        };
      }

      return { success: true, message: 'Connected successfully', latencyMs: Date.now() - start };
    } catch (error) {
      return {
        success: false,
        message: `Login failed: ${(error as Error).message}`,
        latencyMs: Date.now() - start,
      };
    } finally {
      if (browser) await browser.close().catch(() => undefined);
    }
  }

  // Towbook is dispatch-out (we push calls to it), not motor-club intake —
  // there is no Accept/Decline surface in the Towbook UI (docs/TOWBOOK_DOM_MAP
  // documents only login/search/parse). These methods exist for adapter
  // interface parity; they return a structured not-applicable result rather
  // than fabricating a click that has no target. See docs/BLOCKERS.md.
  async acceptJob(tenantId: string, sourceJobId: string): Promise<AdapterActionResult> {
    this.logger.log(
      `[towbook] acceptJob not-applicable (tenant=${tenantId}, job=${sourceJobId}) — Towbook is dispatch-out`,
    );
    return { success: false, error: 'not-applicable: Towbook is dispatch-out (no accept surface)' };
  }

  async declineJob(
    tenantId: string,
    sourceJobId: string,
    reason: string,
  ): Promise<AdapterActionResult> {
    this.logger.log(
      `[towbook] declineJob not-applicable (tenant=${tenantId}, job=${sourceJobId}, reason="${reason}")`,
    );
    return { success: false, error: 'not-applicable: Towbook is dispatch-out (no decline surface)' };
  }

  private async dumpDiagnostics(
    page: import('playwright').Page,
    tenantId: string,
    tabLabel: string,
  ): Promise<void> {
    const url = page.url();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const counts = await page.evaluate((selectors: string[]) => {
      const doc: any = (globalThis as any).document;
      const result: Array<{ selector: string; count: number }> = [];
      for (const sel of selectors) {
        let count = 0;
        try {
          count = doc.querySelectorAll(sel).length;
        } catch {
          count = -1;
        }
        result.push({ selector: sel, count });
      }
      return result;
    }, CANDIDATE_SELECTORS);
    /* eslint-enable @typescript-eslint/no-explicit-any */

    this.logger.log(
      `[towbook-debug] tenant=${tenantId} tab=${tabLabel} url=${url}`,
    );
    for (const c of counts) {
      this.logger.log(`[towbook-debug]   ${c.selector} -> ${c.count}`);
    }

    if (DEBUG_DUMP_ENABLED) {
      try {
        const html = await page.content();
        const dumpPath = path.join(os.tmpdir(), `towbook-debug-${tenantId}-${tabLabel}.html`);
        await fs.writeFile(dumpPath, html, 'utf8');
        this.logger.log(`[towbook-debug] wrote ${dumpPath} (${html.length} bytes)`);
      } catch (err) {
        this.logger.warn(`[towbook-debug] html dump failed: ${(err as Error).message}`);
      }
    }
  }

  private async extractRows(page: import('playwright').Page): Promise<ActiveJob[]> {
    // Callback runs inside the Chromium page where DOM globals exist; the
    // Node tsconfig doesn't include lib.dom, so we type the closure args as
    // `any` to avoid pulling DOM types into the API build.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    return page.evaluate((rowSelector: string) => {
      const doc: any = (globalThis as any).document;
      const rows: any[] = Array.from(doc.querySelectorAll(rowSelector));
      const out: Array<Record<string, string>> = [];
      // Towbook column IDs (observed on live DS4 dashboard):
      //   2  vehicle      4  ETA           5  driver name
      //   9  account     14  status text  22  contact "Name (xxx) xxx-xxxx"
      const colText = (row: any, columnId: string): string => {
        const el = row.querySelector(`[columnid="${columnId}"]`);
        return el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
      };
      rows.forEach((row: any) => {
        const contact = colText(row, '22');
        const phoneMatch = contact.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
        const phoneDigits = phoneMatch ? phoneMatch[0].replace(/\D/g, '') : '';
        const customerName = phoneMatch
          ? contact.slice(0, phoneMatch.index).trim().replace(/[,\s]+$/, '')
          : contact;
        out.push({
          jobId: row.getAttribute('data-id') || '',
          customerName,
          customerPhone: phoneDigits,
          vehicle: colText(row, '2'),
          status: colText(row, '14'),
          driverName: colText(row, '5'),
          eta: colText(row, '4') || 'Unknown',
          destination: '',
          lastUpdated: new Date().toISOString(),
        });
      });
      return out as unknown as ActiveJob[];
    }, ROW_SELECTOR);
    /* eslint-enable @typescript-eslint/no-explicit-any */
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
