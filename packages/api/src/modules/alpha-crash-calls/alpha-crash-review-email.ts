import type { AlphaFunnelMetrics } from './alpha-crash-funnel';
import type { AlphaDailyAnalysis } from './alpha-crash-review.types';

export interface AlphaReviewEmailInput {
  reviewDate: string;
  metrics: AlphaFunnelMetrics;
  analysis: AlphaDailyAnalysis | null;
  /** Consecutive days (including this one) the feed has produced zero calls. */
  silentStreakDays: number;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderAlphaReviewEmailSubject(input: AlphaReviewEmailInput): string {
  if (input.metrics.calls === 0) {
    return input.silentStreakDays > 1
      ? `Crash lead line: still silent — day ${input.silentStreakDays}`
      : `Crash lead line: zero calls yesterday`;
  }
  return `Crash lead review ${input.reviewDate} — ${input.metrics.calls} calls, ${input.metrics.positiveInterest} showed interest`;
}

export function renderAlphaReviewEmailText(input: AlphaReviewEmailInput): string {
  const { metrics, analysis, reviewDate, silentStreakDays } = input;
  const lines: string[] = [];
  lines.push(`Alpha Automotive — crash lead line, ${reviewDate}`);
  lines.push('');

  if (metrics.calls === 0) {
    lines.push(
      `ZERO calls placed in the last 24 hours (day ${silentStreakDays} of the feed being silent, if this has run before).`,
    );
    lines.push(
      'This system only dials when GoHighLevel sends it a lead — check the GHL workflow before assuming anything is broken here.',
    );
    return lines.join('\n');
  }

  lines.push(
    `${metrics.calls} calls · ${metrics.connected} connected · ${metrics.voicemail} voicemail · ${metrics.substantive} real conversations · ${metrics.positiveInterest} showed interest`,
  );
  if (metrics.noData > 0) {
    lines.push(`${metrics.noData} calls saved no data at all (stub rows — same pattern seen before).`);
  }
  lines.push('');

  if (analysis) {
    lines.push(analysis.summary);
    lines.push('');
    if (analysis.defects.length) {
      lines.push('DEFECTS:');
      for (const d of analysis.defects) {
        lines.push(`- ${d.summary} (${d.affectedCallIds.length} call(s))`);
      }
      lines.push('');
    }
    if (analysis.recommendations.length) {
      lines.push('RECOMMENDATIONS:');
      for (const r of analysis.recommendations) {
        lines.push(`- [${r.kind}/${r.confidence}] ${r.title}`);
      }
    }
  } else {
    lines.push('Transcript analysis unavailable for this run — funnel numbers only.');
  }

  return lines.join('\n');
}

export function renderAlphaReviewEmailHtml(input: AlphaReviewEmailInput): string {
  const { metrics, analysis, reviewDate, silentStreakDays } = input;

  if (metrics.calls === 0) {
    return `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#241b12;">
  <div style="background:#f7dcdb;border:1px solid #c8393e;border-radius:8px;padding:16px 18px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#c8393e;">Zero calls, day ${silentStreakDays}</div>
    <h2 style="margin:8px 0 6px;font-size:20px;">The crash lead line placed no calls in the last 24 hours</h2>
    <p style="margin:0;font-size:14px;line-height:1.5;">This caller only dials when GoHighLevel sends it a lead — it never decides on its own to call. If this keeps recurring, the break is almost certainly the GHL workflow (paused, expired credential, or the crash-report feed itself), not this system.</p>
  </div>
  <p style="font-size:12px;color:#7c6b57;margin-top:18px;">Alpha Automotive crash lead review · ${esc(reviewDate)}</p>
</div>`.trim();
  }

  const outcomeRows = metrics.byOutcome
    .map(
      (o) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #e2d5c0;">${esc(o.outcome)}</td><td style="padding:6px 10px;border-bottom:1px solid #e2d5c0;text-align:right;font-variant-numeric:tabular-nums;">${o.count}</td></tr>`,
    )
    .join('');

  const defectRows = (analysis?.defects ?? [])
    .map(
      (d) => `
    <div style="border-left:3px solid #a97a1e;background:#f2e4c4;border-radius:0 6px 6px 0;padding:10px 12px;margin-bottom:8px;">
      <div style="font-weight:700;font-size:13.5px;">${esc(d.summary)}</div>
      <div style="font-size:12.5px;color:#5a4d3d;margin-top:3px;">${esc(d.evidence)}</div>
    </div>`,
    )
    .join('');

  const recRows = (analysis?.recommendations ?? [])
    .map(
      (r) => `
    <div style="padding:8px 0;border-bottom:1px solid #e2d5c0;">
      <div style="font-weight:700;font-size:13.5px;">${esc(r.title)} <span style="font-size:10px;color:#a97a1e;text-transform:uppercase;">${esc(r.kind)}/${esc(r.confidence)}</span></div>
      <div style="font-size:12.5px;color:#5a4d3d;margin-top:2px;">${esc(r.problem)}</div>
    </div>`,
    )
    .join('');

  return `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#241b12;">
  <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#c06a1f;">Alpha Automotive &middot; Crash Lead Line</div>
  <h1 style="font-size:22px;margin:6px 0 14px;">Review — ${esc(reviewDate)}</h1>

  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;">
    <div style="background:#fffaf2;border:1px solid #e2d5c0;border-radius:8px;padding:10px 14px;min-width:90px;">
      <div style="font-size:24px;font-weight:800;">${metrics.calls}</div>
      <div style="font-size:11px;color:#7c6b57;">calls placed</div>
    </div>
    <div style="background:#fffaf2;border:1px solid #e2d5c0;border-radius:8px;padding:10px 14px;min-width:90px;">
      <div style="font-size:24px;font-weight:800;">${metrics.substantive}</div>
      <div style="font-size:11px;color:#7c6b57;">real conversations</div>
    </div>
    <div style="background:#dcebe0;border:1px solid #3f7d55;border-radius:8px;padding:10px 14px;min-width:90px;">
      <div style="font-size:24px;font-weight:800;color:#3f7d55;">${metrics.positiveInterest}</div>
      <div style="font-size:11px;color:#3f7d55;">showed interest</div>
    </div>
  </div>

  ${
    metrics.noData > 0
      ? `<p style="font-size:12.5px;color:#a97a1e;background:#f2e4c4;border-radius:6px;padding:8px 12px;">${metrics.noData} calls saved no data at all — same stub-row pattern seen before. Recoverable via the existing backfill endpoint.</p>`
      : ''
  }

  ${analysis ? `<p style="font-size:14px;line-height:1.55;">${esc(analysis.summary)}</p>` : ''}

  <h3 style="font-size:15px;margin:20px 0 8px;border-bottom:2px solid #e2d5c0;padding-bottom:6px;">Outcomes</h3>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">${outcomeRows}</table>

  ${defectRows ? `<h3 style="font-size:15px;margin:20px 0 8px;border-bottom:2px solid #e2d5c0;padding-bottom:6px;">Defects</h3>${defectRows}` : ''}
  ${recRows ? `<h3 style="font-size:15px;margin:20px 0 8px;border-bottom:2px solid #e2d5c0;padding-bottom:6px;">Recommendations</h3>${recRows}` : ''}

  <p style="font-size:11px;color:#a99680;margin-top:24px;">Automated daily review, previous 24 hours. Full transcripts sampled: substantive-outcome calls first.</p>
</div>`.trim();
}
