/**
 * One-off, READ-ONLY discovery script for the AAA Club Alliance contractor
 * portal (Salesforce Experience Cloud). Logs in, navigates to the Work Orders
 * list, opens the first job's detail view via plain URL navigation (never a
 * click on an action control), and dumps the DOM structure + a button/link
 * inventory so we can identify stable Accept / Decline selectors.
 *
 * SAFETY: this script NEVER clicks Accept / Decline / any mutating control.
 * It only logs in (same as the existing scrape cron), reads the DOM, and
 * navigates by href. Customer PII (names, phone numbers, member numbers) is
 * redacted from every HTML blob before it is written to disk so the committed
 * diagnostic file is safe to keep in git.
 *
 * Credentials come from env (never hardcode secrets):
 *   AAA_USERNAME / AAA_PASSWORD  (preferred)
 *   AAA_PORTAL_USERNAME / AAA_PORTAL_PASSWORD  (fallback)
 *
 * Run:  AAA_USERNAME=… AAA_PASSWORD=… pnpm exec tsx scripts/discover-aaa-selectors.ts
 * Headed browser:  HEADFUL=1 AAA_USERNAME=… AAA_PASSWORD=… pnpm exec tsx scripts/discover-aaa-selectors.ts
 */
import { chromium, type Page } from 'playwright';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const LOGIN_URL = 'https://aaacluballiance.my.site.com/ACACONTRACTORCOMMUNITY/login';
const WORK_ORDERS_URL =
  'https://aaacluballiance.my.site.com/ACACONTRACTORCOMMUNITY/s/workorder/WorkOrder/Default';
const NAV_TIMEOUT_MS = 60_000;
const DIAG_DIR = path.resolve(process.cwd(), '../../docs/diagnostics');

// Hard watchdog so the script can never hang a session (task budget: 15 min).
const watchdog = setTimeout(() => {
  // eslint-disable-next-line no-console
  console.error('[discover-aaa] WATCHDOG fired (4m) — exiting non-zero');
  process.exit(3);
}, 4 * 60_000);
watchdog.unref();

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 17);
}

async function ensureDiagDir(): Promise<void> {
  await fs.mkdir(DIAG_DIR, { recursive: true });
}

/**
 * Browser-context PII scrubber + selector candidate extractor. Everything in
 * here runs inside the page; it is stringified by Playwright, so it must be
 * self-contained and use `any` for DOM globals (the Node tsconfig has no DOM
 * lib).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function inPageDump() {
  const doc: any = (globalThis as any).document;

  const redactText = (s: string): string =>
    (s || '')
      .replace(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, '[PHONE]')
      .replace(/\b\d{6,}\b/g, '[NUM]')
      .replace(/\s+/g, ' ')
      .trim();

  // Clone a node and strip all text content / value attributes so the
  // committed HTML reveals structure + attributes but no customer data.
  const sanitizeHtml = (el: any): string => {
    if (!el) return '';
    const clone = el.cloneNode(true);
    const walk = (n: any) => {
      if (!n) return;
      if (n.nodeType === 3) {
        // text node
        n.textContent = n.textContent && n.textContent.trim() ? '·' : '';
        return;
      }
      if (n.nodeType === 1) {
        for (const attr of ['value', 'title', 'aria-label', 'placeholder']) {
          if (n.hasAttribute && n.hasAttribute(attr)) {
            const v = n.getAttribute(attr) || '';
            // keep aria-label words that look like UI labels, redact the rest
            n.setAttribute(attr, /accept|decline|reject|confirm|dispatch|cancel|submit|save|close|back|next/i.test(v) ? v : '[redacted]');
          }
        }
        const kids = Array.from(n.childNodes || []);
        kids.forEach(walk);
      }
    };
    walk(clone);
    return (clone.outerHTML || '').slice(0, 8000);
  };

  const dataAttrs = (el: any): Record<string, string> => {
    const out: Record<string, string> = {};
    const attrs = el.attributes || [];
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i];
      if (a.name.startsWith('data-')) out[a.name] = redactText(a.value);
    }
    return out;
  };

  // Build stable selector candidates for a control — prefer data-*, then
  // aria-label, then role+text. Explicitly NEVER nth-child or hashed classes.
  const candidates = (el: any): string[] => {
    const c: string[] = [];
    const tag = (el.tagName || '').toLowerCase();
    const id = el.getAttribute('id');
    if (id && !/[0-9]{4,}/.test(id) && !/:/.test(id)) c.push(`#${id}`);
    const attrs = el.attributes || [];
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i];
      if (a.name.startsWith('data-') && a.value && !/[0-9]{5,}/.test(a.value)) {
        c.push(`${tag}[${a.name}="${a.value}"]`);
      }
    }
    const aria = el.getAttribute('aria-label');
    if (aria) c.push(`${tag}[aria-label="${aria}"]`);
    const title = el.getAttribute('title');
    if (title) c.push(`${tag}[title="${title}"]`);
    const name = el.getAttribute('name');
    if (name) c.push(`${tag}[name="${name}"]`);
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (txt) c.push(`${tag}:has-text("${txt}")`);
    return Array.from(new Set(c));
  };

  const controlSel = 'button, [role="button"], a.btn, a.slds-button, input[type="button"], input[type="submit"], lightning-button, lightning-button-icon';
  const controls: any[] = Array.from(doc.querySelectorAll(controlSel));
  const inventory = controls.map((el: any) => {
    const text = redactText(el.textContent || '');
    return {
      tag: (el.tagName || '').toLowerCase(),
      text,
      id: el.getAttribute('id') || null,
      ariaLabel: el.getAttribute('aria-label') || null,
      title: el.getAttribute('title') || null,
      name: el.getAttribute('name') || null,
      className: typeof el.className === 'string' ? el.className.slice(0, 120) : null,
      dataAttrs: dataAttrs(el),
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      selectorCandidates: candidates(el),
      looksLikeAction: /accept|decline|reject|confirm|dispatch|en\s?route|cancel/i.test(
        (el.textContent || '') + ' ' + (el.getAttribute('aria-label') || ''),
      ),
    };
  });

  // First job row (list view), structure only.
  const firstRow = doc.querySelector('table[role="grid"] tbody tr');
  const rowAnchors: string[] = firstRow
    ? Array.from(firstRow.querySelectorAll('a'))
        .map((a: any) => a.getAttribute('href'))
        .filter(Boolean)
    : [];

  return {
    url: doc.location ? doc.location.href : '',
    title: doc.title,
    controlCount: controls.length,
    actionCandidates: inventory.filter((i) => i.looksLikeAction),
    allControls: inventory,
    firstRowHtml: sanitizeHtml(firstRow),
    firstRowAnchorHrefs: rowAnchors.slice(0, 5),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function main() {
  const username = process.env.AAA_USERNAME || process.env.AAA_PORTAL_USERNAME;
  const password = process.env.AAA_PASSWORD || process.env.AAA_PORTAL_PASSWORD;
  await ensureDiagDir();

  if (!username || !password) {
    const msg = 'AAA_USERNAME / AAA_PASSWORD not set in env';
    // eslint-disable-next-line no-console
    console.error(`[discover-aaa] ${msg}`);
    await fs.writeFile(
      path.join(DIAG_DIR, `aaa-selectors-${ts()}.json`),
      JSON.stringify({ ok: false, stage: 'env', error: msg }, null, 2),
    );
    process.exit(2);
  }

  const headful = process.env.HEADFUL === '1';
  const browser = await chromium.launch({
    headless: !headful,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const result: Record<string, unknown> = { ok: false, startedAt: new Date().toISOString() };

  try {
    const context = await browser.newContext();
    // tsx/esbuild injects `__name(...)` calls around named functions; that
    // helper doesn't exist inside page.evaluate. Shim it as a global (raw
    // string so it isn't itself transformed) before any evaluate runs.
    await context.addInitScript('window.__name = window.__name || ((f) => f);');
    const page: Page = await context.newPage();

    // ---- Login ----
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.fill('#username', username);
    await page.fill('#password', password);
    await page.click('#Login');

    try {
      await page.waitForURL('**/ACACONTRACTORCOMMUNITY/s/**', { timeout: NAV_TIMEOUT_MS });
    } catch (e) {
      const shot = path.join(DIAG_DIR, 'aaa-login-failure.png');
      await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
      result.stage = 'login';
      result.error = `login redirect did not complete: ${(e as Error).message}`;
      result.landedUrl = page.url();
      throw new Error(result.error as string);
    }

    // ---- Work Orders list ----
    await page.goto(WORK_ORDERS_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForSelector('table[role="grid"] tbody', { timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(3_000); // let LWC settle

    const listDump = await page.evaluate(inPageDump);
    result.listView = listDump;
    await page
      .screenshot({ path: path.join(DIAG_DIR, 'aaa-list-view.png'), fullPage: true })
      .catch(() => undefined);

    // ---- Detail view via pure navigation (NO action clicks) ----
    const href = (listDump.firstRowAnchorHrefs || [])[0];
    if (href) {
      const detailUrl = href.startsWith('http')
        ? href
        : `https://aaacluballiance.my.site.com${href.startsWith('/') ? '' : '/'}${href}`;
      try {
        await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        await page.waitForTimeout(4_000);
        result.detailView = await page.evaluate(inPageDump);
        result.detailUrlShape = detailUrl.replace(/[A-Za-z0-9]{15,18}/g, '{SF_ID}');
        await page
          .screenshot({ path: path.join(DIAG_DIR, 'aaa-detail-view.png'), fullPage: true })
          .catch(() => undefined);
      } catch (e) {
        result.detailError = (e as Error).message;
      }
    } else {
      result.detailError = 'no anchor href found in first work-order row';
    }

    // ---- Playwright-locator probe (pierces open shadow DOM, unlike the
    // document.querySelectorAll dump above). This is the authoritative check
    // for the action buttons, since Salesforce Lightning renders them inside
    // lightning-button shadow roots. READ-ONLY: we resolve + count + check
    // visibility, we never click. ----
    const probeNames = [
      'Accept',
      'Decline',
      'Reject',
      'Edit',
      'Called Member',
      'Change Final Status',
      'Dispatch',
      'En Route',
      'Follow',
    ];
    const roleProbe: Record<string, { count: number; visible: boolean; enabled: boolean }> = {};
    for (const name of probeNames) {
      try {
        const loc = page.getByRole('button', { name, exact: true });
        const count = await loc.count();
        let visible = false;
        let enabled = false;
        if (count > 0) {
          visible = await loc.first().isVisible().catch(() => false);
          enabled = await loc.first().isEnabled().catch(() => false);
        }
        roleProbe[name] = { count, visible, enabled };
      } catch (e) {
        roleProbe[name] = { count: -1, visible: false, enabled: false };
      }
    }
    result.locatorProbe = {
      note: 'getByRole("button",{name,exact}) — pierces open shadow DOM',
      results: roleProbe,
    };

    result.ok = true;
  } catch (err) {
    result.ok = result.ok || false;
    result.fatal = (err as Error).message;
    // eslint-disable-next-line no-console
    console.error('[discover-aaa] failed:', (err as Error).message);
  } finally {
    await browser.close().catch(() => undefined);
  }

  const outfile = path.join(DIAG_DIR, `aaa-selectors-${ts()}.json`);
  await fs.writeFile(outfile, JSON.stringify(result, null, 2));
  // eslint-disable-next-line no-console
  console.log(`[discover-aaa] wrote ${outfile} (ok=${result.ok})`);
  clearTimeout(watchdog);
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[discover-aaa] uncaught:', e);
  process.exit(1);
});
