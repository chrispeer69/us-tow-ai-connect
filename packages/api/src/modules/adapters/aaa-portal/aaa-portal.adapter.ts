import { Inject, Injectable, Logger } from '@nestjs/common';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { promises as fs } from 'node:fs';
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

// Salesforce community pages keep WebSocket telemetry connections open
// indefinitely, so `networkidle` never fires within the Playwright default
// 30s window — the cron started failing on 2026-05-21. Switching to
// `domcontentloaded` plus an explicit wait for the work-order table fixes it.
// Verified empirically: dom load completes in ~3s; table renders within ~8s.
const AAA_NAV_TIMEOUT_MS = 60_000;
const WORK_ORDERS_SELECTOR = 'table[role="grid"] tbody';
const WORK_ORDERS_SELECTOR_TIMEOUT_MS = 30_000;
const SCRAPE_MAX_ATTEMPTS = 2;
const SCRAPE_RETRY_BACKOFF_MS = 5_000;

// Candidate selectors we count on every scrape — gives us instant visibility
// when Salesforce restructures the DOM. `table[role="grid"] tbody` is the
// verified anchor; the rest are legacy guesses kept for regression detection.
const CANDIDATE_SELECTORS = [
  WORK_ORDERS_SELECTOR,
  'table[role="grid"]',
  'tbody tr',
  'lightning-datatable',
  '.slds-table tbody',
  '[data-aura-class*="WorkOrder"]',
];

// Action-button accessible names. Salesforce Lightning renders these inside
// lightning-button shadow roots; Playwright's getByRole pierces open shadow
// DOM, so we locate by accessible name rather than CSS. Decline was verified
// live 2026-05-23 (getByRole('button',{name:'Decline'}) -> 1 visible/enabled).
// Accept could not be verified — no offered job existed at discovery time — so
// we try a small set of likely labels and fail cleanly if none resolve. See
// docs/ADAPTER_SELECTORS.md.
const ACCEPT_BUTTON_NAMES = ['Accept', 'Accept Call', 'Accept Job', 'Accept Dispatch'];
const DECLINE_BUTTON_NAMES = ['Decline', 'Decline Call', 'Reject'];
// Buttons that confirm a reason modal after the primary Decline/Accept click.
const CONFIRM_BUTTON_NAMES = ['Decline', 'Accept', 'Submit', 'Confirm', 'Save', 'OK', 'Yes'];
const ACTION_NAV_TIMEOUT_MS = 60_000;
const ACTION_BUTTON_TIMEOUT_MS = 15_000;

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

      await page.goto(this.LOGIN_URL, {
        waitUntil: 'domcontentloaded',
        timeout: AAA_NAV_TIMEOUT_MS,
      });
      await page.fill('#username', creds.username);
      await page.fill('#password', creds.password);
      await page.click('#Login');

      await page.waitForURL('**/ACACONTRACTORCOMMUNITY/s/**', {
        timeout: AAA_NAV_TIMEOUT_MS,
      });

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
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= SCRAPE_MAX_ATTEMPTS; attempt++) {
      try {
        return await this.scrapeOnce(tenantId, attempt);
      } catch (err) {
        lastErr = err;
        if (err instanceof SessionExpiredException) throw err;
        if (attempt < SCRAPE_MAX_ATTEMPTS) {
          this.logger.warn(
            `AAA Portal scrape attempt ${attempt} failed for tenant ${tenantId}: ${(err as Error).message} — retrying in ${SCRAPE_RETRY_BACKOFF_MS}ms`,
          );
          await new Promise((r) => setTimeout(r, SCRAPE_RETRY_BACKOFF_MS));
        }
      }
    }
    this.logger.error(
      `AAA Portal scrape exhausted ${SCRAPE_MAX_ATTEMPTS} attempts for tenant ${tenantId}: ${(lastErr as Error)?.message}`,
    );
    throw lastErr;
  }

  private async scrapeOnce(tenantId: string, attempt: number): Promise<ActiveJob[]> {
    const stateJson = await this.redis.get(`session:aaa_portal:${tenantId}`);
    if (!stateJson) {
      throw new SessionExpiredException(`No session context for tenant ${tenantId}`);
    }

    const storageState = JSON.parse(stateJson);
    const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });

    try {
      const context = await browser.newContext({ storageState });
      const page = await context.newPage();

      await page.goto(this.WORK_ORDERS_URL, {
        waitUntil: 'domcontentloaded',
        timeout: AAA_NAV_TIMEOUT_MS,
      });

      if (page.url().includes('/login')) {
        await this.redis.del(`session:aaa_portal:${tenantId}`);
        throw new SessionExpiredException(`Session bounced to login for tenant ${tenantId}`);
      }

      // Explicit wait for the work-order table to render. We tolerate it not
      // appearing within the timeout (account may legitimately have zero
      // jobs) — the selector-count diagnostic below distinguishes "0 = no
      // jobs" from "0 = wrong selector".
      await page
        .waitForSelector(WORK_ORDERS_SELECTOR, {
          timeout: WORK_ORDERS_SELECTOR_TIMEOUT_MS,
        })
        .catch(() => undefined);

      await this.dumpDiagnostics(page, tenantId, attempt).catch((e) => {
        this.logger.warn(`[aaa-debug] diagnostic dump failed: ${(e as Error).message}`);
      });

      const jobs: ActiveJob[] = await this.extractRows(page);

      await this.redis.set(
        `jobs:aaa_portal:${tenantId}`,
        JSON.stringify(jobs),
        'EX',
        JOBS_CACHE_TTL_SECONDS,
      );

      this.logger.log(
        `AAA Portal: Scraped ${jobs.length} In Progress jobs for tenant ${tenantId} (attempt ${attempt})`,
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

      await page.goto(this.LOGIN_URL, {
        waitUntil: 'domcontentloaded',
        timeout: AAA_NAV_TIMEOUT_MS,
      });
      await page.fill('#username', creds.username);
      await page.fill('#password', creds.password);
      await page.click('#Login');
      await page.waitForURL('**/ACACONTRACTORCOMMUNITY/s/**', {
        timeout: AAA_NAV_TIMEOUT_MS,
      });

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

  private async dumpDiagnostics(page: Page, tenantId: string, attempt: number): Promise<void> {
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
      `[aaa-debug] tenant=${tenantId} attempt=${attempt} url=${page.url()}`,
    );
    for (const c of counts) {
      this.logger.log(`[aaa-debug]   ${c.selector} -> ${c.count}`);
    }
  }

  /**
   * Accept a work order: open it in the portal and click the Accept button.
   * Never throws — returns an AdapterActionResult so the dispatch audit row
   * reflects whether the click actually landed.
   */
  async acceptJob(tenantId: string, sourceJobId: string): Promise<AdapterActionResult> {
    return this.performAction(tenantId, sourceJobId, 'accept', ACCEPT_BUTTON_NAMES);
  }

  /**
   * Decline a work order: open it and click Decline, supplying `reason` into
   * the reason modal when present. Never throws.
   */
  async declineJob(
    tenantId: string,
    sourceJobId: string,
    reason: string,
  ): Promise<AdapterActionResult> {
    return this.performAction(tenantId, sourceJobId, 'decline', DECLINE_BUTTON_NAMES, reason);
  }

  /**
   * Shared accept/decline driver. Restores the cached login session, opens the
   * specific Work Order, clicks the primary action button (located by
   * accessible name — pierces Lightning shadow DOM), handles an optional
   * reason/confirm modal, and reads back a confirmation string. On any failure
   * it screenshots to the OS temp dir and returns { success:false, error }.
   */
  private async performAction(
    tenantId: string,
    sourceJobId: string,
    kind: 'accept' | 'decline',
    buttonNames: string[],
    reason?: string,
  ): Promise<AdapterActionResult> {
    const stateJson = await this.redis.get(`session:aaa_portal:${tenantId}`);
    if (!stateJson) {
      const error = `no AAA session for tenant ${tenantId} — login required before ${kind}`;
      this.logger.warn(`[aaa-portal] ${kind}Job: ${error}`);
      return { success: false, error };
    }

    let browser: Browser | null = null;
    let page: Page | null = null;
    try {
      const storageState = JSON.parse(stateJson);
      browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
      const context = await browser.newContext({ storageState });
      page = await context.newPage();

      // Open the work-orders list, then click into the row for this job. The
      // detail URL needs the Salesforce record id, which we don't store — the
      // human-readable Work Order Number is rendered as a link, so we click it.
      await page.goto(this.WORK_ORDERS_URL, {
        waitUntil: 'domcontentloaded',
        timeout: ACTION_NAV_TIMEOUT_MS,
      });
      if (page.url().includes('/login')) {
        await this.redis.del(`session:aaa_portal:${tenantId}`);
        return { success: false, error: `session expired for tenant ${tenantId}` };
      }
      await page
        .waitForSelector(WORK_ORDERS_SELECTOR, { timeout: WORK_ORDERS_SELECTOR_TIMEOUT_MS })
        .catch(() => undefined);

      const jobLink = page.getByRole('link', { name: sourceJobId, exact: false }).first();
      if ((await jobLink.count()) === 0) {
        await this.screenshotFailure(page, kind, sourceJobId);
        return {
          success: false,
          error: `work order ${sourceJobId} not found in Work Orders list view`,
        };
      }
      await jobLink.click({ timeout: ACTION_BUTTON_TIMEOUT_MS });
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      await page.waitForTimeout(2_500); // let the LWC detail view settle

      // Primary action button (shadow-DOM-piercing by accessible name).
      const primary = await this.firstVisibleButton(page, buttonNames);
      if (!primary) {
        await this.screenshotFailure(page, kind, sourceJobId);
        return {
          success: false,
          error: `${kind} button not found on work order ${sourceJobId} (tried: ${buttonNames.join(', ')}) — selectors may need verification, see docs/ADAPTER_SELECTORS.md`,
        };
      }
      await primary.click({ timeout: ACTION_BUTTON_TIMEOUT_MS });

      // Optional reason/confirm modal. Best-effort: fill a reason field if one
      // appears, then click a confirming button. Unverified against a live job
      // (see docs/BLOCKERS.md) — tolerant of the modal being absent.
      await page.waitForTimeout(1_500);
      if (reason) {
        // Decline reason is typically a textarea; fall back to a text input.
        let reasonField = page.locator('textarea:visible').last();
        if ((await reasonField.count()) === 0) {
          reasonField = page.locator('input[type="text"]:visible').last();
        }
        if ((await reasonField.count()) > 0) {
          await reasonField.fill(reason).catch(() => undefined);
        }
      }
      // Click a confirm button only if a modal/dialog is present, to avoid
      // re-triggering the same control when no modal opened.
      const dialog = page.locator('[role="dialog"], .slds-modal, .uiModal').first();
      if ((await dialog.count()) > 0 && (await dialog.isVisible().catch(() => false))) {
        const confirm = await this.firstVisibleButton(page, CONFIRM_BUTTON_NAMES, dialog);
        if (confirm) await confirm.click({ timeout: ACTION_BUTTON_TIMEOUT_MS }).catch(() => undefined);
      }

      const evidence = await this.readConfirmation(page);
      this.logger.log(
        `[aaa-portal] ${kind} succeeded for job ${sourceJobId} (tenant ${tenantId}): ${evidence}`,
      );
      return {
        success: true,
        confirmedAt: new Date().toISOString(),
        confirmationEvidence: evidence,
      };
    } catch (err) {
      const error = (err as Error).message;
      this.logger.error(`[aaa-portal] ${kind}Job failed for ${sourceJobId}: ${error}`);
      if (page) await this.screenshotFailure(page, kind, sourceJobId);
      return { success: false, error };
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }

  /** Find the first visible+enabled button matching any of the accessible names. */
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

  /** Read a confirmation string from a toast or the status field. */
  private async readConfirmation(page: Page): Promise<string> {
    const toast = page.locator('.slds-notify__content, [role="status"], .toastMessage').first();
    if ((await toast.count()) > 0) {
      const t = (await toast.textContent().catch(() => null))?.trim();
      if (t) return `toast: ${t.slice(0, 200)}`;
    }
    return `action submitted at ${new Date().toISOString()} (no toast captured)`;
  }

  private async screenshotFailure(
    page: Page,
    kind: string,
    sourceJobId: string,
  ): Promise<void> {
    const safe = sourceJobId.replace(/[^A-Za-z0-9_-]/g, '_');
    const file = path.join(os.tmpdir(), `aaa-${kind}-failure-${safe}.png`);
    await page.screenshot({ path: file, fullPage: true }).catch(() => undefined);
    this.logger.warn(`[aaa-portal] ${kind} failure screenshot: ${file}`);
  }

  private async extractRows(page: Page): Promise<ActiveJob[]> {
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
