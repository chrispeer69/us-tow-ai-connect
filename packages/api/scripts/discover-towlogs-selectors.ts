/**
 * One-off, READ-ONLY discovery script for TowLogs (towlogs.com). Logs in,
 * navigates to the open-jobs list, opens the first row's detail view via plain
 * URL navigation (never a click on a mutating control), and dumps the DOM
 * structure + a button inventory so we can identify stable Accept / Decline
 * selectors for the adapter.
 *
 * SAFETY: this script NEVER clicks Accept / Decline / Dispatch / any mutating
 * control. It only logs in, reads the DOM, and navigates by href. Customer PII
 * is redacted from every HTML blob before it's written to disk so the
 * committed diagnostic file is safe to keep in git.
 *
 * Credentials come from env (never hardcode secrets):
 *   TOWLOGS_USERNAME / TOWLOGS_PASSWORD
 *
 * Run:  TOWLOGS_USERNAME=… TOWLOGS_PASSWORD=… pnpm exec tsx scripts/discover-towlogs-selectors.ts
 * Headed: HEADFUL=1 TOWLOGS_USERNAME=… TOWLOGS_PASSWORD=… pnpm exec tsx scripts/discover-towlogs-selectors.ts
 *
 * Exit codes:
 *   0  ok (results written)  OR  no creds in env (graceful skip)
 *   1  fatal error during discovery
 *   3  watchdog tripped
 */
import { chromium, type Page } from 'playwright';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const LOGIN_URL = 'https://app.towlogs.com/login';
const OPEN_JOBS_URL = 'https://app.towlogs.com/jobs';
const NAV_TIMEOUT_MS = 60_000;
const DIAG_DIR = path.resolve(process.cwd(), '../../docs/diagnostics');

const watchdog = setTimeout(() => {
  // eslint-disable-next-line no-console
  console.error('[discover-towlogs] WATCHDOG fired (4m) — exiting non-zero');
  process.exit(3);
}, 4 * 60_000);
watchdog.unref();

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 17);
}

async function ensureDiagDir(): Promise<void> {
  await fs.mkdir(DIAG_DIR, { recursive: true });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function inPageDump() {
  const doc: any = (globalThis as any).document;

  const redactText = (s: string): string =>
    (s || '')
      .replace(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, '[PHONE]')
      .replace(/\b\d{6,}\b/g, '[NUM]')
      .replace(/\s+/g, ' ')
      .trim();

  const sanitizeHtml = (el: any): string => {
    if (!el) return '';
    const clone = el.cloneNode(true);
    const walk = (n: any) => {
      if (!n) return;
      if (n.nodeType === 3) {
        n.textContent = n.textContent && n.textContent.trim() ? '·' : '';
        return;
      }
      if (n.nodeType === 1) {
        for (const attr of ['value', 'title', 'aria-label', 'placeholder']) {
          if (n.hasAttribute && n.hasAttribute(attr)) {
            const v = n.getAttribute(attr) || '';
            n.setAttribute(
              attr,
              /accept|decline|reject|confirm|dispatch|cancel|submit|save|close|back|next/i.test(v)
                ? v
                : '[redacted]',
            );
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

  const controlSel =
    'button, [role="button"], a.btn, input[type="button"], input[type="submit"]';
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

  const candidateRowSelectors = [
    'table tbody tr',
    '[data-job-id]',
    '[data-call-id]',
    '.job-row',
    '.job-card',
    'li.job',
    '[role="row"]',
  ];
  const rowCounts = candidateRowSelectors.map((sel) => ({
    selector: sel,
    count: doc.querySelectorAll(sel).length,
  }));
  const firstRowSelector = candidateRowSelectors.find(
    (sel) => doc.querySelectorAll(sel).length > 0,
  );
  const firstRow = firstRowSelector ? doc.querySelector(firstRowSelector) : null;
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
    allControls: inventory.slice(0, 80),
    rowCounts,
    firstRowSelector: firstRowSelector || null,
    firstRowHtml: sanitizeHtml(firstRow),
    firstRowAnchorHrefs: rowAnchors.slice(0, 5),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function main() {
  const username = process.env.TOWLOGS_USERNAME;
  const password = process.env.TOWLOGS_PASSWORD;
  await ensureDiagDir();

  if (!username || !password) {
    // eslint-disable-next-line no-console
    console.log('[discover-towlogs] no creds — TOWLOGS_USERNAME / TOWLOGS_PASSWORD not set; exiting 0');
    await fs.writeFile(
      path.join(DIAG_DIR, `towlogs-selectors-${ts()}.json`),
      JSON.stringify({ ok: false, stage: 'env', error: 'no creds' }, null, 2),
    );
    clearTimeout(watchdog);
    process.exit(0);
  }

  const headful = process.env.HEADFUL === '1';
  const browser = await chromium.launch({
    headless: !headful,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const result: Record<string, unknown> = { ok: false, startedAt: new Date().toISOString() };

  try {
    const context = await browser.newContext();
    await context.addInitScript('window.__name = window.__name || ((f) => f);');
    const page: Page = await context.newPage();

    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

    // Best-effort login fill — try common selector patterns.
    const userField = page
      .locator('input[name="email"], input[type="email"], input[name="username"], #email, #username')
      .first();
    const passField = page.locator('input[type="password"], input[name="password"], #password').first();
    await userField.fill(username, { timeout: 15_000 });
    await passField.fill(password, { timeout: 15_000 });
    const submit = page
      .getByRole('button', { name: /sign in|log ?in|login/i })
      .first();
    if ((await submit.count()) > 0) {
      await submit.click();
    } else {
      await page.locator('button[type="submit"]').first().click();
    }

    await page
      .waitForURL((url) => !url.toString().includes('/login'), { timeout: NAV_TIMEOUT_MS })
      .catch(() => undefined);
    result.landedUrl = page.url();

    // Open jobs list.
    await page
      .goto(OPEN_JOBS_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
      .catch((e) => {
        result.listError = (e as Error).message;
      });
    await page.waitForTimeout(3_000);
    result.listView = await page.evaluate(inPageDump);
    await page
      .screenshot({ path: path.join(DIAG_DIR, 'towlogs-discovery.png'), fullPage: true })
      .catch(() => undefined);

    // Detail view via the first row's first anchor href, if any.
    const listView = result.listView as { firstRowAnchorHrefs?: string[] } | undefined;
    const href = (listView?.firstRowAnchorHrefs || [])[0];
    if (href) {
      const detailUrl = href.startsWith('http')
        ? href
        : `https://app.towlogs.com${href.startsWith('/') ? '' : '/'}${href}`;
      try {
        await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        await page.waitForTimeout(3_000);
        result.detailView = await page.evaluate(inPageDump);
        result.detailUrlShape = detailUrl.replace(/[A-Za-z0-9]{10,}/g, '{ID}');
      } catch (e) {
        result.detailError = (e as Error).message;
      }
    } else {
      result.detailError = 'no anchor href found in first job row';
    }

    // Role-locator probe for action buttons (pierces open shadow DOM).
    const probeNames = ['Accept', 'Accept Job', 'Decline', 'Decline Job', 'Reject', 'Dispatch', 'Cancel'];
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
      } catch {
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
    console.error('[discover-towlogs] failed:', (err as Error).message);
  } finally {
    await browser.close().catch(() => undefined);
  }

  const outfile = path.join(DIAG_DIR, `towlogs-selectors-${ts()}.json`);
  await fs.writeFile(outfile, JSON.stringify(result, null, 2));
  // eslint-disable-next-line no-console
  console.log(`[discover-towlogs] wrote ${outfile} (ok=${result.ok})`);
  clearTimeout(watchdog);
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[discover-towlogs] uncaught:', e);
  process.exit(1);
});
