import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import {
  callInteractions,
  interactionLogs,
  outboundCalls,
  platformSettings,
  tenantBilling,
  tenantMembers,
  tenants,
  unifiedJobs,
} from '../../db/schema';
import { ImpersonationTokenService } from './impersonation-token.service';
import { recordAudit } from '../tenant-onboarding/audit-log.helper';
import { supportTickets } from '../../db/schema';

@Injectable()
export class SuperAdminService {
  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly tokens: ImpersonationTokenService,
  ) {}

  async listTenants() {
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
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
    const aiCallsTotalByT = new Map(aiCallsTotal.map((r) => [r.tenantId, r.count]));
    const aiCallSecondsTotalByT = new Map(
      aiCallSecondsTotal.map((r) => [r.tenantId, r.seconds]),
    );
    const billingByT = new Map(planRows.map((r) => [r.tenantId, r]));

    return rows.map((t) => ({
      ...t,
      activeJobs: activeByT.get(t.id) ?? 0,
      callsLast24h: aiCallsLast24hByT.get(t.id) ?? 0,
      callsTotal: aiCallsTotalByT.get(t.id) ?? 0,
      callMinutesUsed: Math.round((aiCallSecondsTotalByT.get(t.id) ?? 0) / 60),
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
    }));
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
    };
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
    return this.getTenant(tenantId);
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
        createdAt: supportTickets.createdAt,
      })
      .from(supportTickets)
      .leftJoin(tenants, eq(tenants.id, supportTickets.tenantId))
      .orderBy(desc(supportTickets.createdAt));
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
