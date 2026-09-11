import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ClaudeClient } from '../call-review/claude.client';
import { SendGridEmailService } from '../admin-digest/sendgrid-email.service';
import {
  classifyInboundCall,
  computeInboundFunnel,
  etDayBounds,
  sampleForReview,
  type ClassifiedInboundCall,
  type InboundFunnelMetrics,
  type RetellInboundCall,
} from './inbound-review-funnel';
import { INBOUND_ANALYSIS_SCHEMA, type InboundDailyAnalysis } from './inbound-review.types';
import {
  renderInboundReviewEmailHtml,
  renderInboundReviewEmailSubject,
  renderInboundReviewEmailText,
} from './inbound-review-email';

const RETELL_API = 'https://api.retellai.com';
/** Emily INBOUND | Roadside Towing callbacks — answers +1 844-701-1345. */
const INBOUND_AGENT_ID = process.env.RETELL_INBOUND_AGENT_ID?.trim() || 'agent_d070aed59fd269162e2268a386';
const ROADSIDE_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const MAX_TRANSCRIPTS = 40;

/**
 * Daily 6 AM ET performance review of Emily INBOUND.
 *
 * Chris, 2026-09-10: "email me a full performance review of the inbound
 * caller at 6 AM every day with successes, failures and recommendations for
 * improvements."
 *
 * Reads the day's calls straight from Retell rather than inbound_call_logs:
 * the Retell record carries `transcript_with_tool_calls`, which is the only
 * place you can see what the agent actually did — which lookup it ran, with
 * what number, and what came back. That is the difference between "she said
 * she was looking it up" and "she looked it up". Same shape as
 * alpha-crash-review.service.ts: numbers first, Claude reads a stratified
 * sample, one email, nothing persisted.
 */
@Injectable()
export class InboundReviewService {
  private readonly logger = new Logger(InboundReviewService.name);

  constructor(
    private readonly claude: ClaudeClient,
    private readonly email: SendGridEmailService,
  ) {}

  @Cron('0 0 6 * * *', { name: 'inbound-review-daily', timeZone: 'America/New_York' })
  async dailyCron(): Promise<void> {
    if (process.env.INBOUND_REVIEW_ENABLED === 'false') return;
    const reviewDate = this.yesterdayEt();
    try {
      await this.runReview(reviewDate);
    } catch (err) {
      this.logger.error(`[inbound-review] date=${reviewDate} failed: ${(err as Error).message}`, (err as Error).stack);
    }
  }

  /** Yesterday's calendar date in New York, as YYYY-MM-DD. */
  yesterdayEt(): string {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    const d = new Date(Date.parse(`${today}T12:00:00Z`) - 24 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }

  /** Public so the admin endpoint can run any past day on demand. */
  async runReview(reviewDate: string): Promise<{ calls: number; emailed: number; analysed: boolean }> {
    const apiKey = process.env.RETELL_API_KEY?.trim();
    if (!apiKey) {
      this.logger.warn('[inbound-review] RETELL_API_KEY unset — skipping');
      return { calls: 0, emailed: 0, analysed: false };
    }

    const { start, end } = etDayBounds(reviewDate);
    const raw = await this.fetchCalls(apiKey, start, end);
    const calls = raw.map(classifyInboundCall).sort((a, b) => a.startTimestamp - b.startTimestamp);
    const metrics = computeInboundFunnel(calls);

    let analysis: InboundDailyAnalysis | null = null;
    if (calls.length > 0 && this.claude.isConfigured()) {
      const sample = sampleForReview(calls, MAX_TRANSCRIPTS);
      const result = await this.claude.analyze<InboundDailyAnalysis>(
        this.systemPrompt(),
        this.userPrompt(reviewDate, metrics, sample),
        INBOUND_ANALYSIS_SCHEMA as unknown as Record<string, unknown>,
      );
      analysis = result?.analysis ?? null;
    }

    const emailed = await this.sendEmail({ reviewDate, metrics, analysis, calls });
    this.logger.log(
      `[inbound-review] date=${reviewDate} calls=${metrics.calls} found=${metrics.found} transferred=${metrics.transferred} analysed=${analysis != null} emailed=${emailed}`,
    );
    return { calls: metrics.calls, emailed, analysed: analysis != null };
  }

  // ─── Retell ───────────────────────────────────────────────────────────────

  private async fetchCalls(apiKey: string, start: number, end: number): Promise<RetellInboundCall[]> {
    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    const summaries: RetellInboundCall[] = [];
    let paginationKey: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await fetch(`${RETELL_API}/v2/list-calls`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filter_criteria: { agent_id: [INBOUND_AGENT_ID], start_timestamp: { lower_threshold: start, upper_threshold: end } },
          sort_order: 'ascending',
          limit: 200,
          ...(paginationKey ? { pagination_key: paginationKey } : {}),
        }),
      });
      if (!res.ok) throw new Error(`Retell list-calls ${res.status}`);
      const batch = (await res.json()) as RetellInboundCall[];
      if (!Array.isArray(batch) || batch.length === 0) break;
      summaries.push(...batch);
      if (batch.length < 200) break;
      paginationKey = batch[batch.length - 1].call_id;
    }

    const details: RetellInboundCall[] = [];
    for (const s of summaries) {
      try {
        const res = await fetch(`${RETELL_API}/v2/get-call/${s.call_id}`, { headers });
        details.push(res.ok ? ((await res.json()) as RetellInboundCall) : s);
      } catch (err) {
        this.logger.warn(`[inbound-review] get-call ${s.call_id} failed: ${(err as Error).message}`);
        details.push(s);
      }
    }
    return details;
  }

  // ─── prompting ────────────────────────────────────────────────────────────

  private systemPrompt(): string {
    return [
      'You are the operations reviewer for a towing company\'s inbound phone line. Every morning you read',
      'yesterday\'s calls answered by an AI dispatcher ("Emily") on the company\'s callback number and write',
      'the owner a short, honest performance review.',
      '',
      'WHAT THE LINE IS FOR. Callers are (ONE) customers checking on a tow they already have, (TWO) people',
      'who need a new tow, or (THREE) a motor club checking a job they sent. Emily can look a job up by the',
      'phone number on it, by the motor club\'s PO / reference number, or by the company\'s own job number',
      '(tool lookup_job_by_phone; the result says matched_by: given, caller_id, po_number or job_number).',
      'She can take a message for dispatch (take_dispatch_message), book a new tow (create_tow_job), or',
      'transfer to a live dispatcher (transfer_to_dispatch). A transfer is the right move for safety,',
      'money, complaints, insurance, motor-club authorisations, or a caller who asks for a person — and the',
      'wrong move when the job was found and the caller only wanted to know where the truck is.',
      '',
      'RULES SHE MUST FOLLOW (a breach is a failure): never read the ETA field aloud or give a clock time',
      '— the answer is "the driver will call when he is on his way, around thirty minutes"; never quote a',
      'price; never discuss insurance coverage; ask for a number at most twice; one question at a time;',
      'do not talk over the caller or fill their pauses.',
      '',
      'YOUR REPORT.',
      '  - SUCCESSES: what she did right, grouped, with quotes. A found job answered cleanly, a good',
      '    message, a caller ID rescue, a correct transfer for a real reason.',
      '  - FAILURES: what went wrong, with severity. An avoidable transfer, a lookup that should have',
      '    found the job (e.g. a PO number passed as a phone), the wrong branch, a repeated question,',
      '    speaking over the caller, an ETA or price spoken, a dead call with nothing done, a caller who',
      '    gave up. Quote the transcript.',
      '  - RECOMMENDATIONS: specific, testable changes ranked by expected value. Say which are a prompt',
      '    change, a tool change, a data problem, or a business decision for the owner.',
      '',
      'HOW TO BE USEFUL. Ground every claim in a quote you were given. One call is an anecdote — say so.',
      'Voicemail, hang-ups inside fifteen seconds, and callers who never speak are not failures of the',
      'agent; do not pad the list with them. An empty failures or recommendations list is a correct answer',
      'on a clean day. Write for a busy owner: short sentences, no jargon.',
    ].join('\n');
  }

  private userPrompt(reviewDate: string, m: InboundFunnelMetrics, sample: ClassifiedInboundCall[]): string {
    const transcripts = sample
      .map((c, i) =>
        [
          `--- CALL ${i + 1} | id=${c.callId} | ${c.when} ET | from ${c.from} | ${c.durationSec}s | agent v${c.agentVersion} ---`,
          `branch=${c.branch || 'unknown'} outcome=${c.outcome} lookup=${c.lookupAttempted ? c.lookupKeys.join('+') || 'yes' : 'none'} found=${c.lookupFound}${c.matchedBy ? ` matched_by=${c.matchedBy}` : ''} transferred=${c.transferred}${c.transferReason ? ` (${c.transferReason})` : ''} ended=${c.disconnection}`,
          '',
          c.transcriptText,
        ].join('\n'),
      )
      .join('\n\n');

    return [
      `Review date: ${reviewDate} (America/New_York)`,
      '',
      'THE DAY IN NUMBERS',
      `  calls answered:            ${m.calls}`,
      `  real conversations:        ${m.conversations}   (no conversation: ${m.noConversation})`,
      `  lookups run:               ${m.lookups}`,
      `  job found:                 ${m.found}   (of which by caller ID: ${m.foundByCallerId})`,
      `  not found:                 ${m.notFound}`,
      `  transferred to dispatch:   ${m.transferred}   (after found: ${m.transferredAfterFound}, after not found: ${m.transferredAfterNotFound}, no lookup: ${m.transferredNoLookup})`,
      `  messages taken:            ${m.messagesTaken}`,
      `  new tows booked:           ${m.jobsCreated}`,
      `  median call length:        ${m.medianDurationSec}s`,
      '',
      'BY BRANCH',
      ...m.byBranch.map((b) => `  ${b.branch}: ${b.count}`),
      '',
      'BY OUTCOME',
      ...m.byOutcome.map((o) => `  ${o.outcome}: ${o.count}`),
      '',
      `TRANSCRIPTS (${sample.length} of ${m.calls} calls; transfers and not-founds first)`,
      '',
      transcripts,
    ].join('\n');
  }

  // ─── email ────────────────────────────────────────────────────────────────

  private async sendEmail(input: {
    reviewDate: string;
    metrics: InboundFunnelMetrics;
    analysis: InboundDailyAnalysis | null;
    calls: ClassifiedInboundCall[];
  }): Promise<number> {
    const recipients = (process.env.INBOUND_REVIEW_EMAIL ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /.@./.test(s));
    if (recipients.length === 0) {
      this.logger.warn('[inbound-review] INBOUND_REVIEW_EMAIL not set — email skipped');
      return 0;
    }
    const agentVersions = [...new Set(input.calls.map((c) => c.agentVersion).filter(Boolean))].sort();
    const emailInput = { ...input, agentVersions };
    const subject = renderInboundReviewEmailSubject(emailInput);
    const html = renderInboundReviewEmailHtml(emailInput);
    const text = renderInboundReviewEmailText(emailInput);

    let sent = 0;
    for (const to of recipients) {
      try {
        const result = await this.email.sendEmail({
          tenantId: ROADSIDE_TENANT_ID,
          to,
          subject,
          html,
          text,
          related: { kind: 'inbound_review', id: input.reviewDate },
        });
        if (result.status === 'sent') sent += 1;
        else this.logger.warn(`[inbound-review] to=${to} status=${result.status}`);
      } catch (err) {
        this.logger.warn(`[inbound-review] email to ${to} failed: ${(err as Error).message}`);
      }
    }
    return sent;
  }
}
