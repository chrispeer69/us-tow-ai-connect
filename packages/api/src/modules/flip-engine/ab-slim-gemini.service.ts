import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { platformSettings } from '../../db/schema';
import { SendGridEmailService } from '../admin-digest/sendgrid-email.service';
import {
  AB_SETTINGS_KEY,
  abPctFromEnv,
  effectiveAbPct,
  pickAbArm,
  shouldRollback,
  summarizeAb,
  totalsFor,
  type AbArm,
  type AbCallRow,
  type AbDayRow,
  type ArmTotals,
} from './ab-slim-gemini';

interface AbState {
  rolled_back?: boolean;
  rolled_back_at?: string;
  reason?: string;
  slim?: ArmTotals;
  legacy?: ArmTotals;
}

/**
 * Runtime side of the slim/Gemini A/B: which arm a job gets, the per-arm
 * report, and the auto-rollback. Pure rules live in ab-slim-gemini.ts.
 */
@Injectable()
export class AbSlimGeminiService {
  private readonly logger = new Logger(AbSlimGeminiService.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly email: SendGridEmailService,
  ) {}

  async state(): Promise<AbState> {
    const [row] = await this.db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, AB_SETTINGS_KEY))
      .limit(1);
    return ((row?.value as AbState) ?? {}) as AbState;
  }

  /** Arm for a job. Any failure reading state is treated as "off". */
  async assignArm(seed: string | null | undefined): Promise<AbArm> {
    if (abPctFromEnv() <= 0) return 'legacy';
    try {
      const s = await this.state();
      return pickAbArm(seed, effectiveAbPct(!!s.rolled_back));
    } catch (err) {
      this.logger.warn(`[ab-slim-gemini] state read failed, using legacy: ${(err as Error).message}`);
      return 'legacy';
    }
  }

  /** Every A/B call in the window, with its Retell usage summed over attempts. */
  async loadCalls(days: number, tenantId?: string | null): Promise<AbCallRow[]> {
    const since = new Date(Date.now() - Math.max(1, days) * 86_400_000);
    const tenantFilter = tenantId ? sql`and l.tenant_id = ${tenantId}` : sql``;
    const res = await this.db.execute(sql`
      select
        to_char(l.call_time at time zone 'America/New_York', 'YYYY-MM-DD') as day,
        l.ab_arm as arm,
        l.call_duration_seconds as duration_seconds,
        l.flip_eligible,
        l.offer_1_result,
        l.flip_outcome,
        oc.error as disconnection_reason,
        l.transcript,
        u.cost_cents,
        u.billed_seconds,
        u.llm_avg_tokens,
        u.latency_p50_ms,
        u.latency_p95_ms
      from outbound_call_logs l
      left join outbound_calls oc on oc.id = l.outbound_call_id
      left join lateral (
        select
          sum(r.combined_cost_cents)::float as cost_cents,
          sum(r.duration_seconds)::float as billed_seconds,
          avg(r.llm_average_tokens)::float as llm_avg_tokens,
          max(r.latency_p50_ms) as latency_p50_ms,
          max(r.latency_p95_ms) as latency_p95_ms
        from retell_call_usage r
        where r.outbound_call_id = l.outbound_call_id
      ) u on true
      where l.ab_arm is not null and l.call_time >= ${since} ${tenantFilter}
    `);
    const rows = ((res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])) as Array<Record<string, unknown>>;
    const num = (v: unknown) => (v == null ? null : Number(v));
    return rows.map((r) => ({
      day: String(r.day),
      arm: r.arm === 'slim_gemini' ? 'slim_gemini' : 'legacy',
      durationSeconds: num(r.duration_seconds),
      flipEligible: r.flip_eligible == null ? null : Boolean(r.flip_eligible),
      offer1Result: (r.offer_1_result as string) ?? null,
      flipOutcome: (r.flip_outcome as string) ?? null,
      disconnectionReason: (r.disconnection_reason as string) ?? null,
      transcript: (r.transcript as string) ?? null,
      costCents: num(r.cost_cents),
      billedSeconds: num(r.billed_seconds),
      llmAvgTokens: num(r.llm_avg_tokens),
      latencyP50Ms: num(r.latency_p50_ms),
      latencyP95Ms: num(r.latency_p95_ms),
    }));
  }

  async report(days = 14, tenantId?: string | null): Promise<{
    rows: AbDayRow[];
    totals: { slim_gemini: ArmTotals; legacy: ArmTotals };
    state: AbState & { env_pct: number; effective_pct: number };
  }> {
    const calls = await this.loadCalls(days, tenantId);
    const s = await this.state();
    return {
      rows: summarizeAb(calls),
      totals: { slim_gemini: totalsFor(calls, 'slim_gemini'), legacy: totalsFor(calls, 'legacy') },
      state: { ...s, env_pct: abPctFromEnv(), effective_pct: effectiveAbPct(!!s.rolled_back) },
    };
  }

  /**
   * Every 30 minutes while the arm is live. Compares the arms over everything
   * since the A/B began (90 days back is ample) and, on a breach, turns the
   * arm off in platform_settings and emails an alert. Never re-alerts.
   */
  @Cron('0 */30 * * * *', { name: 'ab-slim-gemini-rollback' })
  async checkRollback(): Promise<{ rolledBack: boolean; reason: string | null }> {
    if (abPctFromEnv() <= 0) return { rolledBack: false, reason: null };
    const s = await this.state();
    if (s.rolled_back) return { rolledBack: false, reason: null };
    const calls = await this.loadCalls(90);
    const slim = totalsFor(calls, 'slim_gemini');
    const legacy = totalsFor(calls, 'legacy');
    const verdict = shouldRollback(slim, legacy);
    if (!verdict.rollback) return { rolledBack: false, reason: null };

    const value: AbState = {
      rolled_back: true,
      rolled_back_at: new Date().toISOString(),
      reason: verdict.reason ?? 'threshold breached',
      slim,
      legacy,
    };
    await this.db
      .insert(platformSettings)
      .values({ key: AB_SETTINGS_KEY, value })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: new Date() } });
    this.logger.error(`[ab-slim-gemini] AUTO-ROLLBACK: ${verdict.reason}`);
    await this.alert(value).catch((err) =>
      this.logger.warn(`[ab-slim-gemini] rollback alert failed: ${(err as Error).message}`),
    );
    return { rolledBack: true, reason: verdict.reason };
  }

  private async alert(v: AbState): Promise<void> {
    const to = (process.env.AB_ALERT_EMAILS || 'thechrispeer@gmail.com')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const tenantId = process.env.AB_ALERT_TENANT_ID || '00000000-0000-0000-0000-000000000001';
    const line = (name: string, t?: ArmTotals) =>
      t
        ? `${name}: ${t.connected} connected, ${t.accepted}/${t.eligibleConnected} accepted, ` +
          `$${t.billedMinutes > 0 ? (t.costDollars / t.billedMinutes).toFixed(3) : '—'}/min`
        : `${name}: —`;
    const text = [
      'The slim + Gemini outbound A/B arm has been switched OFF automatically.',
      '',
      `Reason: ${v.reason}`,
      line('slim_gemini', v.slim),
      line('legacy', v.legacy),
      '',
      'All new jobs now go to legacy v61. Calls already queued on the slim arm still complete on it.',
      `To resume after review: delete platform_settings key '${AB_SETTINGS_KEY}' (or set rolled_back false).`,
    ].join('\n');
    for (const addr of to) {
      await this.email.sendEmail({
        tenantId,
        to: addr,
        subject: 'Emily A/B auto-rollback: slim + Gemini arm switched off',
        html: `<pre style="font-family:monospace">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`,
        text,
        related: { kind: 'ab_slim_gemini_rollback' },
      });
    }
  }
}
