import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ClaudeClient } from '../call-review/claude.client';
import { SendGridEmailService } from '../admin-digest/sendgrid-email.service';
import { AlphaCrashMiddlewareClient, type AlphaCallDetail, type AlphaCallSummary } from './alpha-crash-middleware.client';
import { computeAlphaFunnel, type AlphaFunnelMetrics } from './alpha-crash-funnel';
import { ALPHA_ANALYSIS_SCHEMA, type AlphaDailyAnalysis } from './alpha-crash-review.types';
import {
  renderAlphaReviewEmailHtml,
  renderAlphaReviewEmailSubject,
  renderAlphaReviewEmailText,
} from './alpha-crash-review-email';

/** Cap on transcripts fetched per run — keeps prompt size and cost bounded. */
const MAX_TRANSCRIPTS = 40;
/** Backward-scan cap when computing the silent-streak count. */
const MAX_STREAK_LOOKBACK_DAYS = 45;

/**
 * Daily 6 AM ET review of Alpha Automotive's crash-lead outbound caller.
 *
 * Requested 2026-09-02, after the one-time analysis found the GHL lead feed
 * had gone silent for 11 days with nothing surfacing it. Same idea as
 * call-review.service.ts's outbound-flip review, but this caller has its own
 * domain (a collision-repair cold-outreach call, not a tow flip) and its own
 * failure mode worth watching first: not "is the copy working" but "is the
 * feed even alive". A zero-call day is reported as the headline finding, not
 * silently skipped the way an ordinary quiet day would be.
 *
 * Deliberately NOT persisted to a review-queue table the way outbound-flip's
 * recommendations are. That queue sat at 180 rows, 100% never triaged, and
 * became its own source of "why does this list never shrink" — see the
 * 2026-09-02 fix to call-review.service.ts's system prompt. This pipeline
 * is email-only until there's a real reason to track history in the DB.
 */
@Injectable()
export class AlphaCrashReviewService {
  private readonly logger = new Logger(AlphaCrashReviewService.name);

  constructor(
    private readonly middleware: AlphaCrashMiddlewareClient,
    private readonly claude: ClaudeClient,
    private readonly email: SendGridEmailService,
  ) {}

  @Cron('0 0 6 * * *', { name: 'alpha-crash-review-daily', timeZone: 'America/New_York' })
  async dailyCron(): Promise<void> {
    if (process.env.ALPHA_CRASH_REVIEW_ENABLED === 'false') return;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const reviewDate = yesterday.toISOString().slice(0, 10);

    try {
      await this.runReview(reviewDate);
    } catch (err) {
      this.logger.error(
        `[alpha-crash-review] date=${reviewDate} failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  /** Public so it can be triggered on demand (admin endpoint, manual run) as well as by cron. */
  async runReview(reviewDate: string): Promise<void> {
    if (!this.middleware.isConfigured()) {
      this.logger.warn('[alpha-crash-review] middleware not configured — skipping run');
      return;
    }

    const dayStart = new Date(`${reviewDate}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const calls = await this.listAll({ since: dayStart.toISOString(), until: dayEnd.toISOString() });
    const metrics = computeAlphaFunnel(calls);

    if (metrics.calls === 0) {
      const silentStreakDays = await this.computeSilentStreakDays(dayStart);
      this.logger.log(`[alpha-crash-review] date=${reviewDate} zero calls (streak=${silentStreakDays})`);
      await this.sendEmail({ reviewDate, metrics, analysis: null, silentStreakDays });
      return;
    }

    let analysis: AlphaDailyAnalysis | null = null;
    if (this.claude.isConfigured()) {
      const sample = await this.sampleWithTranscripts(calls);
      const result = await this.claude.analyze<AlphaDailyAnalysis>(
        this.systemPrompt(),
        this.userPrompt(reviewDate, metrics, sample),
        ALPHA_ANALYSIS_SCHEMA as unknown as Record<string, unknown>,
      );
      analysis = result?.analysis ?? null;
    }

    await this.sendEmail({ reviewDate, metrics, analysis, silentStreakDays: 0 });
    this.logger.log(
      `[alpha-crash-review] date=${reviewDate} calls=${metrics.calls} substantive=${metrics.substantive} ` +
        `interest=${metrics.positiveInterest}`,
    );
  }

  // ─── data ─────────────────────────────────────────────────────────────────

  private async listAll(query: { since: string; until: string }): Promise<AlphaCallSummary[]> {
    const all: AlphaCallSummary[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.middleware.listCalls({ ...query, limit: 100, offset });
      if (!page) break;
      all.push(...page.calls);
      if (page.calls.length < 100) break;
      offset += 100;
    }
    return all;
  }

  /**
   * How many consecutive days, ending the day before `dayStart`, also had zero
   * calls. Walks backward over a single 45-day pull rather than one API call
   * per day. Capped — an outage far older than this is "the feed has always
   * been off", not a streak worth counting up.
   */
  private async computeSilentStreakDays(dayStart: Date): Promise<number> {
    const since = new Date(dayStart.getTime() - MAX_STREAK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const calls = await this.listAll({ since: since.toISOString(), until: dayStart.toISOString() });
    const byDay = new Set(calls.map((c) => (c.created_at ?? '').slice(0, 10)).filter(Boolean));

    let streak = 1; // today's zero day counts as day 1 of the streak
    for (let i = 1; i <= MAX_STREAK_LOOKBACK_DAYS; i++) {
      const d = new Date(dayStart.getTime() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      if (byDay.has(d)) break;
      streak += 1;
    }
    return streak;
  }

  /**
   * Same stratification idea as call-review.service.ts's sampleTranscripts:
   * the calls worth reading are the ones with a real outcome, not the 90%+
   * that never connected. Fetches full detail (with transcript) only for the
   * sample, not all 300+ calls a normal day can carry.
   */
  private async sampleWithTranscripts(calls: AlphaCallSummary[]): Promise<AlphaCallDetail[]> {
    const substantive = calls.filter(
      (c) => c.call_outcome && !['unavailable', 'pending_or_unavailable'].includes(c.call_outcome) && !c.in_voicemail,
    );
    const rest = calls.filter((c) => !substantive.includes(c));
    const picked = [...substantive, ...rest].slice(0, MAX_TRANSCRIPTS);

    const details: AlphaCallDetail[] = [];
    for (const c of picked) {
      const detail = await this.middleware.getCall(c.call_id);
      if (detail) details.push(detail);
    }
    return details;
  }

  // ─── prompting ────────────────────────────────────────────────────────────

  private systemPrompt(): string {
    return [
      'You are a conversion analyst for a collision-repair shop. Every day you read transcripts of',
      'outbound calls placed by an AI voice agent ("Maya") to people named in public Franklin County',
      'crash reports — cold outreach, not a callback of an existing customer.',
      '',
      'THE BUSINESS. The agent calls to check whether the vehicle in the crash report still needs',
      'collision repair, and if so offers a free, no-obligation estimate (about twenty minutes, works',
      'with every insurance carrier). There is no offer ladder, no discount tiers, no app pitch — one',
      'ask, and either the person is interested, declines, or was the wrong contact entirely.',
      '',
      'YOUR JOB. Read the transcripts, then report:',
      '  - OBJECTIONS: what real people actually said when they declined or disengaged, grouped by',
      '    the underlying reason, not by phrasing.',
      '  - DEFECTS: things that were supposed to happen and did not — a call dropping mid-pitch, a',
      '    promised text with no confirmation it sent, the agent repeating a question someone already',
      '    answered, a line that reads as pressure rather than help. These ship immediately without an',
      '    A/B test, so hold them to a high bar of evidence.',
      '  - RECOMMENDATIONS: specific, testable changes, ranked by expected value.',
      '',
      'HOW TO BE USEFUL.',
      '  - Ground every claim in a quote from a transcript you were given. If you cannot quote it, do',
      '    not claim it.',
      '  - A single call is an anecdote. Prefer patterns you can see in several calls, and say plainly',
      '    when a finding rests on one or two.',
      '  - Returning zero recommendations is a correct answer on a day with no clear signal. Do not',
      '    manufacture findings to fill the list.',
      '  - Most calls will be voicemail or no-answer. Do not treat that as a defect — it is normal for',
      '    cold outreach to a public crash-report list. Focus the analysis on the calls that actually',
      '    connected.',
      '',
      'CONSTRAINTS YOU MUST RESPECT. Never propose wording that promises a repair cost, a timeline, or',
      'states what a specific insurance policy covers. Never propose removing the do-not-call handling.',
    ].join('\n');
  }

  private userPrompt(reviewDate: string, metrics: AlphaFunnelMetrics, sample: AlphaCallDetail[]): string {
    const outcomeLines = metrics.byOutcome.map((o) => `  ${o.outcome}: ${o.count}`).join('\n');
    const transcripts = sample
      .map((c, i) =>
        [
          `--- CALL ${i + 1} | id=${c.call_id} ---`,
          `outcome=${c.call_outcome ?? 'none'} duration=${c.duration_ms != null ? Math.round(c.duration_ms / 1000) : 'unknown'}s`,
          `sentiment=${c.user_sentiment ?? 'unknown'} in_voicemail=${c.in_voicemail} callback_requested=${c.callback_requested}`,
          '',
          c.transcript ?? '(no transcript)',
        ].join('\n'),
      )
      .join('\n\n');

    return [
      `Review date: ${reviewDate}`,
      '',
      'FUNNEL FOR THE DAY',
      `  calls placed:        ${metrics.calls}`,
      `  connected (any):     ${metrics.connected}`,
      `  voicemail:           ${metrics.voicemail}`,
      `  no data saved:       ${metrics.noData} (stub rows — a known webhook-drop pattern, not new unless it recurs)`,
      `  real conversations:  ${metrics.substantive}`,
      `  showed interest:     ${metrics.positiveInterest}`,
      '',
      'BY OUTCOME',
      outcomeLines || '  (none)',
      '',
      `TRANSCRIPTS (${sample.length} of ${metrics.calls} calls, substantive outcomes first)`,
      '',
      transcripts,
    ].join('\n');
  }

  // ─── email ────────────────────────────────────────────────────────────────

  private async sendEmail(input: {
    reviewDate: string;
    metrics: AlphaFunnelMetrics;
    analysis: AlphaDailyAnalysis | null;
    silentStreakDays: number;
  }): Promise<void> {
    const tenantId = process.env.ALPHA_CRASH_TENANT_ID?.trim();
    if (!tenantId) {
      this.logger.warn('[alpha-crash-review] ALPHA_CRASH_TENANT_ID not set — email skipped');
      return;
    }

    const recipients = (process.env.ALPHA_CRASH_REVIEW_EMAIL ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /.@./.test(s));

    if (recipients.length === 0) {
      this.logger.warn('[alpha-crash-review] ALPHA_CRASH_REVIEW_EMAIL not set — email skipped');
      return;
    }

    const subject = renderAlphaReviewEmailSubject(input);
    const html = renderAlphaReviewEmailHtml(input);
    const text = renderAlphaReviewEmailText(input);

    for (const to of recipients) {
      try {
        const result = await this.email.sendEmail({
          tenantId,
          to,
          subject,
          html,
          text,
          related: { kind: 'alpha_crash_review', id: input.reviewDate },
        });
        if (result.status !== 'sent') {
          this.logger.warn(`[alpha-crash-review] to=${to} status=${result.status}`);
        }
      } catch (err) {
        this.logger.warn(`[alpha-crash-review] email to ${to} failed: ${(err as Error).message}`);
      }
    }
  }
}
