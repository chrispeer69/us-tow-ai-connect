import { Inject, Injectable, Logger } from '@nestjs/common';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import * as os from 'node:os';
import * as path from 'node:path';
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

const CHROMIUM_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];
const SESSION_TTL_SECONDS = 3600;
const JOBS_CACHE_TTL_SECONDS = 300;

const NAV_TIMEOUT_MS = 60_000;
const ACTION_BUTTON_TIMEOUT_MS = 15_000;

// Best-effort row selectors — Dispatch Anywhere DOM has not been verified
// against a live account (no credentials at adapter-build time, see
// docs/ADAPTER_SELECTORS.md and docs/sessions/S53_BLOCKERS.md). First selector
// that resolves > 0 rows wins.
const ROW_SELECTOR_CANDIDATES = [
  '[data-job-id]',
  '[data-call-id]',
  '[data-dispatch-id]',
  'table tbody tr[data-id]',
  'tr.dispatch-row',
  '.dispatch-row',
  'tr.job-row',
  '.job-row',
  '.job-card',
  '[role="row"]',
];

const ACCEPT_BUTTON_NAMES = ['Accept', 'Accept Job', 'Accept Dispatch', 'Accept Call'];
const DECLINE_BUTTON_NAMES = ['Decline', 'Decline Job', 'Decline Dispatch', 'Reject'];
const CONFIRM_BUTTON_NAMES = ['Decline', 'Accept', 'Submit', 'Confirm', 'Save', 'OK', 'Yes'];

@Injectable()
export class DispatchAnywhereAdapter implements TowingSoftwareAdapter {
  private readonly logger = new Logger(DispatchAnywhereAdapter.name);
  private readonly LOGIN_URL = 'https://app.dispatchanywhere.com/login';
  private readonly DISPATCH_URL = 'https://app.dispatchanywhere.com/dispatch';

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async login(tenantId: string, creds: DecryptedCredentials): Promise<void> {
    const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(this.LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await this.fillLoginForm(page, creds);
      await this.submitLoginForm(page);
      await page.waitForURL((url) => !url.toString().includes('/login'), {
        timeout: NAV_TIMEOUT_MS,
      });

      const storageState = await context.storageState();
      await this.redis.set(
        `session:dispatchanywhere:${tenantId}`,
        JSON.stringify(storageState),
        'EX',
        SESSION_TTL_SECONDS,
      );

      this.logger.log(`Dispatch Anywhere login successful for tenant ${tenantId}`);
    } catch (error) {
      this.logger.error(
        `Dispatch Anywhere login failed for tenant ${tenantId}: ${(error as Error).message}`,
      );
      throw error;
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  async scrapeAllActiveJobs(tenantId: string): Promise<ActiveJob[]> {
    const stateJson = await this.redis.get(`session:dispatchanywhere:${tenantId}`);
    if (!stateJson) {
      throw new SessionExpiredException(`No session context for tenant ${tenantId}`);
    }

    const storageState = JSON.parse(stateJson);
    const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    try {
      const context = await browser.newContext({ storageState });
      const page = await context.newPage();

      await page.goto(this.DISPATCH_URL, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });

      if (page.url().includes('/login')) {
        await this.redis.del(`session:dispatchanywhere:${tenantId}`);
        throw new SessionExpiredException(`Session bounced to login for tenant ${tenantId}`);
      }

      await page.waitForTimeout(2_500);

      const jobs = await this.extractRows(page);
      await this.redis.set(
        `jobs:dispatchanywhere:${tenantId}`,
        JSON.stringify(jobs),
        'EX',
        JOBS_CACHE_TTL_SECONDS,
      );

      this.logger.log(
        `Dispatch Anywhere: scraped ${jobs.length} active jobs for tenant ${tenantId}`,
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
      await page.goto(this.LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await this.fillLoginForm(page, creds);
      await this.submitLoginForm(page);
      await page.waitForURL((url) => !url.toString().includes('/login'), {
        timeout: NAV_TIMEOUT_MS,
      });
      return {
        success: true,
        message: 'Dispatch Anywhere connected successfully',
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        message: `Dispatch Anywhere login failed: ${(error as Error).message}`,
        latencyMs: Date.now() - start,
      };
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  async acceptJob(tenantId: string, sourceJobId: string): Promise<AdapterActionResult> {
    return this.performAction(tenantId, sourceJobId, 'accept', ACCEPT_BUTTON_NAMES);
  }

  async declineJob(
    tenantId: string,
    sourceJobId: string,
    reason: string,
  ): Promise<AdapterActionResult> {
    return this.performAction(tenantId, sourceJobId, 'decline', DECLINE_BUTTON_NAMES, reason);
  }

  /**
   * Push a job from us → Dispatch Anywhere. Dispatch Anywhere is primarily a
   * dispatch product (operators manage their own jobs inside it), not a
   * motor-club intake broker with a verified public write API. Returns a
   * structured not-applicable result — same pattern as Omadi / TowLogs.
   */
  async dispatchJob(
    tenantId: string,
    jobPayload: Record<string, unknown>,
  ): Promise<AdapterActionResult> {
    this.logger.log(
      `[dispatchanywhere] dispatchJob not-applicable (tenant=${tenantId}, payload-keys=${Object.keys(
        jobPayload,
      ).join(',')})`,
    );
    return {
      success: false,
      error: 'not-applicable: Dispatch Anywhere has no verified outbound dispatch write surface',
    };
  }

  private async fillLoginForm(page: Page, creds: DecryptedCredentials): Promise<void> {
    const userField = page
      .locator('input[name="email"], input[type="email"], input[name="username"], #email, #username')
      .first();
    const passField = page
      .locator('input[type="password"], input[name="password"], #password')
      .first();
    await userField.fill(creds.username, { timeout: 15_000 });
    await passField.fill(creds.password, { timeout: 15_000 });
  }

  private async submitLoginForm(page: Page): Promise<void> {
    const submit = page.getByRole('button', { name: /sign in|log ?in|login/i }).first();
    if ((await submit.count()) > 0) {
      await submit.click({ timeout: 15_000 });
      return;
    }
    await page.locator('button[type="submit"]').first().click({ timeout: 15_000 });
  }

  private async performAction(
    tenantId: string,
    sourceJobId: string,
    kind: 'accept' | 'decline',
    buttonNames: string[],
    reason?: string,
  ): Promise<AdapterActionResult> {
    const stateJson = await this.redis.get(`session:dispatchanywhere:${tenantId}`);
    if (!stateJson) {
      const error = `credentials-not-configured: no Dispatch Anywhere session for tenant ${tenantId} — login required before ${kind}`;
      this.logger.warn(`[dispatchanywhere] ${kind}Job: ${error}`);
      return { success: false, error };
    }

    let browser: Browser | null = null;
    let page: Page | null = null;
    try {
      const storageState = JSON.parse(stateJson);
      browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
      const context = await browser.newContext({ storageState });
      page = await context.newPage();

      await page.goto(this.DISPATCH_URL, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });
      if (page.url().includes('/login')) {
        await this.redis.del(`session:dispatchanywhere:${tenantId}`);
        return { success: false, error: `session expired for tenant ${tenantId}` };
      }
      await page.waitForTimeout(2_500);

      const jobLink = page.getByRole('link', { name: sourceJobId, exact: false }).first();
      if ((await jobLink.count()) === 0) {
        await this.screenshotFailure(page, kind, sourceJobId);
        return {
          success: false,
          error: `job ${sourceJobId} not found in Dispatch Anywhere dispatch list`,
        };
      }
      await jobLink.click({ timeout: ACTION_BUTTON_TIMEOUT_MS });
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      await page.waitForTimeout(2_500);

      const primary = await this.firstVisibleButton(page, buttonNames);
      if (!primary) {
        await this.screenshotFailure(page, kind, sourceJobId);
        return {
          success: false,
          error: `${kind} button not found on Dispatch Anywhere job ${sourceJobId} (tried: ${buttonNames.join(
            ', ',
          )}) — selectors may need verification, see docs/ADAPTER_SELECTORS.md`,
        };
      }
      await primary.click({ timeout: ACTION_BUTTON_TIMEOUT_MS });

      await page.waitForTimeout(1_500);
      if (reason) {
        let reasonField = page.locator('textarea:visible').last();
        if ((await reasonField.count()) === 0) {
          reasonField = page.locator('input[type="text"]:visible').last();
        }
        if ((await reasonField.count()) > 0) {
          await reasonField.fill(reason).catch(() => undefined);
        }
      }
      const dialog = page.locator('[role="dialog"], .modal').first();
      if ((await dialog.count()) > 0 && (await dialog.isVisible().catch(() => false))) {
        const confirm = await this.firstVisibleButton(page, CONFIRM_BUTTON_NAMES, dialog);
        if (confirm) {
          await confirm.click({ timeout: ACTION_BUTTON_TIMEOUT_MS }).catch(() => undefined);
        }
      }

      const evidence = await this.readConfirmation(page);
      this.logger.log(
        `[dispatchanywhere] ${kind} succeeded for job ${sourceJobId} (tenant ${tenantId}): ${evidence}`,
      );
      return {
        success: true,
        confirmedAt: new Date().toISOString(),
        confirmationEvidence: evidence,
      };
    } catch (err) {
      const error = (err as Error).message;
      this.logger.error(`[dispatchanywhere] ${kind}Job failed for ${sourceJobId}: ${error}`);
      if (page) await this.screenshotFailure(page, kind, sourceJobId);
      return { success: false, error };
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }

  private async firstVisibleButton(
    page: Page,
    names: string[],
    scope?: Locator,
  ): Promise<Locator | null> {
    const root = scope ?? page;
    for (const name of names) {
      const loc = root.getByRole('button', { name, exact: true }).first();
      if (
        (await loc.count()) > 0 &&
        (await loc.isVisible().catch(() => false)) &&
        (await loc.isEnabled().catch(() => false))
      ) {
        return loc;
      }
    }
    return null;
  }

  private async readConfirmation(page: Page): Promise<string> {
    const toast = page.locator('[role="status"], .toast, .notification, .alert').first();
    if ((await toast.count()) > 0) {
      const t = (await toast.textContent().catch(() => null))?.trim();
      if (t) return `toast: ${t.slice(0, 200)}`;
    }
    return `action submitted at ${new Date().toISOString()} (no toast captured)`;
  }

  private async screenshotFailure(page: Page, kind: string, sourceJobId: string): Promise<void> {
    const safe = sourceJobId.replace(/[^A-Za-z0-9_-]/g, '_');
    const file = path.join(
      os.tmpdir(),
      `dispatchanywhere-${kind}-${safe}-${Date.now()}.png`,
    );
    await page.screenshot({ path: file, fullPage: true }).catch(() => undefined);
    this.logger.warn(`[dispatchanywhere] ${kind} failure screenshot: ${file}`);
  }

  private async extractRows(page: Page): Promise<ActiveJob[]> {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    return page.evaluate((rowSelectors: string[]) => {
      const doc: any = (globalThis as any).document;
      let rows: any[] = [];
      for (const sel of rowSelectors) {
        const found: any[] = Array.from(doc.querySelectorAll(sel));
        if (found.length > 0) {
          rows = found;
          break;
        }
      }

      const cleanText = (s: string | null | undefined): string =>
        (s ?? '').replace(/\s+/g, ' ').trim();
      const findPhone = (s: string): string => {
        const m = s.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
        return m ? m[0].replace(/\D/g, '') : '';
      };

      const out: Array<Record<string, string>> = [];
      rows.forEach((row: any) => {
        const text = cleanText(row.textContent || '');
        const phone = findPhone(text);
        const id =
          row.getAttribute('data-job-id') ||
          row.getAttribute('data-call-id') ||
          row.getAttribute('data-dispatch-id') ||
          row.getAttribute('data-id') ||
          (row.querySelector('a[href*="/dispatch"], a[href*="/job"]')?.getAttribute('href') ?? '')
            .split('/')
            .filter(Boolean)
            .pop() ||
          '';
        out.push({
          jobId: cleanText(id),
          customerName: cleanText(
            row.querySelector('[data-customer], .customer, .customer-name')?.textContent ?? '',
          ),
          customerPhone: phone,
          vehicle: cleanText(row.querySelector('[data-vehicle], .vehicle')?.textContent ?? ''),
          status: cleanText(row.querySelector('[data-status], .status')?.textContent ?? ''),
          driverName: cleanText(row.querySelector('[data-driver], .driver')?.textContent ?? ''),
          eta: cleanText(row.querySelector('[data-eta], .eta')?.textContent ?? '') || 'Unknown',
          destination: cleanText(
            row.querySelector('[data-destination], .destination')?.textContent ?? '',
          ),
          lastUpdated: new Date().toISOString(),
        });
      });
      return out as unknown as ActiveJob[];
    }, ROW_SELECTOR_CANDIDATES);
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }
}
