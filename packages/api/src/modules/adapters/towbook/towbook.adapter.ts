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

// Known DS4 dispatch-board column IDs, verified against a live account
// (git 18f8999). These four drive the fields we already capture correctly.
const VEHICLE_COLUMN_ID = '2';
const ETA_COLUMN_ID = '4';
const DRIVER_COLUMN_ID = '5';
const STATUS_COLUMN_ID = '14';
const CONTACT_COLUMN_ID = '22'; // "Name (xxx) xxx-xxxx"

// Non-address columns. The address fallback (scoreAddress / selectAddresses)
// must never consider these — they hold a vehicle, an ETA, a driver name, a
// status phrase (which can literally contain the word "Destination"), or the
// contact cell. Scanning them would inject noise into pickup/destination.
const RESERVED_COLUMN_IDS = new Set<string>([
  VEHICLE_COLUMN_ID,
  ETA_COLUMN_ID,
  DRIVER_COLUMN_ID,
  STATUS_COLUMN_ID,
  CONTACT_COLUMN_ID,
]);

// The pickup ("Tow From") and destination ("Tow To") address columns were NOT
// present in that verified capture — the prior code shipped `destination: ''`
// and never captured pickup at all. Their column IDs are therefore unknown and
// made configurable: once a live debug scrape (TOWBOOK_DEBUG_DUMP=1, or the
// always-on per-column diagnostics below) reveals which columnid carries each
// address, set these env vars (comma-separated columnids, first match wins).
// Until configured we capture nothing rather than risk persisting a WRONG
// address into the flip pipeline. See docs/TOWBOOK_DOM_MAP.md.
const PICKUP_COLUMN_IDS = parseColumnIdList(process.env.TOWBOOK_PICKUP_COLUMN_IDS);
const DROPOFF_COLUMN_IDS = parseColumnIdList(process.env.TOWBOOK_DROPOFF_COLUMN_IDS);

/** A single scraped dispatch row, reduced to its columnid→text cell map. */
export interface TowbookRawRow {
  dataId: string;
  cells: Record<string, string>;
}

/** Parse a comma-separated columnid env list into trimmed, non-empty ids. */
export function parseColumnIdList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Lenient guard applied to a configured address column so an operator's column
 * choice is trusted, while obvious non-address noise (a bare phone, a clock or
 * duration ETA) can't leak into the pickup/destination fields. We deliberately
 * do NOT require a street-number pattern — Towbook destinations are often a
 * business name the flip destination-classifier still needs to see.
 */
export function isPlausibleAddress(text: string): boolean {
  const t = (text ?? '').trim();
  if (t.length < 3) return false;
  if (/^\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}$/.test(t)) return false; // bare phone
  if (/^\d{1,2}:\d{2}$/.test(t)) return false; // clock ETA "01:25"
  if (/^\d+\s*(h(r)?|m(in)?)\b/i.test(t)) return false; // duration ETA "15 min"
  if (t.length > 150) return false; // massive blobs of motor-club dispatch notes
  return true;
}

/** Split Towbook's "Name (xxx) xxx-xxxx" contact cell into name + digits. */
export function splitContact(contact: string): { name: string; phone: string } {
  const c = (contact ?? '').trim();
  const phoneMatch = c.match(/\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/);
  const phone = phoneMatch ? phoneMatch[0].replace(/\D/g, '') : '';
  const name = phoneMatch
    ? c.slice(0, phoneMatch.index).trim().replace(/[,\s]+$/, '')
    : c;
  return { name, phone };
}

/** First configured column whose text is a plausible address; '' if none. */
function pickAddress(cells: Record<string, string>, candidateIds: string[]): string {
  for (const id of candidateIds) {
    const v = (cells[id] ?? '').trim();
    if (v && isPlausibleAddress(v)) return v;
  }
  return '';
}

const STREET_SUFFIX =
  /\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|way|ct|court|pkwy|parkway|hwy|highway|pl|place|cir|circle|ter|terrace|trl|trail|loop|sq|square|expy|expressway)\b/i;
const STATE_ZIP = /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/;

/**
 * Heuristic address score for a single cell's text. Higher = more
 * address-like. Returns 0 for anything that should never be treated as an
 * address (phones, clocks/ETAs, money, bare numbers like a job id, or a plain
 * business/motor-club name with no street or ZIP signal). Used by
 * `selectAddresses` to recover pickup/destination when the column-id mapping
 * is unreliable — Towbook's DS4 grid renumbers/hides columns per session, so
 * the header-detected `columnid` for "Tow To" does not always match the
 * `columnid` the address text actually lands under in each row.
 */
export function scoreAddress(text: string): number {
  const t = (text ?? '').trim();
  if (!isPlausibleAddress(t)) return 0; // phone / clock / duration / too short
  if (/^\d+(?:\.\d+)?$/.test(t)) return 0; // bare number (e.g. a job id)
  if (t.includes('$')) return 0; // money
  let score = 0;
  if (STATE_ZIP.test(t)) score += 3; // "... OH 43026"
  if (/\d/.test(t) && STREET_SUFFIX.test(t)) score += 2; // "123 Main St"
  if (t.includes(',') && /\b[A-Z]{2}\b/.test(t)) score += 1; // "..., OH"
  return score;
}

// A cell must reach this score to be accepted as a fallback address. Tuned so
// a real street address or a "City, ST ZIP" line qualifies, while a motor-club
// label ("Agero (Swoop) Columbus") or a company name ("Roadside Towing Inc")
// does not.
const ADDRESS_FALLBACK_THRESHOLD = 2;

/**
 * Resolve pickup + destination for a row. Configured / dynamically-detected
 * column ids are trusted first (operator intent). Whatever they don't fill is
 * recovered by scanning every non-reserved cell for the best address-shaped
 * value, ordered by column position ("Tow From" precedes "Tow To" in DS4) so
 * the earlier address becomes pickup and a later distinct one becomes the
 * destination. This is the fix for the live bug where both addresses scraped
 * fine into the row cells but `pickAddress` returned '' because the detected
 * dropoff column id didn't match the cell the address rendered under.
 */
export function selectAddresses(
  cells: Record<string, string>,
  pickupIds: string[],
  dropoffIds: string[],
): { pickup: string; destination: string } {
  let pickup = pickAddress(cells, pickupIds);
  let destination = pickAddress(cells, dropoffIds);
  if (pickup && destination) return { pickup, destination };

  const candidates = Object.entries(cells)
    .filter(([id]) => !RESERVED_COLUMN_IDS.has(id))
    .map(([id, raw]) => ({ id, text: (raw ?? '').trim(), score: scoreAddress((raw ?? '').trim()) }))
    .filter((c) => c.score >= ADDRESS_FALLBACK_THRESHOLD)
    // Column position is the pickup/destination ordering hint; numeric ids
    // sort numerically, any non-numeric id sorts last but stays deterministic.
    .sort((a, b) => (Number(a.id) || Number.MAX_SAFE_INTEGER) - (Number(b.id) || Number.MAX_SAFE_INTEGER));

  if (!pickup) pickup = candidates[0]?.text ?? '';
  if (!destination) {
    destination = candidates.find((c) => c.text !== pickup)?.text ?? '';
  }
  return { pickup, destination };
}

/**
 * Pure DOM-free mapping from a scraped row's cell map to an ActiveJob. Kept
 * outside the page.evaluate closure (which can't reference Node-scope helpers)
 * so it is unit-testable without a browser. `nowIso` is injectable for
 * deterministic tests.
 */
export function assembleActiveJob(
  row: TowbookRawRow,
  opts: { pickupColumnIds: string[]; dropoffColumnIds: string[]; nowIso?: string },
): ActiveJob {
  const cells = row.cells ?? {};
  const { name, phone } = splitContact(cells[CONTACT_COLUMN_ID] ?? '');
  const { pickup, destination } = selectAddresses(
    cells,
    opts.pickupColumnIds,
    opts.dropoffColumnIds,
  );
  return {
    jobId: row.dataId || '',
    customerName: name,
    customerPhone: phone,
    vehicle: (cells[VEHICLE_COLUMN_ID] ?? '').trim(),
    status: (cells[STATUS_COLUMN_ID] ?? '').trim(),
    driverName: (cells[DRIVER_COLUMN_ID] ?? '').trim(),
    eta: extractFallbackEta(cells, ETA_COLUMN_ID),
    pickup,
    destination,
    lastUpdated: opts.nowIso ?? new Date().toISOString(),
  };
}

/**
 * If ETA is hidden in the Towbook "Header" settings block, it loses its columnid.
 * We fallback to scanning the raw row text for common ETA patterns (dates or durations).
 */
function extractFallbackEta(cells: Record<string, string>, etaColId: string): string {
  const explicit = (cells[etaColId] ?? '').trim();
  if (explicit) return explicit;

  const raw = cells['_rawText'] ?? '';
  if (!raw) return 'Unknown';

  // 1. Look for a date with a modifier, e.g. "7/6/2026 4:03 PM (1 hr 9 mins late)"
  const dateWithMod = raw.match(/\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}\s+[AP]M\s*\([^)]+(?:late|remaining)\)/i);
  if (dateWithMod) return dateWithMod[0].trim();

  // 2. Look for multiple dates. Usually Received is first, ETA is second.
  const dates = raw.match(/\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}\s+[AP]M/g);
  if (dates && dates.length >= 2) return dates[dates.length - 1].trim();

  // 3. Look for a standalone relative duration like "45 min" or "1 hr 15 mins"
  const duration = raw.match(/\b(\d+\s*(?:hr|hrs|h)\s*\d*\s*(?:min|mins|m)?|\d+\s*(?:min|mins|m))\b/i);
  if (duration) return duration[0].trim();

  if (dates && dates.length === 1) return dates[0].trim();
  
  return 'Unknown';
}

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

    // Enumerate the first row's columnid→text map so an operator can identify
    // which column carries the pickup ("Tow From") / destination ("Tow To")
    // address — these were never captured in the originally verified column
    // set. Feed the right ids into TOWBOOK_PICKUP_COLUMN_IDS /
    // TOWBOOK_DROPOFF_COLUMN_IDS. If NO column here holds an address, the
    // addresses are not in the list view and detail-page scraping is needed.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const columns = await page.evaluate((rowSelector: string) => {
      const doc: any = (globalThis as any).document;
      const row: any = doc.querySelector(rowSelector);
      if (!row) return [] as Array<{ columnid: string; text: string }>;
      return Array.from(row.querySelectorAll('[columnid]')).map((el: any) => ({
        columnid: el.getAttribute('columnid') ?? '?',
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
      }));
    }, ROW_SELECTOR);
    /* eslint-enable @typescript-eslint/no-explicit-any */

    this.logger.log(
      `[towbook-debug]   first-row columns (${columns.length}); pickup ids=[${PICKUP_COLUMN_IDS.join(',')}] dropoff ids=[${DROPOFF_COLUMN_IDS.join(',')}]`,
    );
    for (const c of columns) {
      this.logger.log(`[towbook-debug]   columnid ${c.columnid} = "${c.text}"`);
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
    // The page.evaluate callback runs inside the Chromium page where DOM
    // globals exist; the Node tsconfig doesn't include lib.dom, so we type the
    // closure args as `any`. It does ONLY DOM scraping — it returns each row's
    // raw columnid→text map, plus any dynamically discovered column IDs.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { rawRows, dynamicPickupIds, dynamicDropoffIds } = await page.evaluate((rowSelector: string) => {
      const doc: any = (globalThis as any).document;
      
      // 1. Dynamic Header Parsing
      const pickupIds: string[] = [];
      const dropoffIds: string[] = [];
      const headerEls = Array.from(doc.querySelectorAll('.header-text[columnid]'));
      
      for (const el of headerEls as any[]) {
        const id = el.getAttribute('columnid');
        const text = (el.textContent || el.getAttribute('displayname') || '').toLowerCase();
        if (!id) continue;
        
        if (text.includes('tow source') || text.includes('pickup') || text.includes('location')) {
          pickupIds.push(id);
        } else if (text.includes('destination') || text.includes('tow to') || text.includes('dropoff')) {
          dropoffIds.push(id);
        }
      }

      // 2. Row extraction
      const rows: any[] = Array.from(doc.querySelectorAll(rowSelector));
      const extractedRows = rows.map((row: any) => {
        const cells: Record<string, string> = {};
        const cellEls: any[] = Array.from(row.querySelectorAll('[columnid]'));
        for (const el of cellEls) {
          const id = el.getAttribute('columnid');
          if (id == null) continue;
          const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
          // First non-empty wins; never clobber a populated cell with a blank.
          if (!(id in cells) || (!cells[id] && text)) cells[id] = text;
        }
        cells['_rawText'] = row.innerText || row.textContent || '';
        return { dataId: row.getAttribute('data-id') || '', cells };
      });
      
      return { rawRows: extractedRows, dynamicPickupIds: pickupIds, dynamicDropoffIds: dropoffIds };
    }, ROW_SELECTOR);
    /* eslint-enable @typescript-eslint/no-explicit-any */

    // Combine any .env overrides with dynamically found IDs
    const finalPickupIds = Array.from(new Set([...PICKUP_COLUMN_IDS, ...dynamicPickupIds]));
    const finalDropoffIds = Array.from(new Set([...DROPOFF_COLUMN_IDS, ...dynamicDropoffIds]));

    if (dynamicPickupIds.length > 0 || dynamicDropoffIds.length > 0) {
      this.logger.log(`[towbook-adapter] Dynamic Headers parsed. Pickup IDs: [${finalPickupIds.join(',')}], Dropoff IDs: [${finalDropoffIds.join(',')}]`);
    }

    return rawRows.map((r) =>
      assembleActiveJob(r, {
        pickupColumnIds: finalPickupIds,
        dropoffColumnIds: finalDropoffIds,
      }),
    );
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
