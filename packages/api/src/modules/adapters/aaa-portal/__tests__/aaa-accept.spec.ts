import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for the AAA portal accept/decline DOM actions. Playwright is
 * fully mocked — no real browser, no network. We assert (a) the adapter
 * locates the right controls (getByRole link for the job, getByRole button
 * for Accept/Decline), (b) the success / failure return shapes, and (c) a
 * screenshot is taken on failure.
 */

// Shared, test-controllable browser state. vi.hoisted so the vi.mock factory
// (which is hoisted above imports) can close over it.
const h = vi.hoisted(() => {
  return {
    page: null as any,
    launch: null as any,
  };
});

vi.mock('playwright', () => {
  const launch = vi.fn(async () => ({
    newContext: vi.fn(async () => ({
      newPage: vi.fn(async () => h.page),
    })),
    close: vi.fn(async () => undefined),
  }));
  h.launch = launch;
  return { chromium: { launch } };
});

import { AaaPortalAdapter } from '../aaa-portal.adapter';

function makeLocator(opts: {
  count?: number;
  visible?: boolean;
  enabled?: boolean;
  text?: string | null;
}) {
  const loc: any = {
    count: vi.fn(async () => opts.count ?? 0),
    isVisible: vi.fn(async () => opts.visible ?? false),
    isEnabled: vi.fn(async () => opts.enabled ?? false),
    click: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    textContent: vi.fn(async () => opts.text ?? null),
  };
  loc.first = () => loc;
  loc.last = () => loc;
  return loc;
}

/**
 * Build a fake Playwright Page. `actionButton` is the accessible name that
 * resolves as a visible+enabled button; everything else resolves to 0.
 */
function makePage(cfg: { jobLinkCount?: number; actionButton?: string | null; landedUrl?: string }) {
  const url = cfg.landedUrl ?? 'https://aaacluballiance.my.site.com/ACACONTRACTORCOMMUNITY/s/workorder/X/detail';
  const getByRole = vi.fn((role: string, o?: { name?: string }) => {
    if (role === 'link') return makeLocator({ count: cfg.jobLinkCount ?? 1 });
    if (role === 'button') {
      const match = !!cfg.actionButton && o?.name === cfg.actionButton;
      return makeLocator({ count: match ? 1 : 0, visible: match, enabled: match });
    }
    return makeLocator({ count: 0 });
  });
  const locator = vi.fn(() => makeLocator({ count: 0 }));
  return {
    goto: vi.fn(async () => undefined),
    url: vi.fn(() => url),
    waitForSelector: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => Buffer.from('')),
    getByRole,
    locator,
  } as any;
}

function makeRedis(session: string | null) {
  return {
    get: vi.fn(async () => session),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
  } as any;
}

const SESSION = JSON.stringify({ cookies: [], origins: [] });

describe('AaaPortalAdapter accept/decline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('declineJob clicks the Decline button and returns a success result', async () => {
    h.page = makePage({ actionButton: 'Decline' });
    const adapter = new AaaPortalAdapter(makeRedis(SESSION));

    const result = await adapter.declineJob('tenant-1', '14808690', 'too far out');

    expect(result.success).toBe(true);
    expect(result.confirmedAt).toBeTruthy();
    expect(result.confirmationEvidence).toBeTruthy();
    // Located the job row by its work-order number, and the Decline button.
    expect(h.page.getByRole).toHaveBeenCalledWith('link', expect.objectContaining({ name: '14808690' }));
    expect(h.page.getByRole).toHaveBeenCalledWith('button', expect.objectContaining({ name: 'Decline', exact: true }));
  });

  it('acceptJob clicks the Accept button and returns a success result', async () => {
    h.page = makePage({ actionButton: 'Accept' });
    const adapter = new AaaPortalAdapter(makeRedis(SESSION));

    const result = await adapter.acceptJob('tenant-1', '14808690');

    expect(result.success).toBe(true);
    expect(result.confirmedAt).toBeTruthy();
    expect(h.page.getByRole).toHaveBeenCalledWith('button', expect.objectContaining({ name: 'Accept', exact: true }));
  });

  it('returns a failure result (no throw) + screenshot when the action button is absent', async () => {
    h.page = makePage({ actionButton: null }); // no button resolves
    const adapter = new AaaPortalAdapter(makeRedis(SESSION));

    const result = await adapter.acceptJob('tenant-1', '14808690');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/accept button not found/i);
    expect(h.page.screenshot).toHaveBeenCalledTimes(1);
  });

  it('returns a failure result + screenshot when the job row is not found', async () => {
    h.page = makePage({ jobLinkCount: 0, actionButton: 'Decline' });
    const adapter = new AaaPortalAdapter(makeRedis(SESSION));

    const result = await adapter.declineJob('tenant-1', 'NOPE', 'reason');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found in work orders/i);
    expect(h.page.screenshot).toHaveBeenCalledTimes(1);
  });

  it('returns a failure result without launching a browser when there is no session', async () => {
    h.page = makePage({ actionButton: 'Decline' });
    const adapter = new AaaPortalAdapter(makeRedis(null));

    const result = await adapter.declineJob('tenant-1', '14808690', 'reason');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no aaa session/i);
    expect(h.launch).not.toHaveBeenCalled();
  });
});
