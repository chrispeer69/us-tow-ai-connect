import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import {
  callReviewRuns,
  outboundCallLogs,
  scriptRecommendations,
  tenants,
  type OutboundCallLogRow,
} from '../../db/schema';
import { ClaudeClient } from './claude.client';
import { SendGridEmailService } from '../admin-digest/sendgrid-email.service';
import {
  renderReviewEmailHtml,
  renderReviewEmailSubject,
  renderReviewEmailText,
  type ReviewEmailInput,
} from './call-review-email';
import type { DailyAnalysis, Recommendation } from './call-review.types';

const WIN = sql`flip_outcome ~* 'WIN|ACCEPTED'`;

/** Cap on transcripts per run — keeps prompt size and cost bounded. */
const MAX_TRANSCRIPTS = 60;
/** Transcripts shorter than this are hangups/voicemail; nothing to learn. */
const MIN_TRANSCRIPT_CHARS = 200;
/** Trim each transcript so one outlier can't dominate the prompt. */
const MAX_TRANSCRIPT_CHARS = 6000;

interface FunnelMetrics {
  calls: number;
  eligible: number;
  neverPitched: number;
  offer1Accepted: number;
  offer1Declined: number;
  offer2Reached: number;
  offer2Accepted: number;
  offer3Reached: number;
  offer3Accepted: number;
  wins: number;
  winRateOfEligible: number;
  byScenario: Array<{ scenario: string; calls: number; eligible: number; wins: number }>;
}

@Injectable()
export class CallReviewService {
  private readonly logger = new Logger(CallReviewService.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly claude: ClaudeClient,
    private readonly email: SendGridEmailService,
  ) {}

  // ─── schedule ─────────────────────────────────────────────────────────────
  /**
   * 06:15 America/New_York, daily. Reviews the previous calendar day.
   *
   * Daily is the right cadence for *monitoring and hypothesis generation*, not
   * for deciding. At ~190 eligible calls/week a wording A/B needs 4–6 weeks to
   * reach significance — a daily verdict on copy would be reading noise. What
   * this catches daily is defects and sudden regressions, which need no
   * statistical patience.
   */
  @Cron('0 15 6 * * *', { name: 'call-review-daily', timeZone: 'America/New_York' })
  async dailyCron(): Promise<void> {
    if (process.env.CALL_REVIEW_ENABLED === 'false') return;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const reviewDate = yesterday.toISOString().slice(0, 10);

    const tenantRows = await this.db.select({ id: tenants.id }).from(tenants);
    for (const t of tenantRows) {
      try {
        await this.runReview(t.id, reviewDate);
      } catch (err) {
        this.logger.error(
          `[call-review] tenant=${t.id} date=${reviewDate} failed: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }
  }

  // ─── the run ──────────────────────────────────────────────────────────────
  /**
   * Compute the day's funnel, sample transcripts, ask Claude to classify the
   * failures, and persist the findings plus any proposed edits.
   *
   * Re-runnable: the unique (tenant, date) row is replaced, and that day's
   * still-PROPOSED recommendations are cleared first so a re-run doesn't
   * duplicate them. Recommendations a human has already acted on are left
   * alone.
   */
  async runReview(tenantId: string, reviewDate: string) {
    const dayStart = new Date(`${reviewDate}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const rows = (await this.db
      .select()
      .from(outboundCallLogs)
      .where(
        and(
          eq(outboundCallLogs.tenantId, tenantId),
          gte(outboundCallLogs.callTime, dayStart),
          lt(outboundCallLogs.callTime, dayEnd),
        ),
      )) as OutboundCallLogRow[];

    const metrics = this.computeFunnel(rows);

    const run = await this.upsertRun(tenantId, reviewDate, {
      status: 'RUNNING',
      callsConsidered: rows.length,
      eligible: metrics.eligible,
      wins: metrics.wins,
      neverPitched: metrics.neverPitched,
      metrics,
    });

    // Nothing to analyze — record the metrics and stop. A quiet day is a valid
    // outcome, not a failure.
    if (rows.length === 0 || !this.claude.isConfigured()) {
      await this.db
        .update(callReviewRuns)
        .set({
          status: rows.length === 0 ? 'SKIPPED' : 'COMPLETE',
          summary:
            rows.length === 0
              ? 'No outbound calls placed on this date.'
              : 'Transcript analysis skipped — ANTHROPIC_API_KEY is not configured.',
          completedAt: new Date(),
        })
        .where(eq(callReviewRuns.id, run.id));
      return this.getRun(tenantId, run.id);
    }

    const sample = this.sampleTranscripts(rows);
    const result = await this.claude.analyze(
      this.systemPrompt(),
      this.userPrompt(reviewDate, metrics, sample),
    );

    if (!result) {
      await this.db
        .update(callReviewRuns)
        .set({
          status: 'FAILED',
          error: 'Analysis request returned no usable result — see logs.',
          callsAnalyzed: sample.length,
          model: this.claude.model,
          completedAt: new Date(),
        })
        .where(eq(callReviewRuns.id, run.id));
      return this.getRun(tenantId, run.id);
    }

    const { analysis, inputTokens, outputTokens } = result;

    await this.db
      .update(callReviewRuns)
      .set({
        status: 'COMPLETE',
        callsAnalyzed: sample.length,
        summary: analysis.summary,
        objections: analysis.objections as unknown as never,
        defects: analysis.defects as unknown as never,
        model: this.claude.model,
        inputTokens,
        outputTokens,
        completedAt: new Date(),
      })
      .where(eq(callReviewRuns.id, run.id));

    await this.replaceProposals(tenantId, run.id, analysis.recommendations);
    await this.sendReviewEmail(tenantId, reviewDate, metrics, analysis, sample.length);

    this.logger.log(
      `[call-review] tenant=${tenantId} date=${reviewDate} calls=${rows.length} analyzed=${sample.length} ` +
        `wins=${metrics.wins}/${metrics.eligible} recommendations=${analysis.recommendations.length}`,
    );

    return this.getRun(tenantId, run.id);
  }

  // ─── email ────────────────────────────────────────────────────────────────
  /**
   * Best-effort. A failed send must never fail the review run — the findings
   * are already persisted and readable via the API by the time this runs.
   */
  private async sendReviewEmail(
    tenantId: string,
    reviewDate: string,
    metrics: FunnelMetrics,
    analysis: DailyAnalysis | null,
    callsAnalyzed: number,
  ): Promise<void> {
    try {
      const tenant = (
        await this.db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
      )[0];
      if (!tenant) return;

      const recipients = Array.isArray(tenant.callReviewEmails)
        ? (tenant.callReviewEmails as unknown[]).filter(
            (v): v is string => typeof v === 'string' && /.@./.test(v) && v.length < 320,
          )
        : [];

      if (recipients.length === 0) {
        this.logger.log(
          `[call-review] tenant=${tenantId} email skipped — no call_review_emails configured`,
        );
        return;
      }

      const input: ReviewEmailInput = {
        companyName: tenant.companyName,
        reviewDate,
        metrics,
        analysis,
        callsAnalyzed,
        webBaseUrl: (process.env.WEB_PUBLIC_URL ?? 'https://www.ustowaiconnect.com').replace(
          /\/$/,
          '',
        ),
      };

      const subject = renderReviewEmailSubject(input);
      const html = renderReviewEmailHtml(input);
      const text = renderReviewEmailText(input);

      for (const to of recipients) {
        try {
          await this.email.sendEmail({
            tenantId,
            to,
            subject,
            html,
            text,
            related: { kind: 'call_review', id: reviewDate },
          });
        } catch (err) {
          this.logger.warn(
            `[call-review] email to ${to} failed: ${(err as Error).message}`,
          );
        }
      }
      this.logger.log(
        `[call-review] tenant=${tenantId} date=${reviewDate} emailed ${recipients.length} recipient(s)`,
      );
    } catch (err) {
      this.logger.warn(`[call-review] email step failed: ${(err as Error).message}`);
    }
  }

  // ─── funnel ───────────────────────────────────────────────────────────────
  private computeFunnel(rows: OutboundCallLogRow[]): FunnelMetrics {
    const isWin = (r: OutboundCallLogRow) => /WIN|ACCEPTED/i.test(r.flipOutcome ?? '');
    const attempted = (v: string | null) => v != null && v !== 'NOT_ATTEMPTED';

    const eligibleRows = rows.filter((r) => r.flipEligible);
    const wins = rows.filter(isWin).length;

    const byScenarioMap = new Map<
      string,
      { scenario: string; calls: number; eligible: number; wins: number }
    >();
    for (const r of rows) {
      const key = r.scenario ?? r.destinationType ?? 'unknown';
      const entry =
        byScenarioMap.get(key) ?? { scenario: key, calls: 0, eligible: 0, wins: 0 };
      entry.calls += 1;
      if (r.flipEligible) entry.eligible += 1;
      if (isWin(r)) entry.wins += 1;
      byScenarioMap.set(key, entry);
    }

    return {
      calls: rows.length,
      eligible: eligibleRows.length,
      neverPitched: eligibleRows.filter((r) => !attempted(r.offer1Result)).length,
      offer1Accepted: rows.filter((r) => r.offer1Result === 'ACCEPTED').length,
      offer1Declined: rows.filter((r) => r.offer1Result === 'DECLINED').length,
      offer2Reached: rows.filter((r) => attempted(r.offer2Result)).length,
      offer2Accepted: rows.filter((r) => r.offer2Result === 'ACCEPTED').length,
      offer3Reached: rows.filter((r) => attempted(r.offer3Result)).length,
      offer3Accepted: rows.filter((r) => r.offer3Result === 'ACCEPTED').length,
      wins,
      winRateOfEligible:
        eligibleRows.length > 0
          ? Number(((wins / eligibleRows.length) * 100).toFixed(1))
          : 0,
      byScenario: [...byScenarioMap.values()].sort((a, b) => b.calls - a.calls),
    };
  }

  // ─── sampling ─────────────────────────────────────────────────────────────
  /**
   * Stratified, not random. A random sample of a day's calls is ~95% losses and
   * teaches the model almost nothing about what closes. Priority order:
   *
   *   1. every win            — the only positive examples that exist
   *   2. near-misses          — declined at offer 2 or 3, i.e. genuinely engaged
   *   3. never-pitched        — the biggest leak in the funnel
   *   4. ordinary declines    — filler, to keep the objection counts honest
   */
  private sampleTranscripts(rows: OutboundCallLogRow[]) {
    const usable = rows.filter(
      (r) => (r.transcript?.length ?? 0) >= MIN_TRANSCRIPT_CHARS,
    );
    const isWin = (r: OutboundCallLogRow) => /WIN|ACCEPTED/i.test(r.flipOutcome ?? '');
    const attempted = (v: string | null) => v != null && v !== 'NOT_ATTEMPTED';

    const wins = usable.filter(isWin);
    const nearMiss = usable.filter((r) => !isWin(r) && attempted(r.offer2Result));
    const neverPitched = usable.filter(
      (r) => !isWin(r) && r.flipEligible && !attempted(r.offer1Result),
    );
    const rest = usable.filter(
      (r) => !wins.includes(r) && !nearMiss.includes(r) && !neverPitched.includes(r),
    );

    const picked: OutboundCallLogRow[] = [];
    const seen = new Set<string>();
    for (const bucket of [wins, nearMiss, neverPitched, rest]) {
      for (const r of bucket) {
        if (picked.length >= MAX_TRANSCRIPTS) break;
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        picked.push(r);
      }
    }
    return picked;
  }

  // ─── prompting ────────────────────────────────────────────────────────────
  private systemPrompt(): string {
    return [
      'You are a conversion analyst for a roadside-assistance company. Every day you read',
      'transcripts of outbound calls placed by an AI voice agent and work out why they did',
      'or did not close.',
      '',
      'THE BUSINESS. A customer has requested a tow to some destination. The agent calls to',
      'confirm details and, when the destination is a competitor repair shop, tries to "flip"',
      'the tow to one of our own shops using a three-tier offer ladder. A WIN is the customer',
      'agreeing to change destination. The agent also pitches CONVINI, a free tracking app.',
      '',
      'YOUR JOB. Read the transcripts, then report:',
      '  - OBJECTIONS: what customers actually said, grouped by substance, with verbatim quotes.',
      '    Group by the underlying reason, not by phrasing.',
      '  - DEFECTS: things that were supposed to happen and did not. The agent skipping a',
      '    scripted step, a variable rendering blank or as a literal placeholder, a call ending',
      '    in the opening seconds, the agent inventing information. These ship immediately',
      '    without an A/B test, so hold them to a high bar of evidence.',
      '  - RECOMMENDATIONS: specific, testable changes, ranked by expected value.',
      '',
      'HOW TO BE USEFUL.',
      '  - Ground every claim in a quote from a transcript you were given. If you cannot quote',
      '    it, do not claim it.',
      '  - A single call is an anecdote. Prefer patterns you can see in several calls, and say',
      '    plainly when a finding rests on one or two.',
      '  - Distinguish "the script says the wrong thing" from "the agent did not follow the',
      '    script". They have completely different fixes and only the first is a wording change.',
      '  - When you propose wording, write the exact replacement text, in the voice of the',
      '    existing script. Do not describe the change abstractly.',
      '  - Returning zero recommendations is a correct answer on a day with no clear signal.',
      '    Do not manufacture findings to fill the list.',
      '',
      'CONSTRAINTS YOU MUST RESPECT. Never propose wording that makes a promise about price,',
      'timing, or insurance coverage. Never propose removing the opt-out language. Calls placed',
      'on behalf of a motor club are subject to that club\'s rules — AAA jobs must never receive',
      'a flip offer at all.',
    ].join('\n');
  }

  private userPrompt(
    reviewDate: string,
    metrics: FunnelMetrics,
    sample: OutboundCallLogRow[],
  ): string {
    const scenarioLines = metrics.byScenario
      .map(
        (s) =>
          `  ${s.scenario}: ${s.calls} calls, ${s.eligible} eligible, ${s.wins} wins`,
      )
      .join('\n');

    const transcripts = sample
      .map((r, i) => {
        const outcome = /WIN|ACCEPTED/i.test(r.flipOutcome ?? '') ? 'WIN' : r.flipOutcome;
        return [
          `--- CALL ${i + 1} | id=${r.id} ---`,
          `scenario=${r.scenario ?? r.destinationType ?? 'unknown'} eligible=${r.flipEligible} outcome=${outcome}`,
          `offers: 1=${r.offer1Result} 2=${r.offer2Result} 3=${r.offer3Result}`,
          `duration=${r.callDurationSeconds ?? 'unknown'}s issue=${r.issueType ?? 'unknown'} destination=${r.destinationBusinessName ?? 'unknown'}`,
          `nearest_our_shop=${r.nearestOurShop ?? 'none'} convini_sent=${r.conviniLinkSent}`,
          '',
          (r.transcript ?? '').slice(0, MAX_TRANSCRIPT_CHARS),
        ].join('\n');
      })
      .join('\n\n');

    return [
      `Review date: ${reviewDate}`,
      '',
      'FUNNEL FOR THE DAY',
      `  calls placed:        ${metrics.calls}`,
      `  flip-eligible:       ${metrics.eligible}`,
      `  never pitched:       ${metrics.neverPitched} (eligible calls where offer 1 was never made)`,
      `  offer 1 accepted:    ${metrics.offer1Accepted}`,
      `  offer 1 declined:    ${metrics.offer1Declined}`,
      `  offer 2 reached:     ${metrics.offer2Reached}  accepted: ${metrics.offer2Accepted}`,
      `  offer 3 reached:     ${metrics.offer3Reached}  accepted: ${metrics.offer3Accepted}`,
      `  WINS:                ${metrics.wins}  (${metrics.winRateOfEligible}% of eligible)`,
      '',
      'BY SCENARIO',
      scenarioLines || '  (none)',
      '',
      `TRANSCRIPTS (${sample.length} of ${metrics.calls} calls, stratified: all wins first, then`,
      'near-misses that reached offer 2, then eligible calls that were never pitched, then',
      'ordinary declines)',
      '',
      transcripts,
    ].join('\n');
  }

  // ─── persistence ──────────────────────────────────────────────────────────
  private async upsertRun(
    tenantId: string,
    reviewDate: string,
    values: Partial<typeof callReviewRuns.$inferInsert>,
  ) {
    const existing = (
      await this.db
        .select()
        .from(callReviewRuns)
        .where(
          and(
            eq(callReviewRuns.tenantId, tenantId),
            eq(callReviewRuns.reviewDate, reviewDate),
          ),
        )
        .limit(1)
    )[0];

    if (existing) {
      const updated = (
        await this.db
          .update(callReviewRuns)
          .set({ ...values, error: null, completedAt: null })
          .where(eq(callReviewRuns.id, existing.id))
          .returning()
      )[0];
      return updated;
    }

    return (
      await this.db
        .insert(callReviewRuns)
        .values({ tenantId, reviewDate, ...values } as typeof callReviewRuns.$inferInsert)
        .returning()
    )[0];
  }

  /** Clear this run's untouched proposals, then write the new set. */
  private async replaceProposals(
    tenantId: string,
    runId: string,
    recommendations: Recommendation[],
  ) {
    await this.db
      .delete(scriptRecommendations)
      .where(
        and(
          eq(scriptRecommendations.runId, runId),
          eq(scriptRecommendations.status, 'PROPOSED'),
        ),
      );

    if (recommendations.length === 0) return;

    await this.db.insert(scriptRecommendations).values(
      recommendations.map((r) => ({
        tenantId,
        runId,
        scenario: r.scenario ?? null,
        target: r.target.slice(0, 60),
        title: r.title.slice(0, 255),
        problem: r.problem,
        proposedText: r.proposedText ?? null,
        currentText: r.currentText ?? null,
        rationale: r.rationale,
        evidence: (r.evidence ?? []) as unknown as never,
        kind: r.kind,
        confidence: r.confidence,
        expectedLift: r.expectedLift?.slice(0, 60) ?? null,
        status: 'PROPOSED',
      })),
    );
  }

  // ─── queries ──────────────────────────────────────────────────────────────
  async listRuns(tenantId: string, limit = 30) {
    return this.db
      .select()
      .from(callReviewRuns)
      .where(eq(callReviewRuns.tenantId, tenantId))
      .orderBy(desc(callReviewRuns.reviewDate))
      .limit(limit);
  }

  async getRun(tenantId: string, runId: string) {
    const run = (
      await this.db
        .select()
        .from(callReviewRuns)
        .where(
          and(eq(callReviewRuns.id, runId), eq(callReviewRuns.tenantId, tenantId)),
        )
        .limit(1)
    )[0];
    if (!run) {
      throw new NotFoundException({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Review run not found',
      });
    }
    const recommendations = await this.db
      .select()
      .from(scriptRecommendations)
      .where(eq(scriptRecommendations.runId, runId))
      .orderBy(desc(scriptRecommendations.createdAt));
    return { run, recommendations };
  }

  async listRecommendations(tenantId: string, status?: string) {
    const where = status
      ? and(
          eq(scriptRecommendations.tenantId, tenantId),
          eq(scriptRecommendations.status, status),
        )
      : eq(scriptRecommendations.tenantId, tenantId);
    return this.db
      .select()
      .from(scriptRecommendations)
      .where(where)
      .orderBy(desc(scriptRecommendations.createdAt))
      .limit(200);
  }

  /**
   * Move a recommendation through the review workflow. Approving records the
   * decision; it does NOT edit the live script — promotion into a variant is a
   * deliberate, separate code change, so a mis-click can never reach a customer.
   */
  async reviewRecommendation(
    tenantId: string,
    id: string,
    status: 'APPROVED' | 'REJECTED' | 'LIVE' | 'RETIRED',
    reviewedBy: string | null,
    note?: string,
  ) {
    const existing = (
      await this.db
        .select()
        .from(scriptRecommendations)
        .where(
          and(
            eq(scriptRecommendations.id, id),
            eq(scriptRecommendations.tenantId, tenantId),
          ),
        )
        .limit(1)
    )[0];
    if (!existing) {
      throw new NotFoundException({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Recommendation not found',
      });
    }

    return (
      await this.db
        .update(scriptRecommendations)
        .set({
          status,
          reviewedBy: reviewedBy ?? null,
          reviewedAt: new Date(),
          reviewNote: note ?? existing.reviewNote,
        })
        .where(eq(scriptRecommendations.id, id))
        .returning()
    )[0];
  }

  /**
   * Win rate sliced by script version — the payoff from Phase 0. Until two
   * versions have both accumulated calls this returns a single row, which is
   * itself the useful signal that no experiment has run yet.
   */
  async performanceByVersion(tenantId: string, days = 90) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.db
      .select({
        scriptVersion: outboundCallLogs.scriptVersion,
        scriptVariant: outboundCallLogs.scriptVariant,
        scenario: outboundCallLogs.scenario,
        calls: sql<number>`count(*)::int`,
        eligible: sql<number>`count(*) filter (where ${outboundCallLogs.flipEligible})::int`,
        wins: sql<number>`count(*) filter (where ${WIN})::int`,
      })
      .from(outboundCallLogs)
      .where(
        and(
          eq(outboundCallLogs.tenantId, tenantId),
          gte(outboundCallLogs.callTime, since),
        ),
      )
      .groupBy(
        outboundCallLogs.scriptVersion,
        outboundCallLogs.scriptVariant,
        outboundCallLogs.scenario,
      );
  }
}
