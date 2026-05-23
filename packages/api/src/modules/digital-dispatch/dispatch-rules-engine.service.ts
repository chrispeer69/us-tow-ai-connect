import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import {
  dispatchDecisions,
  dispatchRules,
  drivers,
  tenants,
  type DispatchRuleRow,
  type UnifiedJobRow,
} from '../../db/schema';
import { AdapterFactory } from '../adapters/adapter.factory';
import type { AdapterActionResult } from '../adapters/adapter.interface';
import { CommandCenterService } from '../command-center/command-center.service';
import type { Condition, ConditionResult } from './conditions';
import { evaluateAll } from './conditions';

export type EngineDecision = 'accepted' | 'declined' | 'flagged';

export interface EngineResult {
  decision: EngineDecision;
  ruleId: string | null;
  reason: string;
  evaluatedConditions: Array<{ ruleId: string; ruleName: string; results: ConditionResult[]; matched: boolean }>;
}

const ADAPTER_SOFTWARE_BY_SOURCE: Record<string, string> = {
  aaa_salesforce: 'AAA_PORTAL',
  towbook: 'TOWBOOK',
};

@Injectable()
export class DispatchRulesEngineService {
  private readonly logger = new Logger(DispatchRulesEngineService.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly commandCenter: CommandCenterService,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  /**
   * Evaluate a job against the tenant's rules. The first matching rule
   * wins; its action determines the decision. With no rules matching, the
   * default is `flagged`. A dispatch_decisions row is always written;
   * `recordAutoDecision` updates the job row when accept/decline is the
   * outcome.
   */
  async evaluateForJob(
    tenantId: string,
    job: UnifiedJobRow,
    options?: { dryRun?: boolean },
  ): Promise<EngineResult> {
    const dryRun = !!options?.dryRun;

    const tenant = await this.db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });
    const timezone = tenant?.timezone ?? 'America/New_York';

    const rules = await this.db.query.dispatchRules.findMany({
      where: and(eq(dispatchRules.tenantId, tenantId), eq(dispatchRules.enabled, true)),
      orderBy: [asc(dispatchRules.priority), asc(dispatchRules.createdAt)],
    });

    const driverRows = await this.db.query.drivers.findMany({
      where: eq(drivers.tenantId, tenantId),
    });

    const ctx = {
      job,
      tenantTimezone: timezone,
      now: new Date(),
      drivers: driverRows.map((d) => ({
        id: d.id,
        status: d.status,
        currentLat: d.currentLat,
        currentLng: d.currentLng,
        lastPingAt: d.lastPingAt,
      })),
    };

    const trace: EngineResult['evaluatedConditions'] = [];
    let matched: DispatchRuleRow | null = null;
    let matchedResults: ConditionResult[] = [];

    for (const rule of rules) {
      const conditions = (rule.conditions as Condition[] | null) ?? [];
      const evalResult = evaluateAll(conditions, ctx);
      trace.push({
        ruleId: rule.id,
        ruleName: rule.name,
        results: evalResult.results,
        matched: evalResult.matched,
      });
      if (evalResult.matched) {
        matched = rule;
        matchedResults = evalResult.results;
        break;
      }
    }

    let decision: EngineDecision = 'flagged';
    let reason = 'no rule matched — default flag';
    if (matched) {
      decision = matched.action as EngineDecision;
      const matchedReasons = matchedResults
        .map((r) => r.reason)
        .filter(Boolean)
        .join('; ');
      reason = `rule "${matched.name}" matched (${decision}): ${matchedReasons || 'all conditions true'}`;
    }

    if (dryRun) {
      return { decision, ruleId: matched?.id ?? null, reason, evaluatedConditions: trace };
    }

    const [decisionRow] = await this.db
      .insert(dispatchDecisions)
      .values({
        jobId: job.id,
        ruleId: matched?.id ?? null,
        decision,
        reason,
        evaluatedConditions: trace,
        decidedBy: 'ai',
      })
      .returning({ id: dispatchDecisions.id });

    await this.commandCenter.recordAutoDecision(tenantId, job.id, decision, reason);

    if (decision === 'accepted' || decision === 'declined') {
      // Physically click Accept/Decline in the source portal. The adapter
      // never throws — it returns success/failure — so the decision row's
      // evidence trail reflects whether the click actually landed.
      const result = await this.applyToAdapter(tenantId, job, decision, reason);
      if (result && decisionRow?.id) {
        await this.db
          .update(dispatchDecisions)
          .set({
            confirmationEvidence: result.success
              ? result.confirmationEvidence ?? 'confirmed'
              : `FAILED: ${result.error ?? 'unknown error'}`,
            confirmedAt: result.confirmedAt ? new Date(result.confirmedAt) : null,
          })
          .where(eq(dispatchDecisions.id, decisionRow.id))
          .catch((err) =>
            this.logger.warn(
              `Failed to persist confirmation evidence (decision ${decisionRow.id}): ${(err as Error).message}`,
            ),
          );
      }
    }

    return { decision, ruleId: matched?.id ?? null, reason, evaluatedConditions: trace };
  }

  /**
   * Invoke the source adapter's accept/decline action. Returns the adapter's
   * result, or null when there is no adapter mapping / the adapter does not
   * implement the action. Adapter failures are caught and returned as a
   * failed result so a flaky portal click never crashes the dispatch worker.
   */
  private async applyToAdapter(
    tenantId: string,
    job: UnifiedJobRow,
    decision: 'accepted' | 'declined',
    reason: string,
  ): Promise<AdapterActionResult | null> {
    const software = ADAPTER_SOFTWARE_BY_SOURCE[job.source];
    if (!software) {
      this.logger.debug(`No adapter mapping for source ${job.source} — skipping side effect`);
      return null;
    }
    const adapter = this.adapterFactory.getAdapter(software);
    const a = adapter as unknown as {
      acceptJob?: (tenantId: string, sourceJobId: string) => Promise<AdapterActionResult>;
      declineJob?: (
        tenantId: string,
        sourceJobId: string,
        reason: string,
      ) => Promise<AdapterActionResult>;
    };
    const fn = decision === 'accepted' ? a.acceptJob : a.declineJob;
    if (typeof fn !== 'function') {
      this.logger.debug(`Adapter for ${software} does not implement ${decision}`);
      return null;
    }
    try {
      const result =
        decision === 'accepted'
          ? await a.acceptJob!(tenantId, job.sourceJobId)
          : await a.declineJob!(tenantId, job.sourceJobId, reason);
      if (!result.success) {
        this.logger.warn(
          `Adapter ${software} ${decision} did not confirm for job ${job.id}: ${result.error ?? 'no error'}`,
        );
      }
      return result;
    } catch (err) {
      const error = (err as Error).message;
      this.logger.warn(`Adapter ${software} ${decision} threw for job ${job.id}: ${error}`);
      return { success: false, error };
    }
  }
}
