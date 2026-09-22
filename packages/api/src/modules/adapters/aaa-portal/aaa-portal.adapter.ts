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
const AAA_ACTIVE_CALL_TTL_SECONDS = 7 * 24 * 60 * 60;

// Salesforce community pages keep WebSocket telemetry connections open
// indefinitely, so `networkidle` never fires within the Playwright default
// 30s window — the cron started failing on 2026-05-21. Switching to
// `domcontentloaded` plus an explicit wait for the work-order table fixes it.
// Verified empirically: dom load completes in ~3s; table renders within ~8s.
const AAA_NAV_TIMEOUT_MS = 60_000;
const WORK_ORDERS_TABLE_SELECTOR = 'table[role="grid"]';
const WORK_ORDERS_SELECTOR = `${WORK_ORDERS_TABLE_SELECTOR} tbody`;
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

/** A semantic Work Orders row, independent of Salesforce's generated DOM ids. */
export interface AaaWorkOrderRow {
  workOrderNumber: string;
  callId: string;
  callDate: string;
  status: string;
  serviceTerritory: string;
  customerName: string;
  memberNumber: string;
  customerPhone: string;
}

// Verified from AAA Service Appointment Status History on 2026-09-21.
// Keep this allowlist deliberately narrow: an unverified status must never be
// interpreted as completed (or otherwise trigger customer automation).
// The Work Orders list uses the parent-level `In Progress` status while the
// Service Appointment detail/history exposes the later operational stages.
// Treating In Progress as active lets a newly received AAA call enter the
// unified queue before a driver advances it to En Route.
const ACTIVE_AAA_STATUS = /^(in progress|en route|on location|tow loaded)$/i;
const TERMINAL_AAA_STATUS = /^cleared$/i;
const VERIFIED_COMPLETED_STATUS = 'Tow Complete';
const VERIFIED_NOT_COMPLETED_STATUS = 'Closed Without Tow Complete';

export interface AaaClearedOutcomeEvidence {
  towCompleteTimestamp: string;
  canceledTimestamp: string;
}

export interface AaaWorkOrderDetails extends AaaClearedOutcomeEvidence {
  customerName: string;
  customerPhone: string;
  vehicle: string;
  pickup: string;
  destination: string;
  latitude: string;
  longitude: string;
  serviceType: string;
  resolutionCode: string;
  recordStatus: string;
  serviceAppointmentCount: number;
  serviceAppointmentStatuses: string[];
}

const EMPTY_AAA_WORK_ORDER_DETAILS: AaaWorkOrderDetails = {
  towCompleteTimestamp: '',
  canceledTimestamp: '',
  customerName: '',
  customerPhone: '',
  vehicle: '',
  pickup: '',
  destination: '',
  latitude: '',
  longitude: '',
  serviceType: '',
  resolutionCode: '',
  recordStatus: '',
  serviceAppointmentCount: 0,
  serviceAppointmentStatuses: [],
};

/**
 * Parent Work Orders and their two Service Appointments expose different
 * pieces of the same call. Keep the first non-empty value, except terminal
 * evidence where any child appointment may provide the decisive timestamp.
 */
export function mergeAaaWorkOrderDetails(
  records: AaaWorkOrderDetails[],
): AaaWorkOrderDetails {
  const first = (
    key: Exclude<keyof AaaWorkOrderDetails, 'serviceAppointmentCount' | 'serviceAppointmentStatuses'>,
  ): string => records.map((record) => record[key].trim()).find(Boolean) ?? '';

  return {
    towCompleteTimestamp: first('towCompleteTimestamp'),
    canceledTimestamp: first('canceledTimestamp'),
    customerName: first('customerName'),
    customerPhone: first('customerPhone'),
    vehicle: first('vehicle'),
    pickup: first('pickup'),
    destination: first('destination'),
    latitude: first('latitude'),
    longitude: first('longitude'),
    serviceType: first('serviceType'),
    resolutionCode: first('resolutionCode'),
    recordStatus: first('recordStatus'),
    serviceAppointmentCount: 0,
    serviceAppointmentStatuses: [],
  };
}

export function allAaaServiceAppointmentsCleared(
  details: Pick<AaaWorkOrderDetails, 'serviceAppointmentCount' | 'serviceAppointmentStatuses'>,
): boolean {
  const expected = details.serviceAppointmentCount ?? 0;
  const statuses = details.serviceAppointmentStatuses ?? [];
  return (
    expected > 0 &&
    statuses.length === expected &&
    statuses.every((status) => /^cleared$/i.test(status.trim()))
  );
}

/**
 * `Cleared` only means that AAA closed the call. Live portal records prove it
 * is used for both completed tows and calls that never progressed. A customer
 * completion is valid only when AAA supplies a Tow Complete timestamp and no
 * cancellation timestamp.
 */
export function classifyAaaClearedOutcome(
  evidence: AaaClearedOutcomeEvidence & { resolutionCode?: string },
): typeof VERIFIED_COMPLETED_STATUS | typeof VERIFIED_NOT_COMPLETED_STATUS {
  const resolutionCode = (evidence.resolutionCode ?? '').trim().toUpperCase();
  if (evidence.canceledTimestamp.trim() || /^[XR]\d{3}\b/.test(resolutionCode)) {
    return VERIFIED_NOT_COMPLETED_STATUS;
  }
  if (evidence.towCompleteTimestamp.trim() || /^G\d{3}\b/.test(resolutionCode)) {
    return VERIFIED_COMPLETED_STATUS;
  }
  return VERIFIED_NOT_COMPLETED_STATUS;
}

export function isVerifiedAaaStatus(status: string): boolean {
  const value = status.trim();
  return ACTIVE_AAA_STATUS.test(value) || TERMINAL_AAA_STATUS.test(value);
}

function aaaStatusProgress(status: string): number {
  if (/^tow loaded$/i.test(status.trim())) return 3;
  if (/^on location$/i.test(status.trim())) return 2;
  if (/^en route$/i.test(status.trim())) return 1;
  return 0;
}

/**
 * Convert the live Salesforce table into semantic rows by header name. The
 * portal renders Work Order Number in a row-header `<th>` while every other
 * value is a `<td>`, so fixed `td[n]` indexes silently lose the job id.
 */
export function parseAaaWorkOrderTable(
  headers: string[],
  rows: string[][],
): AaaWorkOrderRow[] {
  const findColumn = (label: string): number =>
    headers.findIndex((header) =>
      header.replace(/\s+/g, ' ').trim().toLowerCase().includes(label.toLowerCase()),
    );

  const columns = {
    workOrderNumber: findColumn('Work Order Number'),
    callId: findColumn('Call ID'),
    callDate: findColumn('Call Date'),
    status: findColumn('Status'),
    serviceTerritory: findColumn('Service Territory'),
    customerName: findColumn('Contact'),
    memberNumber: findColumn('Member Number'),
    customerPhone: findColumn('Phone Number'),
  };

  const missing = Object.entries(columns)
    .filter(([, index]) => index < 0)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`AAA Work Orders table is missing required columns: ${missing.join(', ')}`);
  }

  const value = (row: string[], index: number): string => (row[index] ?? '').trim();
  return rows.map((row) => ({
    workOrderNumber: value(row, columns.workOrderNumber),
    callId: value(row, columns.callId),
    callDate: value(row, columns.callDate),
    status: value(row, columns.status),
    serviceTerritory: value(row, columns.serviceTerritory),
    customerName: value(row, columns.customerName),
    memberNumber: value(row, columns.memberNumber),
    customerPhone: value(row, columns.customerPhone).replace(/\D/g, ''),
  }));
}

/**
 * AAA shows two Service Appointments (en-route and in-tow) for one call in
 * Dispatch Console. Call ID is therefore the canonical job id; grouping here
 * prevents either stage from ever becoming a duplicate job downstream.
 */
export function assembleAaaActiveJobs(
  rows: AaaWorkOrderRow[],
  nowIso = new Date().toISOString(),
): ActiveJob[] {
  const rowsByCallId = new Map<string, AaaWorkOrderRow[]>();

  for (const row of rows) {
    const jobId = row.callId || row.workOrderNumber;
    if (!jobId || !row.customerPhone) continue;
    if (!isVerifiedAaaStatus(row.status)) continue;

    const existing = rowsByCallId.get(jobId) ?? [];
    existing.push(row);
    rowsByCallId.set(jobId, existing);
  }

  const jobs: ActiveJob[] = [];
  for (const [jobId, callRows] of rowsByCallId) {
    const activeRows = callRows.filter((row) => ACTIVE_AAA_STATUS.test(row.status.trim()));
    const selected =
      activeRows.sort((a, b) => aaaStatusProgress(b.status) - aaaStatusProgress(a.status))[0] ??
      callRows[0];

    jobs.push({
      jobId,
      customerName: selected.customerName,
      customerPhone: selected.customerPhone,
      vehicle: '',
      status: selected.status,
      driverName: '',
      eta: 'Unknown',
      pickup: '',
      destination: '',
      lastUpdated: nowIso,
    });
  }

  return jobs;
}

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

      // A legitimate empty list still renders the table/tbody. If the table is
      // absent, fail closed instead of caching [] and causing the cleanup rule
      // to mark every known AAA job completed after a portal DOM change.
      await page.waitForSelector(WORK_ORDERS_SELECTOR, {
        timeout: WORK_ORDERS_SELECTOR_TIMEOUT_MS,
      });

      await this.dumpDiagnostics(page, tenantId, attempt).catch((e) => {
        this.logger.warn(`[aaa-debug] diagnostic dump failed: ${(e as Error).message}`);
      });

      const jobs = await this.extractRows(page, tenantId);

      await this.redis.set(
        `jobs:aaa_portal:${tenantId}`,
        JSON.stringify(jobs),
        'EX',
        JOBS_CACHE_TTL_SECONDS,
      );

      this.logger.log(
        `AAA Portal: Scraped ${jobs.length} active calls for tenant ${tenantId} (attempt ${attempt})`,
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

  private async extractRows(page: Page, tenantId: string): Promise<ActiveJob[]> {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const matrix = await page.evaluate((tableSelector) => {
      const doc: any = (globalThis as any).document;
      const tables: any[] = Array.from(doc.querySelectorAll(tableSelector));
      const table = tables.find((candidate: any) => {
        const text = candidate.querySelector('thead')?.textContent ?? '';
        return /Work Order Number/i.test(text) && /Call ID/i.test(text) && /Phone Number/i.test(text);
      });
      if (!table) return null;

      const headerRow = table.querySelector('thead tr:last-child');
      const headers = Array.from(headerRow?.querySelectorAll('th') ?? []).map(
        (cell: any) => cell.textContent?.trim() ?? '',
      );
      const rows = Array.from(table.querySelectorAll('tbody tr')).map((row: any) =>
        Array.from(row.querySelectorAll(':scope > th, :scope > td')).map(
          (cell: any) => cell.textContent?.trim() ?? '',
        ),
      );
      return { headers, rows };
    }, WORK_ORDERS_TABLE_SELECTOR);
    /* eslint-enable @typescript-eslint/no-explicit-any */

    if (!matrix) {
      throw new Error('AAA Work Orders table rendered without the expected semantic headers');
    }

    const rows = parseAaaWorkOrderTable(matrix.headers, matrix.rows);
    const unknownStatuses = [...new Set(
      rows
        .map((row) => row.status.trim())
        .filter((status) => status && !isVerifiedAaaStatus(status)),
    )].sort();
    if (unknownStatuses.length > 0) {
      this.logger.warn(
        `[aaa-status-discovery] tenant=${tenantId} ignored unverified statuses: ${unknownStatuses.join(', ')}`,
      );
    }

    const jobs = assembleAaaActiveJobs(rows);
    const output: ActiveJob[] = [];

    for (const job of jobs) {
      const trackingKey = this.activeCallTrackingKey(tenantId, job.jobId);
      if (!TERMINAL_AAA_STATUS.test(job.status.trim())) {
        // Only calls genuinely observed in an active stage can later produce a
        // terminal event. This prevents first connection from importing the
        // portal's historical Cleared rows and firing customer automation.
        await this.redis.set(trackingKey, '1', 'EX', AAA_ACTIVE_CALL_TTL_SECONDS);
        const details = await this.readWorkOrderDetails(page, tenantId, job.jobId, true);
        if (details) {
          this.applyWorkOrderDetails(job, details);
          // AAA may leave the parent Work Order at In Progress after both
          // child Service Appointments have cleared. Treat the children as
          // the terminal source of truth only when every linked appointment
          // was read successfully and is explicitly Cleared.
          if (allAaaServiceAppointmentsCleared(details)) {
            job.status = classifyAaaClearedOutcome(details);
            this.logger.log(
              `AAA Portal: child appointments closed ${job.jobId}; outcome=${job.status} ` +
                `resolution=${details.resolutionCode || 'blank'}`,
            );
            output.push(job);
            await this.redis.del(trackingKey);
            continue;
          }
        }
        output.push(job);
        continue;
      }

      if (!(await this.redis.get(trackingKey))) {
        this.logger.debug(
          `AAA Portal: ignoring historical Cleared call ${job.jobId}; it was not observed active`,
        );
        continue;
      }

      const details = await this.readWorkOrderDetails(page, tenantId, job.jobId);
      if (!details) {
        // Fail closed and retain the marker so a later poll can retry.
        this.logger.warn(
          `AAA Portal: could not verify Cleared outcome for ${job.jobId}; withholding terminal automation`,
        );
        continue;
      }

      this.applyWorkOrderDetails(job, details);
      job.status = classifyAaaClearedOutcome(details);
      output.push(job);
      await this.redis.del(trackingKey);
    }

    return output;
  }

  private activeCallTrackingKey(tenantId: string, jobId: string): string {
    return `aaa:observed-active:${tenantId}:${jobId}`;
  }

  /**
   * Open one Work Order read-only and merge it with its linked Breakdown and
   * Tow Service Appointments. AAA keeps contact data on the parent while the
   * vehicle, addresses, and lifecycle timestamps commonly live on the child
   * SA records.
   */
  private async readWorkOrderDetails(
    listPage: Page,
    tenantId: string,
    jobId: string,
    allowCache = false,
  ): Promise<AaaWorkOrderDetails | null> {
    const cacheKey = `aaa:work-order-detail:${tenantId}:${jobId}`;
    if (allowCache) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        try {
          return JSON.parse(cached) as AaaWorkOrderDetails;
        } catch {
          await this.redis.del(cacheKey);
        }
      }
    }

    const jobLink = listPage.getByRole('link', { name: jobId, exact: true }).first();
    const href = await jobLink.getAttribute('href').catch(() => null);
    if ((await jobLink.count()) === 0) return null;

    const detailPage = await listPage.context().newPage();
    try {
      if (href && !/^javascript:/i.test(href)) {
        await detailPage.goto(new URL(href, listPage.url()).href, {
          waitUntil: 'domcontentloaded',
          timeout: AAA_NAV_TIMEOUT_MS,
        });
      } else {
        // Salesforce renders Work Order links as javascript:void(0) in this
        // list. Open an isolated copy of the list and click only the record
        // link; this is read-only and keeps the poller's source page intact.
        await detailPage.goto(listPage.url(), {
          waitUntil: 'domcontentloaded',
          timeout: AAA_NAV_TIMEOUT_MS,
        });
        await detailPage.waitForSelector(WORK_ORDERS_SELECTOR, {
          timeout: WORK_ORDERS_SELECTOR_TIMEOUT_MS,
        });
        const detailJobLink = detailPage
          .getByRole('link', { name: jobId, exact: true })
          .first();
        if ((await detailJobLink.count()) === 0) return null;
        await detailJobLink.click({ timeout: ACTION_BUTTON_TIMEOUT_MS });
        await detailPage.waitForTimeout(2_000);
      }
      if (detailPage.url().includes('/login')) return null;

      await detailPage.waitForTimeout(1_500);

      const records: AaaWorkOrderDetails[] = [await this.readAaaRecordDetails(detailPage)];
      const serviceAppointments = await detailPage.locator('a').evaluateAll((links) => {
        const byHref = new Map<string, { href: string; status: string }>();
        for (const link of links) {
          const text = (link.textContent ?? '').trim();
          const href = (link as unknown as { href?: string }).href ?? '';
          if (!/^SA-\d+$/i.test(text) || !href) continue;

          let current: { innerText?: string; parentElement?: unknown } | null =
            link as unknown as { innerText?: string; parentElement?: unknown };
          let status = '';
          for (let depth = 0; current && depth < 7; depth += 1) {
            const match = String(current.innerText ?? '').match(/(?:^|\n)Status:\s*([^\n]+)/i);
            if (match?.[1]) {
              status = match[1].trim();
              break;
            }
            current = current.parentElement as typeof current;
          }
          byHref.set(href, { href, status });
        }
        return [...byHref.values()];
      });

      const serviceAppointmentRecords: AaaWorkOrderDetails[] = [];
      for (const serviceAppointment of serviceAppointments) {
        const parsed = new URL(serviceAppointment.href, detailPage.url());
        if (parsed.origin !== new URL(detailPage.url()).origin) continue;

        const serviceAppointmentPage = await listPage.context().newPage();
        try {
          await serviceAppointmentPage.goto(parsed.href, {
            waitUntil: 'domcontentloaded',
            timeout: AAA_NAV_TIMEOUT_MS,
          });
          if (serviceAppointmentPage.url().includes('/login')) continue;
          await serviceAppointmentPage.waitForTimeout(1_500);
          const record = await this.readAaaRecordDetails(serviceAppointmentPage);
          if (!record.recordStatus) record.recordStatus = serviceAppointment.status;
          records.push(record);
          serviceAppointmentRecords.push(record);
        } catch (error) {
          this.logger.warn(
            `AAA Portal: service appointment detail read failed for ${jobId}: ${(error as Error).message}`,
          );
        } finally {
          await serviceAppointmentPage.close().catch(() => undefined);
        }
      }

      const details = mergeAaaWorkOrderDetails(records);
      details.serviceAppointmentCount = serviceAppointments.length;
      details.serviceAppointmentStatuses = serviceAppointmentRecords
        .map((record) => record.recordStatus.trim())
        .filter(Boolean);
      this.logger.log(
        `AAA Portal: read detail for ${jobId} outcome=${classifyAaaClearedOutcome(details)} ` +
          `appointments=${serviceAppointments.length} vehicle=${details.vehicle || 'blank'} ` +
          `statuses=${details.serviceAppointmentStatuses.join('|') || 'blank'} ` +
          `resolution=${details.resolutionCode || 'blank'} ` +
          `towComplete=${details.towCompleteTimestamp || 'blank'} canceled=${details.canceledTimestamp || 'blank'}`,
      );
      await this.redis.set(cacheKey, JSON.stringify(details), 'EX', JOBS_CACHE_TTL_SECONDS);
      return details;
    } catch (error) {
      this.logger.warn(
        `AAA Portal: terminal evidence read failed for ${jobId}: ${(error as Error).message}`,
      );
      return null;
    } finally {
      await detailPage.close().catch(() => undefined);
    }
  }

  private applyWorkOrderDetails(job: ActiveJob, details: AaaWorkOrderDetails): void {
    const phone = details.customerPhone.replace(/\D/g, '');
    if (details.customerName) job.customerName = details.customerName;
    if (phone) job.customerPhone = phone;
    if (details.vehicle) job.vehicle = details.vehicle;
    if (details.pickup) job.pickup = details.pickup;
    if (details.destination) job.destination = details.destination;
    if (details.latitude) job.latitude = details.latitude;
    if (details.longitude) job.longitude = details.longitude;
    if (details.serviceType) job.serviceType = details.serviceType;
  }

  private async readAaaRecordDetails(page: Page): Promise<AaaWorkOrderDetails> {
    const read = (...labels: string[]) => this.readFirstLightningField(page, labels);
    return {
      ...EMPTY_AAA_WORK_ORDER_DETAILS,
      towCompleteTimestamp: await read('Tow Complete Timestamp', 'Tow Completed Timestamp'),
      canceledTimestamp: await read(
        'Canceled Timestamp',
        'Cancelled Timestamp',
        'Cancellation Timestamp',
      ),
      customerName: await read('Contact', 'Member Name', 'Customer Name'),
      customerPhone: await read('Phone Number', 'Phone'),
      vehicle: await read('Vehicle Profile', 'Vehicle'),
      pickup: await read(
        'Breakdown Address',
        'Breakdown Location',
        'Pickup Address',
        'Service Location',
      ),
      destination: await read('Tow Address', 'Tow Destination', 'Destination Address'),
      latitude: await read('Latitude', 'Breakdown Latitude'),
      longitude: await read('Longitude', 'Breakdown Longitude'),
      serviceType: await read('Work Type', 'Service Type'),
      resolutionCode: await read('Resolution Code'),
      recordStatus: await read('Status'),
    };
  }

  private async readFirstLightningField(page: Page, labels: string[]): Promise<string> {
    for (const label of labels) {
      const value = await this.readLightningField(page, label);
      if (value) return value;
    }
    return '';
  }

  /** Read one label/value pair from a Salesforce Lightning record layout. */
  private async readLightningField(page: Page, labelText: string): Promise<string> {
    const labels = page.getByText(labelText, { exact: true });
    const count = await labels.count();
    for (let index = 0; index < count; index += 1) {
      const value = await labels.nth(index).evaluate((node, expectedLabel) => {
        let current: {
          innerText?: string;
          parentElement?: unknown;
        } | null = node as unknown as { innerText?: string; parentElement?: unknown };
        for (let depth = 0; current && depth < 8; depth += 1) {
          const lines = String(current.innerText ?? '')
            .split('\n')
            .map((line: string) => line.trim())
            .filter(Boolean);
          if (lines[0] === expectedLabel && lines.length >= 2) {
            return lines[1] ?? '';
          }
          current = current.parentElement as typeof current;
        }
        return '';
      }, labelText);
      if (value) return value;
    }
    return '';
  }
}
