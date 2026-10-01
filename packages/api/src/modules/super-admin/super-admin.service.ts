import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { resolveRetellTenantConfig } from '../../common/utils/retell-tenant-config';
import {
  callInteractions,
  interactionLogs,
  outboundCalls,
  retellCallUsage,
  platformSettings,
  tenantBilling,
  tenantMembers,
  tenants,
  unifiedJobs,
} from '../../db/schema';
import { ImpersonationTokenService } from './impersonation-token.service';
import { recordAudit } from '../tenant-onboarding/audit-log.helper';
import { supportTickets, supportTicketMessages } from '../../db/schema';

@Injectable()
export class SuperAdminService {
  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly tokens: ImpersonationTokenService,
  ) {}

  async listTenants() {
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const todayStart = startOfUtcDay(new Date());
    const rows = await this.db
      .select({
        id: tenants.id,
        companyName: tenants.companyName,
        ownerEmail: tenants.ownerEmail,
        partnerAccountId: tenants.partnerAccountId,
        isActive: tenants.isActive,
        createdAt: tenants.createdAt,
        outboundVoiceEnabled: tenants.outboundVoiceEnabled,
        outboundVoiceConfig: tenants.outboundVoiceConfig,
      })
      .from(tenants)
      .orderBy(desc(tenants.createdAt));

    // Aggregate active jobs + AI call usage per tenant. Separate cheap queries
    // keep the optional tables from multiplying rows in one big join.
    const activeJobCounts = await this.db
      .select({
        tenantId: unifiedJobs.tenantId,
        count: sql<number>`count(*)::int`,
      })
      .from(unifiedJobs)
      .where(sql`${unifiedJobs.status} IN ('new', 'assigned', 'en_route', 'on_scene', 'in_tow')`)
      .groupBy(unifiedJobs.tenantId);

    const aiCallsLast24h = await this.db
      .select({
        tenantId: outboundCalls.tenantId,
        count: sql<number>`count(*)::int`,
      })
      .from(outboundCalls)
      .where(gte(outboundCalls.createdAt, cutoff24h))
      .groupBy(outboundCalls.tenantId);

    const aiCallsToday = await this.db
      .select({
        tenantId: outboundCalls.tenantId,
        count: sql<number>`count(*)::int`,
      })
      .from(outboundCalls)
      .where(gte(outboundCalls.createdAt, todayStart))
      .groupBy(outboundCalls.tenantId);

    const emilyUsageToday = await this.db
      .select({
        tenantId: retellCallUsage.tenantId,
        calls: sql<number>`count(distinct ${retellCallUsage.outboundCallId})::int`,
        attempts: sql<number>`count(*)::int`,
        seconds: sql<number>`coalesce(sum(${retellCallUsage.durationSeconds}), 0)::int`,
        measuredCostCalls: sql<number>`count(${retellCallUsage.combinedCostCents})::int`,
        costCents: sql<number>`coalesce(sum(${retellCallUsage.combinedCostCents}), 0)::double precision`,
        averageLlmTokens: sql<number>`coalesce(
          case
            when sum(coalesce(${retellCallUsage.llmRequestCount}, 0)) > 0
              then sum(coalesce(${retellCallUsage.llmAverageTokens}, 0)::numeric * ${retellCallUsage.llmRequestCount})
                / sum(${retellCallUsage.llmRequestCount})
            else avg(${retellCallUsage.llmAverageTokens})
          end,
          0
        )::double precision`,
      })
      .from(retellCallUsage)
      .where(gte(retellCallUsage.createdAt, todayStart))
      .groupBy(retellCallUsage.tenantId);

    const aiCallsTotal = await this.db
      .select({
        tenantId: outboundCalls.tenantId,
        count: sql<number>`count(*)::int`,
      })
      .from(outboundCalls)
      .groupBy(outboundCalls.tenantId);

    const aiCallSecondsTotal = await this.db
      .select({
        tenantId: outboundCalls.tenantId,
        seconds: sql<number>`coalesce(sum(coalesce(${outboundCalls.durationSeconds}, 60)), 0)::int`,
      })
      .from(outboundCalls)
      .where(sql`${outboundCalls.status} <> 'cancelled'`)
      .groupBy(outboundCalls.tenantId);

    const planRows = await this.db
      .select({ tenantId: tenantBilling.tenantId, plan: tenantBilling.plan, status: tenantBilling.status })
      .from(tenantBilling);

    const activeByT = new Map(activeJobCounts.map((r) => [r.tenantId, r.count]));
    const aiCallsLast24hByT = new Map(aiCallsLast24h.map((r) => [r.tenantId, r.count]));
    const aiCallsTodayByT = new Map(aiCallsToday.map((r) => [r.tenantId, r.count]));
    const emilyUsageTodayByT = new Map(emilyUsageToday.map((r) => [r.tenantId, r]));
    const aiCallsTotalByT = new Map(aiCallsTotal.map((r) => [r.tenantId, r.count]));
    const aiCallSecondsTotalByT = new Map(
      aiCallSecondsTotal.map((r) => [r.tenantId, r.seconds]),
    );
    const billingByT = new Map(planRows.map((r) => [r.tenantId, r]));

    return rows.map((t) => {
      const emily = emilyUsageTodayByT.get(t.id);
      return {
        ...t,
        activeJobs: activeByT.get(t.id) ?? 0,
        callsLast24h: aiCallsLast24hByT.get(t.id) ?? 0,
        callsToday: aiCallsTodayByT.get(t.id) ?? 0,
        callsTotal: aiCallsTotalByT.get(t.id) ?? 0,
        callMinutesUsed: Math.round((aiCallSecondsTotalByT.get(t.id) ?? 0) / 60),
        emilyCallsToday: Number(emily?.calls ?? 0),
        emilyAttemptsToday: Number(emily?.attempts ?? 0),
        emilyRetriesToday: Math.max(
          0,
          Number(emily?.attempts ?? 0) - Number(emily?.calls ?? 0),
        ),
        emilyMinutesToday:
          Math.round((Number(emily?.seconds ?? 0) / 60) * 10) / 10,
        emilyAverageLlmTokensToday: Math.round(Number(emily?.averageLlmTokens ?? 0)),
        emilyCostTodayCents:
          Math.round(Number(emily?.costCents ?? 0) * 100) / 100,
        emilyCostMeasuredAttemptsToday: Number(emily?.measuredCostCalls ?? 0),
        plan: billingByT.get(t.id)?.plan ?? 'FREE',
        version: displayVersion(billingByT.get(t.id)?.plan),
        billingStatus: billingByT.get(t.id)?.status ?? 'ACTIVE',
        demoMode: readConfigBool(t.outboundVoiceConfig, 'demo_mode', false),
        demoCallsEnabled: readConfigBool(t.outboundVoiceConfig, 'demo_calls_enabled', false),
        testModeEnabled: readConfigBool(t.outboundVoiceConfig, 'test_mode_enabled', false),
        testOverrideNumber: readConfigString(t.outboundVoiceConfig, 'test_override_number', null),
        freeTrialCallMinutes: readConfigNumber(
          t.outboundVoiceConfig,
          'free_trial_call_minutes',
          15,
        ),
      };
    });
  }

  async listRetellCallUsage(query: {
    tenantId?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const tenantFilter = query.tenantId
      ? eq(retellCallUsage.tenantId, query.tenantId)
      : sql`true`;

    const items = await this.db
      .select({
        id: retellCallUsage.outboundCallId,
        tenantId: retellCallUsage.tenantId,
        companyName: tenants.companyName,
        outboundCallId: retellCallUsage.outboundCallId,
        latestRetellCallId: sql<string>`(array_agg(${retellCallUsage.retellCallId} order by ${retellCallUsage.createdAt} desc))[1]`,
        attemptCount: sql<number>`count(*)::int`,
        retryCount: sql<number>`greatest(count(*) - 1, 0)::int`,
        purpose: outboundCalls.purpose,
        toName: outboundCalls.toName,
        toPhone: outboundCalls.toPhone,
        status: sql<string | null>`(array_agg(${retellCallUsage.status} order by ${retellCallUsage.createdAt} desc))[1]`,
        agentId: sql<string | null>`(array_agg(${retellCallUsage.agentId} order by ${retellCallUsage.createdAt} desc))[1]`,
        agentVersion: sql<string | null>`(array_agg(${retellCallUsage.agentVersion} order by ${retellCallUsage.createdAt} desc))[1]`,
        durationSeconds: sql<number>`coalesce(sum(${retellCallUsage.durationSeconds}), 0)::int`,
        measuredCostAttempts: sql<number>`count(${retellCallUsage.combinedCostCents})::int`,
        combinedCostCents: sql<number>`coalesce(sum(${retellCallUsage.combinedCostCents}), 0)::double precision`,
        llmAverageTokens: sql<number>`coalesce(
          case
            when sum(coalesce(${retellCallUsage.llmRequestCount}, 0)) > 0
              then sum(coalesce(${retellCallUsage.llmAverageTokens}, 0)::numeric * ${retellCallUsage.llmRequestCount})
                / sum(${retellCallUsage.llmRequestCount})
            else avg(${retellCallUsage.llmAverageTokens})
          end,
          0
        )::double precision`,
        llmRequestCount: sql<number>`coalesce(sum(${retellCallUsage.llmRequestCount}), 0)::int`,
        startedAt: sql<Date | null>`min(${retellCallUsage.startedAt})`,
        endedAt: sql<Date | null>`max(${retellCallUsage.endedAt})`,
        createdAt: sql<Date>`min(${retellCallUsage.createdAt})`,
        lastAttemptAt: sql<Date>`max(${retellCallUsage.createdAt})`,
      })
      .from(retellCallUsage)
      .innerJoin(outboundCalls, eq(outboundCalls.id, retellCallUsage.outboundCallId))
      .innerJoin(tenants, eq(tenants.id, retellCallUsage.tenantId))
      .where(tenantFilter)
      .groupBy(
        retellCallUsage.tenantId,
        tenants.companyName,
        retellCallUsage.outboundCallId,
        outboundCalls.purpose,
        outboundCalls.toName,
        outboundCalls.toPhone,
      )
      .orderBy(desc(sql`max(${retellCallUsage.createdAt})`))
      .limit(limit)
      .offset(offset);

    return { items, limit, offset };
  }

  async listRetellDailyUsage(query: { tenantId?: string; days?: number }) {
    const days = Math.min(Math.max(Number(query.days) || 30, 2), 90);
    const from = startOfUtcDay(new Date(Date.now() - (days - 1) * 86_400_000));
    const tenantFilter = query.tenantId
      ? eq(retellCallUsage.tenantId, query.tenantId)
      : sql`true`;
    const rows = await this.db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${retellCallUsage.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
        calls: sql<number>`count(distinct ${retellCallUsage.outboundCallId})::int`,
        attempts: sql<number>`count(*)::int`,
        retries: sql<number>`greatest(count(*) - count(distinct ${retellCallUsage.outboundCallId}), 0)::int`,
        seconds: sql<number>`coalesce(sum(${retellCallUsage.durationSeconds}), 0)::int`,
        measuredCostAttempts: sql<number>`count(${retellCallUsage.combinedCostCents})::int`,
        costCents: sql<number>`coalesce(sum(${retellCallUsage.combinedCostCents}), 0)::double precision`,
        averageLlmTokens: sql<number>`coalesce(
          case
            when sum(coalesce(${retellCallUsage.llmRequestCount}, 0)) > 0
              then sum(coalesce(${retellCallUsage.llmAverageTokens}, 0)::numeric * ${retellCallUsage.llmRequestCount})
                / sum(${retellCallUsage.llmRequestCount})
            else avg(${retellCallUsage.llmAverageTokens})
          end,
          0
        )::double precision`,
        llmRequests: sql<number>`coalesce(sum(${retellCallUsage.llmRequestCount}), 0)::int`,
      })
      .from(retellCallUsage)
      .where(and(tenantFilter, gte(retellCallUsage.createdAt, from)))
      .groupBy(sql`date_trunc('day', ${retellCallUsage.createdAt} at time zone 'UTC')`)
      .orderBy(desc(sql`date_trunc('day', ${retellCallUsage.createdAt} at time zone 'UTC')`));

    const rowsByDay = new Map(rows.map((row) => [row.day, row]));
    const today = startOfUtcDay(new Date());
    const calendarDays = Array.from({ length: days }, (_, offset) => {
      const date = new Date(today.getTime() - offset * 86_400_000);
      const day = date.toISOString().slice(0, 10);
      const row = rowsByDay.get(day);
      return {
        day,
        calls: Number(row?.calls ?? 0),
        attempts: Number(row?.attempts ?? 0),
        retries: Number(row?.retries ?? 0),
        seconds: Number(row?.seconds ?? 0),
        measuredCostAttempts: Number(row?.measuredCostAttempts ?? 0),
        costCents: Number(row?.costCents ?? 0),
        averageLlmTokens: Number(row?.averageLlmTokens ?? 0),
        llmRequests: Number(row?.llmRequests ?? 0),
      };
    });

    return calendarDays.map((row, index) => {
      const previous = calendarDays[index + 1];
      const costCents = Number(row.costCents ?? 0);
      const previousCostCents = Number(previous?.costCents ?? 0);
      return {
        day: row.day,
        calls: row.calls,
        attempts: row.attempts,
        retries: row.retries,
        minutes: Math.round((Number(row.seconds ?? 0) / 60) * 10) / 10,
        measuredCostAttempts: row.measuredCostAttempts,
        costCents: Math.round(costCents * 100) / 100,
        averageLlmTokens: Math.round(Number(row.averageLlmTokens ?? 0)),
        llmRequests: row.llmRequests,
        costChangeCents:
          previous == null ? null : Math.round((costCents - previousCostCents) * 100) / 100,
        costChangePercent:
          previousCostCents > 0
            ? Math.round(((costCents - previousCostCents) / previousCostCents) * 1000) / 10
            : null,
        callChange: previous == null ? null : row.calls - previous.calls,
      };
    });
  }

  async getDemoCallSettings() {
    return {
      enabled: await this.readPlatformBool('public_demo_calls_enabled', false),
    };
  }

  async updateDemoCallSettings(patch: { enabled?: boolean }) {
    if (typeof patch.enabled === 'boolean') {
      await this.db
        .insert(platformSettings)
        .values({
          key: 'public_demo_calls_enabled',
          value: { enabled: patch.enabled } as never,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: platformSettings.key,
          set: {
            value: { enabled: patch.enabled } as never,
            updatedAt: new Date(),
          },
        });
    }
    return this.getDemoCallSettings();
  }

  async getTenant(tenantId: string) {
    const t = (
      await this.db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
    )[0];
    if (!t) throw new NotFoundException({ status: 'error', code: 'TENANT_NOT_FOUND', message: 'Tenant not found' });
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const callsLast24h = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(callInteractions)
      .where(and(eq(callInteractions.tenantId, tenantId), gte(callInteractions.createdAt, cutoff24h)));

    const callsLast7d = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(callInteractions)
      .where(and(eq(callInteractions.tenantId, tenantId), gte(callInteractions.createdAt, cutoff7d)));

    const activeJobs = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(unifiedJobs)
      .where(and(eq(unifiedJobs.tenantId, tenantId), sql`${unifiedJobs.status} IN ('new', 'assigned', 'en_route', 'on_scene', 'in_tow')`));

    const aiCallsLast24h = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(outboundCalls)
      .where(and(eq(outboundCalls.tenantId, tenantId), gte(outboundCalls.createdAt, cutoff24h)));

    const aiCallsLast7d = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(outboundCalls)
      .where(and(eq(outboundCalls.tenantId, tenantId), gte(outboundCalls.createdAt, cutoff7d)));

    const aiCallsTotal = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(outboundCalls)
      .where(eq(outboundCalls.tenantId, tenantId));

    const recentInteractions = await this.db
      .select({
        id: interactionLogs.id,
        category: interactionLogs.category,
        callerPhone: interactionLogs.callerPhone,
        durationSeconds: interactionLogs.durationSeconds,
        outcome: interactionLogs.outcome,
        interactionTime: interactionLogs.interactionTime,
      })
      .from(interactionLogs)
      .where(eq(interactionLogs.tenantId, tenantId))
      .orderBy(desc(interactionLogs.interactionTime))
      .limit(20);

    const members = await this.db
      .select({
        id: tenantMembers.id,
        email: tenantMembers.email,
        name: tenantMembers.name,
        role: tenantMembers.role,
        status: tenantMembers.status,
        invitedAt: tenantMembers.invitedAt,
        acceptedAt: tenantMembers.acceptedAt,
        lastLoginAt: tenantMembers.lastLoginAt,
      })
      .from(tenantMembers)
      .where(eq(tenantMembers.tenantId, tenantId))
      .orderBy(asc(tenantMembers.invitedAt));

    const billing = (
      await this.db.select().from(tenantBilling).where(eq(tenantBilling.tenantId, tenantId)).limit(1)
    )[0];
    const outboundConfig = t.outboundVoiceConfig as Record<string, unknown> | null | undefined;

    return {
      tenant: {
        ...t,
        demoMode: readConfigBool(outboundConfig, 'demo_mode', false),
        demoCallsEnabled: readConfigBool(outboundConfig, 'demo_calls_enabled', false),
        testModeEnabled: readConfigBool(outboundConfig, 'test_mode_enabled', false),
        testOverrideNumber: readConfigString(outboundConfig, 'test_override_number', null),
        freeTrialCallMinutes: readConfigNumber(
          outboundConfig,
          'free_trial_call_minutes',
          15,
        ),
        // Raw per-tenant Retell overrides (null = inherits the deployment
        // default) plus what those actually resolve to for this tenant, so the
        // operator sees the effective agent without reading env vars.
        retellAgentId: readConfigScalar(outboundConfig, 'retell_outbound_agent_id'),
        retellAgentVersion: readConfigScalar(outboundConfig, 'retell_agent_version'),
        retellFromNumber: readConfigScalar(outboundConfig, 'retell_from_number'),
        retellEffective: resolveRetellTenantConfig(outboundConfig),
      },
      stats: {
        callsLast24h: callsLast24h[0]?.count ?? 0,
        callsLast7d: callsLast7d[0]?.count ?? 0,
        aiCallsLast24h: aiCallsLast24h[0]?.count ?? 0,
        aiCallsLast7d: aiCallsLast7d[0]?.count ?? 0,
        aiCallsTotal: aiCallsTotal[0]?.count ?? 0,
        activeJobs: activeJobs[0]?.count ?? 0,
      },
      billing: billing
        ? { ...billing, version: displayVersion(billing.plan) }
        : {
            plan: 'FREE',
            status: 'ACTIVE',
            version: 'Free',
            currentPeriodEnd: null,
          },
      members,
      recentInteractions,
    };
  }

  async updateTenantDemoSettings(
    tenantId: string,
    patch: { demoMode?: boolean; demoCallsEnabled?: boolean },
  ) {
    return this.updateTenantCallControls(tenantId, patch);
  }

  async updateTenantCallControls(
    tenantId: string,
    patch: {
      outboundVoiceEnabled?: boolean;
      demoMode?: boolean;
      demoCallsEnabled?: boolean;
      freeTrialCallMinutes?: number;
      testModeEnabled?: boolean;
      testOverrideNumber?: string | null;
      // Per-tenant Retell overrides. `null` clears the override and returns the
      // tenant to the deployment default; `undefined` leaves it untouched.
      retellAgentId?: string | null;
      retellAgentVersion?: string | null;
      retellFromNumber?: string | null;
      plan?: string;
    },
  ) {
    const t = (
      await this.db
        .select({
          id: tenants.id,
          outboundVoiceEnabled: tenants.outboundVoiceEnabled,
          outboundVoiceConfig: tenants.outboundVoiceConfig,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
    )[0];
    if (!t) {
      throw new NotFoundException({
        status: 'error',
        code: 'TENANT_NOT_FOUND',
        message: 'Tenant not found',
      });
    }
    const current = (t.outboundVoiceConfig as Record<string, unknown> | null | undefined) ?? {};
    const freeTrialCallMinutes =
      patch.freeTrialCallMinutes === undefined
        ? undefined
        : Math.max(0, Math.min(10_000, Math.round(patch.freeTrialCallMinutes)));
    const next = {
      ...current,
      ...(patch.demoMode !== undefined ? { demo_mode: patch.demoMode } : {}),
      ...(patch.demoCallsEnabled !== undefined
        ? { demo_calls_enabled: patch.demoCallsEnabled }
        : {}),
      ...(freeTrialCallMinutes !== undefined
        ? { free_trial_call_minutes: freeTrialCallMinutes }
        : {}),
      ...(patch.testModeEnabled !== undefined
        ? { test_mode_enabled: patch.testModeEnabled }
        : {}),
      ...(patch.testOverrideNumber !== undefined
        ? { test_override_number: normalizeOptionalPhone(patch.testOverrideNumber) }
        : {}),
      ...(patch.retellAgentId !== undefined
        ? { retell_outbound_agent_id: normalizeOptionalText(patch.retellAgentId) }
        : {}),
      ...(patch.retellAgentVersion !== undefined
        ? { retell_agent_version: normalizeOptionalText(patch.retellAgentVersion) }
        : {}),
      ...(patch.retellFromNumber !== undefined
        ? { retell_from_number: normalizeOptionalPhone(patch.retellFromNumber) }
        : {}),
    };

    // Moving a tenant to a different agent invalidates any pinned version:
    // version numbers are scoped to an agent, so carrying the old number over
    // would pin the new agent to an unrelated script or to nothing at all.
    // Clear it unless this same patch supplies the new agent's version.
    const previousAgentId = readConfigScalar(current, 'retell_outbound_agent_id');
    const nextAgentId = readConfigScalar(next, 'retell_outbound_agent_id');
    const agentChanged = previousAgentId !== nextAgentId;
    if (agentChanged && patch.retellAgentVersion === undefined) {
      next.retell_agent_version = null;
    }

    // Not an error — an operator legitimately points a tenant at its agent
    // first and pins after publishing — but the tenant is running unpinned
    // until they do, and that is worth saying out loud.
    const effective = resolveRetellTenantConfig(next);
    const warnings: string[] = [];
    if (effective.agentId && !effective.agentVersion) {
      warnings.push(
        `Retell agent ${effective.agentId} is UNPINNED for this tenant — live calls will run its ` +
          'latest draft, and script edits will be refused. Publish a version and set it here.',
      );
    }
    if (agentChanged && patch.retellAgentVersion === undefined && previousAgentId) {
      warnings.push(
        `Cleared the pinned version because the agent changed from ${previousAgentId} to ` +
          `${nextAgentId ?? 'the deployment default'}.`,
      );
    }

    if (patch.demoMode === false) {
      next.demo_calls_enabled = false;
    }
    if (patch.demoMode !== true && next.demo_mode !== true) {
      next.demo_calls_enabled = false;
    }
    const set: Partial<typeof tenants.$inferInsert> = {
      outboundVoiceConfig: next as never,
      updatedAt: new Date(),
    };
    if (patch.outboundVoiceEnabled !== undefined) {
      set.outboundVoiceEnabled = patch.outboundVoiceEnabled;
    }
    await this.db
      .update(tenants)
      .set(set)
      .where(eq(tenants.id, tenantId));
    if (patch.plan !== undefined) {
      await this.upsertBillingPlan(tenantId, patch.plan);
    }
    const result = await this.getTenant(tenantId);
    return warnings.length ? { ...result, warnings } : result;
  }

  async listSupportTickets() {
    return this.db
      .select({
        id: supportTickets.id,
        tenantId: supportTickets.tenantId,
        companyName: tenants.companyName,
        subject: supportTickets.subject,
        description: supportTickets.description,
        status: supportTickets.status,
        resolutionMessage: supportTickets.resolutionMessage,
        createdAt: supportTickets.createdAt,
      })
      .from(supportTickets)
      .leftJoin(tenants, eq(tenants.id, supportTickets.tenantId))
      .orderBy(desc(supportTickets.createdAt));
  }

  async getSupportTicket(id: string) {
    const [ticket] = await this.db
      .select({
        id: supportTickets.id,
        tenantId: supportTickets.tenantId,
        companyName: tenants.companyName,
        subject: supportTickets.subject,
        description: supportTickets.description,
        status: supportTickets.status,
        resolutionMessage: supportTickets.resolutionMessage,
        createdAt: supportTickets.createdAt,
        updatedAt: supportTickets.updatedAt,
      })
      .from(supportTickets)
      .leftJoin(tenants, eq(tenants.id, supportTickets.tenantId))
      .where(eq(supportTickets.id, id));

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const messages = await this.db
      .select()
      .from(supportTicketMessages)
      .where(eq(supportTicketMessages.ticketId, id))
      .orderBy(asc(supportTicketMessages.createdAt));

    return { ...ticket, messages };
  }

  async updateSupportTicketStatus(id: string, status: string, resolutionMessage?: string) {
    if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) {
      throw new BadRequestException('Invalid status');
    }
    const setClause: any = { status, updatedAt: new Date() };
    if (resolutionMessage !== undefined) {
      setClause.resolutionMessage = resolutionMessage;
    }
    const result = await this.db
      .update(supportTickets)
      .set(setClause)
      .where(eq(supportTickets.id, id))
      .returning();
      
    if (!result.length) throw new NotFoundException('Ticket not found');
    return result[0];
  }

  async replyToSupportTicket(id: string, email: string, message: string) {
    const [ticket] = await this.db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, id));
    
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const [newMessage] = await this.db
      .insert(supportTicketMessages)
      .values({
        ticketId: id,
        senderType: 'super_admin',
        senderEmail: email,
        message,
      })
      .returning();

    await this.db
      .update(supportTickets)
      .set({ updatedAt: new Date() })
      .where(eq(supportTickets.id, id));

    return newMessage;
  }

  private async readPlatformBool(key: string, defaultValue: boolean) {
    const row = (
      await this.db
        .select({ value: platformSettings.value })
        .from(platformSettings)
        .where(eq(platformSettings.key, key))
        .limit(1)
    )[0];
    const value = row?.value as Record<string, unknown> | boolean | null | undefined;
    if (typeof value === 'boolean') return value;
    if (value && typeof value.enabled === 'boolean') return value.enabled;
    return defaultValue;
  }

  private async upsertBillingPlan(tenantId: string, plan: string) {
    const normalized = plan.trim().toUpperCase();
    if (!['FREE', 'TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'].includes(normalized)) {
      return;
    }
    const existing = (
      await this.db
        .select({ id: tenantBilling.id })
        .from(tenantBilling)
        .where(eq(tenantBilling.tenantId, tenantId))
        .limit(1)
    )[0];
    const now = new Date();
    if (existing) {
      await this.db
        .update(tenantBilling)
        .set({ plan: normalized, status: 'ACTIVE', updatedAt: now })
        .where(eq(tenantBilling.tenantId, tenantId));
      return;
    }
    const periodEnd = new Date(now);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    await this.db.insert(tenantBilling).values({
      tenantId,
      plan: normalized,
      status: 'ACTIVE',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    });
  }
}

function displayVersion(plan: string | null | undefined): string {
  const normalized = (plan ?? 'FREE').trim().toUpperCase();
  if (!normalized || normalized === 'TRIAL' || normalized === 'FREE') return 'Free';
  return normalized.charAt(0) + normalized.slice(1).toLowerCase();
}

function readConfigBool(
  config: unknown,
  key: string,
  fallback: boolean,
): boolean {
  const cfg = config as Record<string, unknown> | null | undefined;
  const value = cfg?.[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readConfigNumber(
  config: unknown,
  key: string,
  fallback: number,
): number {
  const cfg = config as Record<string, unknown> | null | undefined;
  const value = cfg?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readConfigString(
  config: unknown,
  key: string,
  fallback: string | null,
): string | null {
  const cfg = config as Record<string, unknown> | null | undefined;
  const value = cfg?.[key];
  return typeof value === 'string' ? value : fallback;
}

/**
 * Like readConfigString but also accepts a number, so a Retell version written
 * as `31` in jsonb still renders in the form instead of showing blank and being
 * silently cleared on the next save.
 */
function readConfigScalar(config: unknown, key: string): string | null {
  const cfg = config as Record<string, unknown> | null | undefined;
  const value = cfg?.[key];
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** Trim to a value or to null — an empty box in the UI means "no override". */
function normalizeOptionalText(value: string | null): string | null {
  if (value === null) return null;
  return value.trim() || null;
}

function normalizeOptionalPhone(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (trimmed.startsWith('+')) return trimmed;
  return `+${digits}`;
}

function startOfUtcDay(value: Date): Date {
  const result = new Date(value);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}
