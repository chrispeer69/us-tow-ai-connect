import { describe, expect, it } from 'vitest';
import { renderDigestHtml, renderSparkline } from './digest-renderer';
import type { DigestMetrics } from './digest-metrics.service';

const FIXTURE: DigestMetrics = {
  range: 'daily',
  windowStart: new Date('2026-05-22T08:00:00Z'),
  windowEnd: new Date('2026-05-23T08:00:00Z'),
  callsHandled: { count: 42, totalMinutes: 81, avgDurationSec: 116 },
  jobsCreated: {
    total: 24,
    bySource: { towbook: 14, aaa_salesforce: 9, ai_dispatch: 1 },
  },
  jobsCompleted: 18,
  conversionRate: 24 / 42,
  topDeclineReasons: [
    { reason: 'Estimated payout too low', count: 3 },
    { reason: 'Outside service area', count: 2 },
  ],
  driverActivity: { activeDrivers: 6, totalMilesEstimated: 412, avgJobsPerDriver: 3 },
  topCallers: [
    { phone: '+15551234567', count: 4 },
    { phone: '+15557654321', count: 3 },
  ],
  failures: { failedSmsSends: 2, rateLimitHits: 18 },
};

describe('renderSparkline', () => {
  it('produces a 12-cell bar proportional to value/max', () => {
    expect(renderSparkline(0, 10)).toBe('░░░░░░░░░░░░');
    expect(renderSparkline(10, 10)).toBe('████████████');
    expect(renderSparkline(5, 10)).toMatch(/^█{6}░{6}$/);
  });

  it('returns empty when max is zero', () => {
    expect(renderSparkline(0, 0)).toBe('');
  });
});

describe('renderDigestHtml', () => {
  it('renders all metric sections', () => {
    const html = renderDigestHtml({
      tenantName: 'Roadside Towing',
      metrics: FIXTURE,
      webBaseUrl: 'https://app.ustow-aiconnect.com',
    });
    expect(html).toContain('Roadside Towing');
    expect(html).toContain('Daily digest');
    expect(html).toContain('Calls handled by AI');
    expect(html).toContain('42'); // calls
    expect(html).toContain('Total: <strong style="color:#111827;">24</strong>'); // jobs total
    expect(html).toContain('towbook');
    expect(html).toContain('Estimated payout too low');
    expect(html).toContain('Outside service area');
    expect(html).toContain('57.1%'); // conversion (24/42)
    expect(html).toContain('Active drivers');
    expect(html).toContain('•••••••4567'); // masked phone
  });

  it('escapes hostile values to prevent HTML injection', () => {
    const html = renderDigestHtml({
      tenantName: 'Evil <script>alert(1)</script>',
      metrics: FIXTURE,
      webBaseUrl: 'https://example.com',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('renders empty-window fixtures without crashing', () => {
    const empty: DigestMetrics = {
      ...FIXTURE,
      callsHandled: { count: 0, totalMinutes: 0, avgDurationSec: 0 },
      jobsCreated: { total: 0, bySource: {} },
      jobsCompleted: 0,
      conversionRate: 0,
      topDeclineReasons: [],
      driverActivity: { activeDrivers: 0, totalMilesEstimated: 0, avgJobsPerDriver: 0 },
      topCallers: [],
      failures: { failedSmsSends: 0, rateLimitHits: 0 },
    };
    const html = renderDigestHtml({
      tenantName: 'Empty Shop',
      metrics: empty,
      webBaseUrl: 'https://x.example',
    });
    expect(html).toContain('Empty Shop');
    expect(html).toContain('No jobs in this window.');
    expect(html).toContain('No declined dispatches.');
    expect(html).toContain('No repeat callers.');
  });
});
