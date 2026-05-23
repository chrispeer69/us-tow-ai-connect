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

    await this.db.insert(dispatchDecisions).values({
      jobId: job.id,
      ruleId: matched?.id ?? null,
      decision,
      reason,
      evaluatedConditions: trace,
      decidedBy: 'ai',
    });

    await this.commandCenter.recordAutoDecision(tenantId, job.id, decision, reason);

    if (decision === 'accepted' || decision === 'declined') {
      await this.applyToAdapter(tenantId, job, decision, reason).catch((err) =>
        this.logger.warn(
          `Adapter side-effect for ${decision} failed (job ${job.id}): ${(err as Error).message}`,
        ),
      );
    }

    return { decision, ruleId: matched?.id ?? null, reason, evaluatedConditions: trace };
  }

  private async applyToAdapter(
    tenantId: string,
    job: UnifiedJobRow,
    decision: 'accepted' | 'declined',
    reason: string,
  ) {
    const software = ADAPTER_SOFTWARE_BY_SOURCE[job.source];
    if (!software) {
      this.logger.debug(`No adapter mapping for source ${job.source} — skipping side effect`);
      return;
    }
    const adapter = this.adapterFactory.getAdapter(software);
    if (!('acceptJob' in adapter) || typeof (adapter as { acceptJob?: unknown }).acceptJob !== 'function') {
      this.logger.debug(`Adapter for ${software} does not implement accept/decline`);
      return;
    }
    const a = adapter as unknown as {
      acceptJob?: (tenantId: string, sourceJobId: string) => Promise<void>;
      declineJob?: (tenantId: string, sourceJobId: string, reason: string) => Promise<void>;
    };
    if (decision === 'accepted' && a.acceptJob) {
      await a.acceptJob(tenantId, job.sourceJobId);
    } else if (decision === 'declined' && a.declineJob) {
      await a.declineJob(tenantId, job.sourceJobId, reason);
    }
  }
}
