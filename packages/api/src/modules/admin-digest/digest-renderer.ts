import type { DigestMetrics } from './digest-metrics.service';

interface RenderContext {
  tenantName: string;
  metrics: DigestMetrics;
  webBaseUrl: string;
}

/**
 * Renders the daily / weekly digest into mobile-friendly HTML. No external
 * assets — images, CSS, web fonts are all inline. Renders fast in every
 * client; sparkline-style ASCII bars are used so Gmail's text-only preview
 * remains readable.
 */
export function renderDigestHtml(ctx: RenderContext): string {
  const { tenantName, metrics, webBaseUrl } = ctx;
  const rangeLabel = metrics.range === 'weekly' ? 'Weekly' : 'Daily';
  const windowLabel = `${formatDate(metrics.windowStart)} → ${formatDate(metrics.windowEnd)}`;
  const conversionPct = (metrics.conversionRate * 100).toFixed(1);

  const jobsBySourceRows =
    Object.entries(metrics.jobsCreated.bySource)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([src, count]) =>
          `<tr><td style="padding:4px 8px;">${escapeHtml(src)}</td><td style="padding:4px 8px;text-align:right;font-variant-numeric:tabular-nums;">${count.toLocaleString()}</td><td style="padding:4px 8px;font-family:monospace;color:#6b7280;">${bar(count, metrics.jobsCreated.total)}</td></tr>`,
      )
      .join('') || `<tr><td colspan="3" style="padding:8px;color:#9ca3af;">No jobs in this window.</td></tr>`;

  const declineRows =
    metrics.topDeclineReasons
      .map(
        (r) =>
          `<tr><td style="padding:4px 8px;">${escapeHtml(r.reason)}</td><td style="padding:4px 8px;text-align:right;font-variant-numeric:tabular-nums;">${r.count.toLocaleString()}</td></tr>`,
      )
      .join('') || `<tr><td colspan="2" style="padding:8px;color:#9ca3af;">No declined dispatches.</td></tr>`;

  const callerRows =
    metrics.topCallers
      .map(
        (r) =>
          `<tr><td style="padding:4px 8px;font-family:monospace;">${escapeHtml(maskPhone(r.phone))}</td><td style="padding:4px 8px;text-align:right;font-variant-numeric:tabular-nums;">${r.count.toLocaleString()}</td></tr>`,
      )
      .join('') || `<tr><td colspan="2" style="padding:8px;color:#9ca3af;">No repeat callers.</td></tr>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${rangeLabel} digest — ${escapeHtml(tenantName)}</title></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f9fafb;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="background:#1e3a8a;color:#fff;padding:20px 24px;">
          <h1 style="margin:0;font-size:20px;font-weight:600;">US Tow AI-Connect</h1>
          <p style="margin:4px 0 0;font-size:13px;opacity:.8;">${rangeLabel} digest — ${escapeHtml(tenantName)}</p>
          <p style="margin:4px 0 0;font-size:12px;opacity:.7;">${windowLabel}</p>
        </td></tr>

        <tr><td style="padding:24px;">
          <h2 style="margin:0 0 12px;font-size:16px;font-weight:600;">Call activity</h2>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:14px;">
            <tr>
              <td style="padding:8px 0;width:40%;color:#6b7280;">Calls handled by AI</td>
              <td style="padding:8px 0;font-variant-numeric:tabular-nums;font-weight:600;">${metrics.callsHandled.count.toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;">Inbound AI calls</td>
              <td style="padding:8px 0;font-variant-numeric:tabular-nums;">${metrics.callsHandled.byType.inbound.toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;">Outbound AI calls</td>
              <td style="padding:8px 0;font-variant-numeric:tabular-nums;">${metrics.callsHandled.byType.outbound.toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;">Total minutes</td>
              <td style="padding:8px 0;font-variant-numeric:tabular-nums;">${metrics.callsHandled.totalMinutes.toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;">Avg duration</td>
              <td style="padding:8px 0;font-variant-numeric:tabular-nums;">${metrics.callsHandled.avgDurationSec}s</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;">Conversion to dispatch</td>
              <td style="padding:8px 0;font-variant-numeric:tabular-nums;font-weight:600;">${conversionPct}%</td>
            </tr>
          </table>

          <h2 style="margin:24px 0 12px;font-size:16px;font-weight:600;">Jobs created</h2>
          <p style="margin:0 0 8px;font-size:14px;color:#6b7280;">Total: <strong style="color:#111827;">${metrics.jobsCreated.total.toLocaleString()}</strong> — completed: <strong style="color:#111827;">${metrics.jobsCompleted.toLocaleString()}</strong></p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
            <thead><tr style="background:#f3f4f6;color:#374151;font-weight:600;"><td style="padding:6px 8px;">Source</td><td style="padding:6px 8px;text-align:right;">Count</td><td style="padding:6px 8px;">Share</td></tr></thead>
            <tbody>${jobsBySourceRows}</tbody>
          </table>

          <h2 style="margin:24px 0 12px;font-size:16px;font-weight:600;">Top decline reasons</h2>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
            <thead><tr style="background:#f3f4f6;color:#374151;font-weight:600;"><td style="padding:6px 8px;">Reason</td><td style="padding:6px 8px;text-align:right;">Count</td></tr></thead>
            <tbody>${declineRows}</tbody>
          </table>

          <h2 style="margin:24px 0 12px;font-size:16px;font-weight:600;">Driver activity</h2>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:6px 0;width:55%;color:#6b7280;">Active drivers</td><td style="padding:6px 0;font-variant-numeric:tabular-nums;font-weight:600;">${metrics.driverActivity.activeDrivers}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Total miles (estimated)</td><td style="padding:6px 0;font-variant-numeric:tabular-nums;">${metrics.driverActivity.totalMilesEstimated.toLocaleString()}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Avg jobs per driver</td><td style="padding:6px 0;font-variant-numeric:tabular-nums;">${metrics.driverActivity.avgJobsPerDriver}</td></tr>
          </table>

          <h2 style="margin:24px 0 12px;font-size:16px;font-weight:600;">Top callers</h2>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
            <thead><tr style="background:#f3f4f6;color:#374151;font-weight:600;"><td style="padding:6px 8px;">Phone</td><td style="padding:6px 8px;text-align:right;">Calls</td></tr></thead>
            <tbody>${callerRows}</tbody>
          </table>

          <h2 style="margin:24px 0 12px;font-size:16px;font-weight:600;">Reliability signals</h2>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:6px 0;width:55%;color:#6b7280;">Failed SMS sends</td><td style="padding:6px 0;font-variant-numeric:tabular-nums;${metrics.failures.failedSmsSends > 0 ? 'color:#b91c1c;font-weight:600;' : ''}">${metrics.failures.failedSmsSends.toLocaleString()}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Rate-limit hits</td><td style="padding:6px 0;font-variant-numeric:tabular-nums;${metrics.failures.rateLimitHits > 0 ? 'color:#b45309;font-weight:600;' : ''}">${metrics.failures.rateLimitHits.toLocaleString()}</td></tr>
          </table>

          <p style="margin:32px 0 0;font-size:12px;color:#9ca3af;line-height:1.5;">
            Want to change recipients or frequency? Manage at
            <a href="${escapeAttr(webBaseUrl)}/admin/digest" style="color:#1e40af;text-decoration:none;">${escapeHtml(webBaseUrl)}/admin/digest</a>.
            Generated ${new Date().toISOString()}.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function renderSparkline(value: number, max: number): string {
  return bar(value, max);
}

function bar(value: number, max: number): string {
  if (max <= 0) return '';
  const width = 12;
  const filled = Math.round((value / max) * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function maskPhone(p: string): string {
  // Keep the last 4 so admins can recognize repeat callers without
  // sending full PII into an email.
  if (p.length < 6) return p;
  return p.slice(0, p.length - 4).replace(/\d/g, '•') + p.slice(-4);
}
