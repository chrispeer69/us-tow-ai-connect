/**
 * Session 73 — HTML/text renderer for the daily call-review email.
 *
 * Written to be read on a phone before coffee: the number that matters, then
 * anything that broke, then what the analyst wants to change. Recommendations
 * are proposals — the email says so explicitly, because the whole point of the
 * workflow is that a human decides.
 */
import type { DailyAnalysis } from './call-review.types';

export interface ReviewEmailInput {
  companyName: string;
  reviewDate: string;
  metrics: {
    calls: number;
    eligible: number;
    neverPitched: number;
    offer1Accepted: number;
    offer1Declined: number;
    offer2Reached: number;
    offer2Accepted: number;
    offer3Reached: number;
    offer3Accepted: number;
    pitched: number;
    wins: number;
    winRateOfCalls: number;
    winRateOfPitched: number;
    winRateOfEligible: number;
    byScenario: Array<{ scenario: string; calls: number; eligible: number; wins: number }>;
  };
  analysis: DailyAnalysis | null;
  callsAnalyzed: number;
  /** Base admin URL so the reader can jump straight to the review queue. */
  webBaseUrl: string;
}

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function renderReviewEmailSubject(input: ReviewEmailInput): string {
  const { metrics, reviewDate } = input;
  const defects = input.analysis?.defects.length ?? 0;
  const flag = defects > 0 ? ` · ${defects} defect${defects === 1 ? '' : 's'}` : '';
  return `Call review ${reviewDate}: ${metrics.wins} win${metrics.wins === 1 ? '' : 's'} from ${metrics.calls} calls (${metrics.winRateOfCalls}%)${flag}`;
}

export function renderReviewEmailText(input: ReviewEmailInput): string {
  const { metrics, analysis, reviewDate } = input;
  const lines = [
    `CALL REVIEW — ${reviewDate}`,
    '',
    `Wins: ${metrics.wins}`,
    `  ${metrics.winRateOfCalls}% of all ${metrics.calls} calls`,
    `  ${metrics.winRateOfPitched}% of the ${metrics.pitched} calls that got a pitch`,
    `  ${metrics.winRateOfEligible}% of ${metrics.eligible} flip-eligible (see note)`,
    `Never pitched: ${metrics.neverPitched} eligible calls where offer 1 was never made`,
    ``,
    `NOTE: "flip-eligible" got stricter on 2026-08-12 — collision and glass work is`,
    `no longer eligible. Percentages of eligible are NOT comparable across that date`,
    `and will read high after it. Use wins per call or per pitched call.`,
    `Ladder: offer1 ${metrics.offer1Accepted} accepted / ${metrics.offer1Declined} declined · ` +
      `offer2 ${metrics.offer2Accepted} of ${metrics.offer2Reached} · ` +
      `offer3 ${metrics.offer3Accepted} of ${metrics.offer3Reached}`,
    '',
  ];
  if (analysis) {
    lines.push('SUMMARY', analysis.summary, '');
    if (analysis.defects.length) {
      lines.push('DEFECTS');
      for (const d of analysis.defects) {
        lines.push(`- [${d.code}] ${d.summary} (${d.affectedCallIds.length} calls)`);
      }
      lines.push('');
    }
    if (analysis.recommendations.length) {
      lines.push('PROPOSED CHANGES (nothing is live until you approve)');
      for (const r of analysis.recommendations) {
        lines.push(`- [${r.kind}/${r.confidence}] ${r.target}: ${r.title}`);
      }
      lines.push('');
    }
  } else {
    lines.push('(Transcript analysis did not run for this date.)', '');
  }
  lines.push(`Review queue: ${input.webBaseUrl}/admin/call-review`);
  return lines.join('\n');
}

export function renderReviewEmailHtml(input: ReviewEmailInput): string {
  const { metrics, analysis, reviewDate, companyName } = input;

  const kpi = (label: string, value: string, accent = false) => `
    <td style="padding:12px 16px;background:#f6f7f9;border-radius:8px;vertical-align:top">
      <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280">${esc(label)}</div>
      <div style="font-size:24px;font-weight:700;color:${accent ? '#047857' : '#111827'};margin-top:4px">${esc(value)}</div>
    </td>`;

  const scenarioRows = metrics.byScenario
    .map(
      (s) => `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eef0f3">${esc(s.scenario)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eef0f3;text-align:right">${s.calls}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eef0f3;text-align:right">${s.eligible}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eef0f3;text-align:right;font-weight:600">${s.wins}</td>
      </tr>`,
    )
    .join('');

  const defectsHtml = analysis?.defects.length
    ? `<h3 style="font-size:14px;margin:24px 0 8px">Defects — things that should work and didn't</h3>
       <ul style="margin:0;padding-left:18px;color:#374151;font-size:14px;line-height:1.6">
         ${analysis.defects
           .map(
             (d) =>
               `<li><strong>${esc(d.summary)}</strong> <span style="color:#6b7280">(${d.affectedCallIds.length} calls · ${esc(d.code)})</span><br><span style="color:#4b5563">${esc(d.evidence)}</span></li>`,
           )
           .join('')}
       </ul>`
    : '';

  const objectionsHtml = analysis?.objections.length
    ? `<h3 style="font-size:14px;margin:24px 0 8px">What customers actually said</h3>
       <ul style="margin:0;padding-left:18px;color:#374151;font-size:14px;line-height:1.6">
         ${analysis.objections
           .slice(0, 8)
           .map(
             (o) =>
               `<li><strong>${esc(o.label)}</strong> — ${o.count} ${o.count === 1 ? 'call' : 'calls'} <span style="color:#6b7280">(${esc(o.stage)})</span>${
                 o.quotes[0]
                   ? `<br><em style="color:#6b7280">“${esc(o.quotes[0].slice(0, 180))}”</em>`
                   : ''
               }</li>`,
           )
           .join('')}
       </ul>`
    : '';

  const recsHtml = analysis?.recommendations.length
    ? `<h3 style="font-size:14px;margin:24px 0 8px">Proposed changes
         <span style="font-weight:400;color:#6b7280">— nothing is live until you approve it</span>
       </h3>
       ${analysis.recommendations
         .map(
           (r) => `
         <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin-bottom:10px">
           <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">
             ${esc(r.kind)} · ${esc(r.confidence)} confidence · ${esc(r.target)}
           </div>
           <div style="font-weight:600;margin:4px 0 6px">${esc(r.title)}</div>
           <div style="font-size:14px;color:#374151;line-height:1.55">${esc(r.problem)}</div>
           ${
             r.proposedText
               ? `<div style="margin-top:8px;padding:8px 10px;background:#f0fdf4;border-left:3px solid #22c55e;font-size:14px;color:#14532d">${esc(r.proposedText)}</div>`
               : ''
           }
         </div>`,
         )
         .join('')}`
    : '<p style="color:#6b7280;font-size:14px">No changes proposed for this date.</p>';

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
  <div style="max-width:680px;margin:0 auto">
    <div style="font-size:12px;color:#6b7280;letter-spacing:.06em;text-transform:uppercase">${esc(companyName)} · outbound call review</div>
    <h1 style="font-size:20px;margin:6px 0 18px">${esc(reviewDate)}</h1>

    <table style="width:100%;border-collapse:separate;border-spacing:8px 0"><tr>
      ${kpi('Wins', String(metrics.wins), true)}
      ${kpi('Per call', `${metrics.winRateOfCalls}%`)}
      ${kpi('Per pitched', `${metrics.winRateOfPitched}%`)}
      ${kpi('Calls', String(metrics.calls))}
    </tr></table>

    ${
      analysis
        ? `<p style="font-size:15px;line-height:1.6;margin:22px 0 0">${esc(analysis.summary)}</p>`
        : '<p style="color:#6b7280;font-size:14px;margin-top:22px">Transcript analysis did not run for this date.</p>'
    }

    <p style="font-size:13px;color:#6b7280;margin:14px 0 0">
      ${metrics.eligible} flip-eligible · ${metrics.pitched} pitched · ${metrics.neverPitched} eligible calls never pitched
      · ${metrics.winRateOfEligible}% of eligible
    </p>
    <p style="font-size:12px;color:#92400e;background:#fffbeb;border-left:3px solid #f59e0b;padding:8px 10px;margin:8px 0 0;border-radius:0 4px 4px 0">
      "Flip-eligible" got stricter on 12 Aug 2026 — collision and glass work is no longer eligible.
      Percentages of eligible are not comparable across that date and read high after it.
      Compare on wins per call or per pitched call.
    </p>

    <h3 style="font-size:14px;margin:24px 0 8px">Offer ladder</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 8px;border-bottom:1px solid #eef0f3">Offer 1</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eef0f3;text-align:right">${metrics.offer1Accepted} accepted · ${metrics.offer1Declined} declined</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid #eef0f3">Offer 2</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eef0f3;text-align:right">${metrics.offer2Accepted} of ${metrics.offer2Reached} reached</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid #eef0f3">Offer 3</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eef0f3;text-align:right">${metrics.offer3Accepted} of ${metrics.offer3Reached} reached</td></tr>
    </table>

    <h3 style="font-size:14px;margin:24px 0 8px">By scenario</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.05em">
        <th style="text-align:left;padding:4px 8px">Scenario</th>
        <th style="text-align:right;padding:4px 8px">Calls</th>
        <th style="text-align:right;padding:4px 8px">Eligible</th>
        <th style="text-align:right;padding:4px 8px">Wins</th>
      </tr>
      ${scenarioRows}
    </table>

    ${defectsHtml}
    ${objectionsHtml}
    ${recsHtml}

    <p style="margin-top:26px;font-size:13px;color:#6b7280">
      Based on ${input.callsAnalyzed} transcript${input.callsAnalyzed === 1 ? '' : 's'} sampled from ${metrics.calls} calls
      (all wins, then near-misses, then calls that were never pitched).
    </p>
    <p style="font-size:13px"><a href="${esc(input.webBaseUrl)}/admin/call-review" style="color:#2563eb">Open the review queue →</a></p>
  </div></body></html>`;
}
