import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import {
  dispatchDecisions,
  dispatchRules,
  unifiedJobs,
  type DispatchRuleRow,
  type UnifiedJobRow,
} from '../../db/schema';
import { DispatchRulesEngineService, type EngineResult } from './dispatch-rules-engine.service';

export interface CreateRuleInput {
  name: string;
  enabled?: boolean;
  priority?: number;
  conditions: unknown[];
  action: 'accept' | 'decline' | 'flag';
}

export interface UpdateRuleInput extends Partial<CreateRuleInput> {}

@Injectable()
export class DigitalDispatchService {
  private readonly logger = new Logger(DigitalDispatchService.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly engine: DispatchRulesEngineService,
  ) {}

  listRules(tenantId: string) {
    return this.db.query.dispatchRules.findMany({
      where: eq(dispatchRules.tenantId, tenantId),
      orderBy: [dispatchRules.priority, dispatchRules.createdAt],
    });
  }

  async createRule(tenantId: string, input: CreateRuleInput): Promise<DispatchRuleRow> {
    const [row] = await this.db
      .insert(dispatchRules)
      .values({
        tenantId,
        name: input.name,
        enabled: input.enabled ?? true,
        priority: input.priority ?? 0,
        conditions: input.conditions,
        action: input.action,
      })
      .returning();
    return row;
  }

  async updateRule(tenantId: string, ruleId: string, patch: UpdateRuleInput): Promise<DispatchRuleRow> {
    const set: Partial<DispatchRuleRow> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.enabled !== undefined) set.enabled = patch.enabled;
    if (patch.priority !== undefined) set.priority = patch.priority;
    if (patch.conditions !== undefined) set.conditions = patch.conditions;
    if (patch.action !== undefined) set.action = patch.action;
    const [row] = await this.db
      .update(dispatchRules)
      .set(set)
      .where(and(eq(dispatchRules.id, ruleId), eq(dispatchRules.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException({ status: 'error', code: 'RULE_NOT_FOUND' });
    return row;
  }

  async deleteRule(tenantId: string, ruleId: string): Promise<void> {
    const result = await this.db
      .delete(dispatchRules)
      .where(and(eq(dispatchRules.id, ruleId), eq(dispatchRules.tenantId, tenantId)))
      .returning({ id: dispatchRules.id });
    if (result.length === 0) {
      throw new NotFoundException({ status: 'error', code: 'RULE_NOT_FOUND' });
    }
  }

  async testRule(tenantId: string, ruleId: string, jobId: string): Promise<EngineResult> {
    const rule = await this.db.query.dispatchRules.findFirst({
      where: and(eq(dispatchRules.id, ruleId), eq(dispatchRules.tenantId, tenantId)),
    });
    if (!rule) throw new NotFoundException({ status: 'error', code: 'RULE_NOT_FOUND' });
    const job = await this.db.query.unifiedJobs.findFirst({
      where: and(eq(unifiedJobs.id, jobId), eq(unifiedJobs.tenantId, tenantId)),
    });
    if (!job) throw new NotFoundException({ status: 'error', code: 'JOB_NOT_FOUND' });
    return this.engine.evaluateForJob(tenantId, job as UnifiedJobRow, { dryRun: true });
  }

  async listDecisions(
    tenantId: string,
    query: { decision?: string; ruleId?: string; jobId?: string; limit?: number; offset?: number },
  ) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const filters = [eq(unifiedJobs.tenantId, tenantId)];
    if (query.decision) filters.push(eq(dispatchDecisions.decision, query.decision));
    if (query.ruleId) filters.push(eq(dispatchDecisions.ruleId, query.ruleId));
    if (query.jobId) filters.push(eq(dispatchDecisions.jobId, query.jobId));

    const where = and(...filters);
    const baseRows = await this.db
      .select({
        decision: dispatchDecisions,
        job: {
          id: unifiedJobs.id,
          source: unifiedJobs.source,
          sourceJobId: unifiedJobs.sourceJobId,
          callerName: unifiedJobs.callerName,
          pickupAddress: unifiedJobs.pickupAddress,
        },
      })
      .from(dispatchDecisions)
      .innerJoin(unifiedJobs, eq(dispatchDecisions.jobId, unifiedJobs.id))
      .where(where)
      .orderBy(desc(dispatchDecisions.decidedAt))
      .limit(limit)
      .offset(offset);

    const totalRow = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(dispatchDecisions)
      .innerJoin(unifiedJobs, eq(dispatchDecisions.jobId, unifiedJobs.id))
      .where(where);

    return {
      items: baseRows,
      total: totalRow[0]?.count ?? 0,
      limit,
      offset,
    };
  }

  async stats(tenantId: string) {
    const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const [byDecision, daily, totals, topReasons] = await Promise.all([
      this.db
        .select({
          decision: dispatchDecisions.decision,
          count: sql<number>`count(*)::int`,
        })
        .from(dispatchDecisions)
        .innerJoin(unifiedJobs, eq(dispatchDecisions.jobId, unifiedJobs.id))
        .where(eq(unifiedJobs.tenantId, tenantId))
        .groupBy(dispatchDecisions.decision),
      this.db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${dispatchDecisions.decidedAt}), 'YYYY-MM-DD')`,
          decision: dispatchDecisions.decision,
          count: sql<number>`count(*)::int`,
        })
        .from(dispatchDecisions)
        .innerJoin(unifiedJobs, eq(dispatchDecisions.jobId, unifiedJobs.id))
        .where(
          and(
            eq(unifiedJobs.tenantId, tenantId),
            gte(dispatchDecisions.decidedAt, since14),
          ),
        )
        .groupBy(
          sql`date_trunc('day', ${dispatchDecisions.decidedAt})`,
          dispatchDecisions.decision,
        )
        .orderBy(sql`date_trunc('day', ${dispatchDecisions.decidedAt})`),
      this.db
        .select({
          total: sql<number>`count(*)::int`,
          accepted: sql<number>`count(*) filter (where ${dispatchDecisions.decision} = 'accepted')::int`,
          declined: sql<number>`count(*) filter (where ${dispatchDecisions.decision} = 'declined')::int`,
          flagged: sql<number>`count(*) filter (where ${dispatchDecisions.decision} = 'flagged')::int`,
        })
        .from(dispatchDecisions)
        .innerJoin(unifiedJobs, eq(dispatchDecisions.jobId, unifiedJobs.id))
        .where(eq(unifiedJobs.tenantId, tenantId)),
      this.db
        .select({
          reason: dispatchDecisions.reason,
          count: sql<number>`count(*)::int`,
        })
        .from(dispatchDecisions)
        .innerJoin(unifiedJobs, eq(dispatchDecisions.jobId, unifiedJobs.id))
        .where(
          and(eq(unifiedJobs.tenantId, tenantId), eq(dispatchDecisions.decision, 'declined')),
        )
        .groupBy(dispatchDecisions.reason)
        .orderBy(sql`count(*) desc`)
        .limit(10),
    ]);

    const t = totals[0] ?? { total: 0, accepted: 0, declined: 0, flagged: 0 };
    const acceptRate = t.total > 0 ? Number(((t.accepted / t.total) * 100).toFixed(1)) : 0;
    return {
      totals: t,
      acceptRate,
      byDecision,
      daily,
      topDeclineReasons: topReasons,
    };
  }
}
