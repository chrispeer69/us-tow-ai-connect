import type { ClassifiedInboundCall, InboundFunnelMetrics } from './inbound-review-funnel';
import type { InboundDailyAnalysis } from './inbound-review.types';

export interface InboundReviewEmailInput {
  reviewDate: string;
  metrics: InboundFunnelMetrics;
  analysis: InboundDailyAnalysis | null;
  calls: ClassifiedInboundCall[];
  /** Agent version(s) that answered that day, for the footer. */
  agentVersions: string[];
}

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const OUTCOME_LABEL: Record<string, string> = {
  answered_from_board: 'answered from the board',
  message_taken: 'message taken',
  job_created: 'new tow booked',
  transferred: 'transferred',
  not_found_ended: 'not found, ended',
  no_conversation: 'no conversation',
  ended_other: 'ended',
};

export function renderInboundReviewEmailSubject(input: InboundReviewEmailInput): string {
  const m = input.metrics;
  if (m.calls === 0) return `Inbound Emily ${input.reviewDate}: no calls`;
  return `Inbound Emily ${input.reviewDate} — ${m.calls} calls, ${m.found} found, ${m.transferred} transferred`;
}

export function renderInboundReviewEmailText(input: InboundReviewEmailInput): string {
  const { metrics: m, analysis, reviewDate } = input;
  const lines: string[] = [];
  lines.push(`Emily INBOUND (844-701-1345) — ${reviewDate}`);
  lines.push('');
  if (m.calls === 0) {
    lines.push('No inbound calls in the last 24 hours.');
    return lines.join('\n');
  }
  lines.push(
    `${m.calls} calls · ${m.conversations} conversations · ${m.lookups} lookups · ${m.found} found (${m.foundByCallerId} by caller ID) · ${m.notFound} not found · ${m.transferred} transferred · ${m.messagesTaken} messages · ${m.jobsCreated} new tows · median ${m.medianDurationSec}s`,
  );
  lines.push('');
  if (analysis) {
    lines.push(analysis.summary, '');
    if (analysis.successes.length) {
      lines.push('SUCCESSES');
      for (const s of analysis.successes) lines.push(`- ${s.label} (${s.count})`);
      lines.push('');
    }
    if (analysis.failures.length) {
      lines.push('FAILURES');
      for (const f of analysis.failures) lines.push(`- [${f.severity}] ${f.summary} (${f.affectedCallIds.length} call(s))`);
      lines.push('');
    }
    if (analysis.recommendations.length) {
      lines.push('RECOMMENDATIONS');
      for (const r of analysis.recommendations) lines.push(`- [${r.kind}/${r.confidence}] ${r.title}: ${r.problem}`);
      lines.push('');
    }
  } else {
    lines.push('Transcript analysis unavailable for this run — numbers only.', '');
  }
  lines.push('CALLS');
  for (const c of input.calls) {
    lines.push(`- ${c.when} ${c.from} ${c.durationSec}s — ${OUTCOME_LABEL[c.outcome] ?? c.outcome}${c.recordingUrl ? ` — ${c.recordingUrl}` : ''}`);
  }
  return lines.join('\n');
}

export function renderInboundReviewEmailHtml(input: InboundReviewEmailInput): string {
  const { metrics: m, analysis, reviewDate, calls } = input;
  const wrap = (body: string) =>
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px;color:#18212b;line-height:1.5;">${body}</div>`;

  if (m.calls === 0) {
    return wrap(`
  <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7a8694;">Emily INBOUND · 844-701-1345 · ${esc(reviewDate)}</div>
  <h2 style="margin:8px 0 6px;font-size:20px;">No inbound calls in the last 24 hours</h2>
  <p style="margin:0;font-size:14px;color:#4a5664;">Nothing to review. If that is unexpected, check that 844-701-1345 is still bound to the inbound agent in Retell.</p>`);
  }

  const stat = (k: string, v: string | number) =>
    `<td style="padding:10px 12px;border:1px solid #d8dee5;vertical-align:top;"><div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7a8694;">${esc(k)}</div><div style="font-size:22px;font-weight:700;">${esc(String(v))}</div></td>`;
  const stats = `<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:14px 0 6px;"><tr>${stat('Calls', m.calls)}${stat('Lookups', m.lookups)}${stat('Found', m.found)}${stat('Not found', m.notFound)}${stat('Transferred', m.transferred)}${stat('Messages', m.messagesTaken)}${stat('New tows', m.jobsCreated)}</tr></table>
  <p style="margin:0 0 18px;font-size:13px;color:#4a5664;">${m.conversations} real conversations · ${m.foundByCallerId} found by caller ID · transfers: ${m.transferredAfterFound} after a found job, ${m.transferredAfterNotFound} after not found, ${m.transferredNoLookup} with no lookup · median call ${m.medianDurationSec}s</p>`;

  const quoteList = (qs: Array<{ callId: string; quote: string }>) =>
    qs.length
      ? `<ul style="margin:6px 0 0;padding-left:18px;font-size:13px;color:#4a5664;">${qs
          .slice(0, 3)
          .map((q) => `<li>“${esc(q.quote)}” <span style="color:#7a8694;">(${esc(q.callId.slice(5, 13))})</span></li>`)
          .join('')}</ul>`
      : '';

  let body = '';
  if (analysis) {
    body += `<p style="font-size:15px;margin:0 0 18px;">${esc(analysis.summary)}</p>`;
    body += `<h3 style="font-size:15px;margin:18px 0 8px;color:#1f6b3a;">Successes</h3>`;
    body += analysis.successes.length
      ? analysis.successes
          .map((s) => `<div style="margin:0 0 10px;padding:10px 12px;background:#e3f2e8;border-left:4px solid #1f6b3a;"><strong>${esc(s.label)}</strong> <span style="color:#4a5664;">× ${s.count}</span>${quoteList(s.quotes)}</div>`)
          .join('')
      : `<p style="font-size:13px;color:#7a8694;">None called out.</p>`;
    body += `<h3 style="font-size:15px;margin:18px 0 8px;color:#b42318;">Failures</h3>`;
    body += analysis.failures.length
      ? analysis.failures
          .map(
            (f) => `<div style="margin:0 0 10px;padding:10px 12px;background:#fbe9e7;border-left:4px solid #b42318;"><strong>${esc(f.summary)}</strong> <span style="font-size:11px;font-weight:700;letter-spacing:.05em;color:#b42318;">${esc(f.severity)}</span> <span style="color:#4a5664;">· ${f.affectedCallIds.length} call(s)</span><div style="font-size:13px;color:#4a5664;margin-top:4px;">${esc(f.evidence)}</div></div>`,
          )
          .join('')
      : `<p style="font-size:13px;color:#7a8694;">No failures found in the sampled calls.</p>`;
    body += `<h3 style="font-size:15px;margin:18px 0 8px;color:#0b4b51;">Recommendations</h3>`;
    body += analysis.recommendations.length
      ? analysis.recommendations
          .map(
            (r) => `<div style="margin:0 0 10px;padding:10px 12px;background:#e3f0f0;border-left:4px solid #0d5c63;"><div style="font-size:11px;font-weight:700;letter-spacing:.05em;color:#0b4b51;">${esc(r.kind)} · ${esc(r.confidence)} confidence · ${esc(r.target)}</div><strong>${esc(r.title)}</strong><div style="font-size:13px;margin-top:4px;">${esc(r.problem)}</div>${r.proposedText ? `<div style="font-size:13px;margin-top:6px;padding:8px 10px;background:#fff;border:1px solid #d8dee5;">${esc(r.proposedText)}</div>` : ''}<div style="font-size:12px;color:#4a5664;margin-top:6px;">${esc(r.rationale)}</div>${quoteList(r.evidence)}</div>`,
          )
          .join('')
      : `<p style="font-size:13px;color:#7a8694;">Nothing to change today.</p>`;
  } else {
    body += `<p style="font-size:14px;color:#4a5664;">Transcript analysis unavailable for this run — numbers only.</p>`;
  }

  const rows = calls
    .map(
      (c) => `<tr>
  <td style="padding:6px 8px;border-bottom:1px solid #e8ecf0;white-space:nowrap;">${esc(c.when)}</td>
  <td style="padding:6px 8px;border-bottom:1px solid #e8ecf0;font-family:Menlo,Consolas,monospace;font-size:12px;">${esc(c.from)}</td>
  <td style="padding:6px 8px;border-bottom:1px solid #e8ecf0;text-align:right;">${c.durationSec}s</td>
  <td style="padding:6px 8px;border-bottom:1px solid #e8ecf0;">${esc(OUTCOME_LABEL[c.outcome] ?? c.outcome)}${c.matchedBy === 'caller_id' ? ' <span style="color:#7a8694;">(caller ID)</span>' : ''}</td>
  <td style="padding:6px 8px;border-bottom:1px solid #e8ecf0;">${c.recordingUrl ? `<a href="${esc(c.recordingUrl)}" style="color:#0b4b51;">listen</a>` : ''}</td>
</tr>`,
    )
    .join('');
  const callTable = `<h3 style="font-size:15px;margin:22px 0 8px;">Every call</h3>
<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;font-size:13px;">${rows}</table>`;

  const foot = `<p style="margin-top:20px;font-size:12px;color:#7a8694;">Agent version(s): ${esc(input.agentVersions.join(', ') || 'unknown')}. Recording links are Retell's and may expire. Sent automatically at 6 AM ET.</p>`;

  return wrap(`
  <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7a8694;">Emily INBOUND · 844-701-1345 · ${esc(reviewDate)}</div>
  <h2 style="margin:8px 0 0;font-size:20px;">Inbound line, daily review</h2>
  ${stats}${body}${callTable}${foot}`);
}
