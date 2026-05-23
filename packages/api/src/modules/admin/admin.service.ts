import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, desc, asc, like, gte, lte, SQL, sql } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import {
  aiAgentConfigs,
  callInteractions,
  dispatchRequests,
  interactionLogs,
  routingRules,
  smartActions,
  tenantApiKeys,
  tenantBilling,
  tenantCredentials,
  tenantMembers,
  tenants,
} from '../../db/schema';
import { EncryptionUtil } from '../../common/utils/encryption.util';
import { AdapterFactory } from '../adapters/adapter.factory';
import type {
  AgentConfigUpdateBody,
  ApiKeyCreateBody,
  BillingPlanType,
  BillingPlanUpdateBody,
  CompanyUpdateBody,
  MemberCreateBody,
  MemberUpdateBody,
  RoutingRuleCreateBody,
  SaveCredentialsBody,
} from '@ustow/shared';

const DEFAULT_GREETING = 'Thank you for calling.';
const DEFAULT_TENANT_FALLBACK = {
  companyName: 'Default Tenant',
  ownerEmail: 'owner@example.com',
  timezone: 'America/New_York',
};

const PLAN_DETAILS: Record<
  BillingPlanType,
  {
    label: string;
    monthlyPriceCents: number;
    includedCalls: number;
    overageCentsPerCall: number;
    features: string[];
  }
> = {
  TRIAL: {
    label: 'Trial',
    monthlyPriceCents: 0,
    includedCalls: 200,
    overageCentsPerCall: 0,
    features: [
      '200 AI-handled calls / month',
      'Single integration',
      'Email support',
    ],
  },
  STARTER: {
    label: 'Starter',
    monthlyPriceCents: 19900,
    includedCalls: 1000,
    overageCentsPerCall: 25,
    features: [
      '1,000 AI-handled calls / month',
      'Up to 3 integrations',
      'Standard routing rules',
      'Email support',
    ],
  },
  PRO: {
    label: 'Pro',
    monthlyPriceCents: 49900,
    includedCalls: 5000,
    overageCentsPerCall: 18,
    features: [
      '5,000 AI-handled calls / month',
      'Unlimited integrations',
      'Advanced routing & flip logic',
      'Priority support',
    ],
  },
  ENTERPRISE: {
    label: 'Enterprise',
    monthlyPriceCents: 0,
    includedCalls: 0,
    overageCentsPerCall: 0,
    features: [
      'Custom call volume',
      'Dedicated success engineer',
      'SLA & SSO',
      'Custom contract',
    ],
  },
};

@Injectable()
export class AdminService {
  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly encryption: EncryptionUtil,
    private readonly adapters: AdapterFactory,
  ) {}

  // ─── credentials ─────────────────────────────────────────────────────
  async saveCredentials(tenantId: string, body: SaveCredentialsBody) {
    await this.ensureTenant(tenantId, body.softwareType);
    const enc = this.encryption.encryptCredentials(body.username, body.password);
    const existing = await this.db
      .select()
      .from(tenantCredentials)
      .where(eq(tenantCredentials.tenantId, tenantId))
      .limit(1);
    const now = new Date();
    if (existing[0]) {
      await this.db
        .update(tenantCredentials)
        .set({
          usernameEncrypted: enc.usernameEncrypted,
          passwordEncrypted: enc.passwordEncrypted,
          encryptionIv: enc.iv,
          authTag: enc.authTag,
          sessionStatus: 'PENDING',
          updatedAt: now,
        })
        .where(eq(tenantCredentials.tenantId, tenantId));
    } else {
      await this.db.insert(tenantCredentials).values({
        tenantId,
        usernameEncrypted: enc.usernameEncrypted,
        passwordEncrypted: enc.passwordEncrypted,
        encryptionIv: enc.iv,
        authTag: enc.authTag,
        sessionStatus: 'PENDING',
        updatedAt: now,
      });
    }
    return { status: 'success' };
  }

  async testConnection(tenantId: string) {
    const cred = (
      await this.db
        .select()
        .from(tenantCredentials)
        .where(eq(tenantCredentials.tenantId, tenantId))
        .limit(1)
    )[0];
    if (!cred) {
      throw new NotFoundException({
        status: 'error',
        code: 'NO_CREDENTIALS',
        message: 'No credentials saved for tenant',
      });
    }
    const tenant = await this.db
      .select({ softwareType: tenants.targetSoftwareType })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const softwareType = tenant[0]?.softwareType ?? 'TOWBOOK';
    const decoded = this.encryption.decrypt(
      cred.usernameEncrypted,
      cred.passwordEncrypted,
      cred.encryptionIv,
      cred.authTag,
    );
    const adapter = this.adapters.getAdapter(softwareType);
    const result = await adapter.testConnection(decoded);
    const next = result.success ? 'ACTIVE' : 'FAILED';
    await this.db
      .update(tenantCredentials)
      .set({
        sessionStatus: next,
        lastLoginSuccess: result.success ? new Date() : cred.lastLoginSuccess,
        updatedAt: new Date(),
      })
      .where(eq(tenantCredentials.tenantId, tenantId));
    return result;
  }

  async getIntegrationStatus(tenantId: string) {
    const cred = (
      await this.db
        .select()
        .from(tenantCredentials)
        .where(eq(tenantCredentials.tenantId, tenantId))
        .limit(1)
    )[0];
    const tenant = await this.db
      .select({ softwareType: tenants.targetSoftwareType })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return {
      softwareType: tenant[0]?.softwareType ?? 'TOWBOOK',
      hasCredentials: !!cred,
      sessionStatus: cred?.sessionStatus ?? 'NEW',
      lastLoginSuccess: cred?.lastLoginSuccess ?? null,
    };
  }

  // ─── routing rules ──────────────────────────────────────────────────
  async getRoutingRules(tenantId: string) {
    return this.db
      .select()
      .from(routingRules)
      .where(eq(routingRules.tenantId, tenantId))
      .orderBy(asc(routingRules.priorityOrder));
  }

  async createRoutingRule(tenantId: string, body: RoutingRuleCreateBody) {
    const existing = await this.getRoutingRules(tenantId);
    const inserted = await this.db
      .insert(routingRules)
      .values({
        tenantId,
        ruleName: body.ruleName,
        phoneNumber: body.phoneNumber,
        isActiveNow: existing.length === 0,
        priorityOrder: existing.length,
      })
      .returning();
    return inserted[0];
  }

  async activateRule(tenantId: string, ruleId: string) {
    const target = (
      await this.db
        .select()
        .from(routingRules)
        .where(and(eq(routingRules.id, ruleId), eq(routingRules.tenantId, tenantId)))
        .limit(1)
    )[0];
    if (!target) {
      throw new NotFoundException({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Rule not found',
      });
    }
    await this.db
      .update(routingRules)
      .set({ isActiveNow: false })
      .where(eq(routingRules.tenantId, tenantId));
    await this.db
      .update(routingRules)
      .set({ isActiveNow: true })
      .where(eq(routingRules.id, ruleId));
    return { ...target, isActiveNow: true };
  }

  async deleteRule(tenantId: string, ruleId: string) {
    const target = (
      await this.db
        .select()
        .from(routingRules)
        .where(and(eq(routingRules.id, ruleId), eq(routingRules.tenantId, tenantId)))
        .limit(1)
    )[0];
    if (!target) {
      throw new NotFoundException({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Rule not found',
      });
    }
    await this.db
      .delete(routingRules)
      .where(and(eq(routingRules.id, ruleId), eq(routingRules.tenantId, tenantId)));
    if (target.isActiveNow) {
      const next = (
        await this.db
          .select()
          .from(routingRules)
          .where(eq(routingRules.tenantId, tenantId))
          .orderBy(asc(routingRules.priorityOrder))
          .limit(1)
      )[0];
      if (next) {
        await this.db
          .update(routingRules)
          .set({ isActiveNow: true })
          .where(eq(routingRules.id, next.id));
      }
    }
    return { status: 'success' };
  }

  // ─── interaction logs ───────────────────────────────────────────────
  async getInteractionLogs(
    tenantId: string,
    query: {
      page?: string;
      limit?: string;
      category?: string;
      search?: string;
      date_from?: string;
      date_to?: string;
      format?: string;
    },
  ) {
    const page = Math.max(1, Number(query.page ?? 1));
    const rawLimit = Number(query.limit ?? 25);
    const limit = Math.min(Math.max(rawLimit || 25, 1), 100);

    const conditions: SQL[] = [eq(interactionLogs.tenantId, tenantId)];
    if (query.category) conditions.push(eq(interactionLogs.category, query.category));
    if (query.date_from) conditions.push(gte(interactionLogs.interactionTime, new Date(query.date_from)));
    if (query.date_to) conditions.push(lte(interactionLogs.interactionTime, new Date(query.date_to)));
    if (query.search) {
      const needle = `%${query.search}%`;
      conditions.push(
        sql`(${interactionLogs.callerPhone} ILIKE ${needle} OR ${interactionLogs.thinkrrCallId} ILIKE ${needle} OR ${interactionLogs.summary} ILIKE ${needle})`,
      );
    }
    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

    const totalRow = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(interactionLogs)
      .where(whereClause);
    const total = totalRow[0]?.count ?? 0;

    const items = await this.db
      .select()
      .from(interactionLogs)
      .where(whereClause)
      .orderBy(desc(interactionLogs.interactionTime))
      .limit(query.format === 'csv' ? 10_000 : limit)
      .offset(query.format === 'csv' ? 0 : (page - 1) * limit);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  // ─── call interactions (Session 23 raw Thinkrr payloads) ───────────
  async listCallInteractions(
    tenantId: string,
    query: { page?: string; limit?: string },
  ) {
    const page = Math.max(1, Number(query.page ?? 1));
    const rawLimit = Number(query.limit ?? 25);
    const limit = Math.min(Math.max(rawLimit || 25, 1), 100);
    const totalRow = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(callInteractions)
      .where(eq(callInteractions.tenantId, tenantId));
    const total = totalRow[0]?.count ?? 0;
    const items = await this.db
      .select()
      .from(callInteractions)
      .where(eq(callInteractions.tenantId, tenantId))
      .orderBy(desc(callInteractions.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async listSmartActions(tenantId: string, query: { page?: string; limit?: string }) {
    const page = Math.max(1, Number(query.page ?? 1));
    const rawLimit = Number(query.limit ?? 25);
    const limit = Math.min(Math.max(rawLimit || 25, 1), 100);
    const totalRow = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(smartActions)
      .where(eq(smartActions.tenantId, tenantId));
    const total = totalRow[0]?.count ?? 0;
    const items = await this.db
      .select()
      .from(smartActions)
      .where(eq(smartActions.tenantId, tenantId))
      .orderBy(desc(smartActions.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async listDispatchRequests(
    tenantId: string,
    query: { page?: string; limit?: string },
  ) {
    const page = Math.max(1, Number(query.page ?? 1));
    const rawLimit = Number(query.limit ?? 25);
    const limit = Math.min(Math.max(rawLimit || 25, 1), 100);
    const totalRow = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(dispatchRequests)
      .where(eq(dispatchRequests.tenantId, tenantId));
    const total = totalRow[0]?.count ?? 0;
    const items = await this.db
      .select()
      .from(dispatchRequests)
      .where(eq(dispatchRequests.tenantId, tenantId))
      .orderBy(desc(dispatchRequests.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  // ─── agent config ───────────────────────────────────────────────────
  async getAgentConfig(tenantId: string) {
    const existing = (
      await this.db
        .select()
        .from(aiAgentConfigs)
        .where(eq(aiAgentConfigs.tenantId, tenantId))
        .limit(1)
    )[0];
    if (existing) return existing;
    return {
      tenantId,
      greetingMessage: DEFAULT_GREETING,
      serviceToggles: {},
      defaultEtaMins: 45,
      impoundEnabled: false,
    };
  }

  async updateAgentConfig(tenantId: string, body: AgentConfigUpdateBody) {
    await this.ensureTenant(tenantId);
    const existing = (
      await this.db
        .select()
        .from(aiAgentConfigs)
        .where(eq(aiAgentConfigs.tenantId, tenantId))
        .limit(1)
    )[0];
    const now = new Date();
    if (existing) {
      await this.db
        .update(aiAgentConfigs)
        .set({
          greetingMessage: body.greetingMessage,
          serviceToggles: body.serviceToggles,
          defaultEtaMins: body.defaultEtaMins,
          impoundEnabled: body.impoundEnabled ?? existing.impoundEnabled,
          updatedAt: now,
        })
        .where(eq(aiAgentConfigs.tenantId, tenantId));
    } else {
      await this.db.insert(aiAgentConfigs).values({
        tenantId,
        greetingMessage: body.greetingMessage,
        serviceToggles: body.serviceToggles,
        defaultEtaMins: body.defaultEtaMins,
        impoundEnabled: body.impoundEnabled ?? false,
        updatedAt: now,
      });
    }
    return this.getAgentConfig(tenantId);
  }

  // ─── company ────────────────────────────────────────────────────────
  async getCompany(tenantId: string) {
    await this.ensureTenant(tenantId);
    const row = (
      await this.db
        .select({
          id: tenants.id,
          companyName: tenants.companyName,
          ownerEmail: tenants.ownerEmail,
          timezone: tenants.timezone,
          targetSoftwareType: tenants.targetSoftwareType,
          assignedPhoneNumber: tenants.assignedPhoneNumber,
          thinkrrAgentId: tenants.thinkrrAgentId,
          apiKeyPrefix: tenants.apiKeyPrefix,
          isActive: tenants.isActive,
          createdAt: tenants.createdAt,
          updatedAt: tenants.updatedAt,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
    )[0];
    if (!row) {
      throw new NotFoundException({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Tenant not found',
      });
    }
    return row;
  }

  async updateCompany(tenantId: string, body: CompanyUpdateBody) {
    await this.ensureTenant(tenantId);
    await this.db
      .update(tenants)
      .set({
        companyName: body.companyName,
        ownerEmail: body.ownerEmail,
        timezone: body.timezone,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));
    return this.getCompany(tenantId);
  }

  // ─── members ────────────────────────────────────────────────────────
  async listMembers(tenantId: string) {
    await this.ensureTenant(tenantId);
    return this.db
      .select()
      .from(tenantMembers)
      .where(eq(tenantMembers.tenantId, tenantId))
      .orderBy(asc(tenantMembers.invitedAt));
  }

  async inviteMember(tenantId: string, body: MemberCreateBody) {
    await this.ensureTenant(tenantId);
    const normalizedEmail = body.email.trim().toLowerCase();
    const dup = (
      await this.db
        .select({ id: tenantMembers.id })
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.tenantId, tenantId),
            sql`lower(${tenantMembers.email}) = ${normalizedEmail}`,
          ),
        )
        .limit(1)
    )[0];
    if (dup) {
      throw new ConflictException({
        status: 'error',
        code: 'MEMBER_EXISTS',
        message: 'A member with that email already exists',
      });
    }
    const inserted = await this.db
      .insert(tenantMembers)
      .values({
        tenantId,
        email: normalizedEmail,
        name: body.name ?? null,
        role: body.role,
        status: 'INVITED',
      })
      .returning();
    return inserted[0];
  }

  async updateMember(tenantId: string, memberId: string, body: MemberUpdateBody) {
    const target = (
      await this.db
        .select()
        .from(tenantMembers)
        .where(
          and(eq(tenantMembers.id, memberId), eq(tenantMembers.tenantId, tenantId)),
        )
        .limit(1)
    )[0];
    if (!target) {
      throw new NotFoundException({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Member not found',
      });
    }
    if (target.role === 'OWNER' && body.role && body.role !== 'OWNER') {
      const otherOwners = (
        await this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(tenantMembers)
          .where(
            and(
              eq(tenantMembers.tenantId, tenantId),
              eq(tenantMembers.role, 'OWNER'),
            ),
          )
      )[0]?.count ?? 0;
      if (otherOwners <= 1) {
        throw new ConflictException({
          status: 'error',
          code: 'LAST_OWNER',
          message: 'Cannot demote the last owner',
        });
      }
    }
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.role !== undefined) patch.role = body.role;
    if (body.status !== undefined) patch.status = body.status;
    if (Object.keys(patch).length === 0) return target;
    const updated = await this.db
      .update(tenantMembers)
      .set(patch)
      .where(eq(tenantMembers.id, memberId))
      .returning();
    return updated[0];
  }

  async removeMember(tenantId: string, memberId: string) {
    const target = (
      await this.db
        .select()
        .from(tenantMembers)
        .where(
          and(eq(tenantMembers.id, memberId), eq(tenantMembers.tenantId, tenantId)),
        )
        .limit(1)
    )[0];
    if (!target) {
      throw new NotFoundException({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Member not found',
      });
    }
    if (target.role === 'OWNER') {
      const otherOwners = (
        await this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(tenantMembers)
          .where(
            and(
              eq(tenantMembers.tenantId, tenantId),
              eq(tenantMembers.role, 'OWNER'),
            ),
          )
      )[0]?.count ?? 0;
      if (otherOwners <= 1) {
        throw new ConflictException({
          status: 'error',
          code: 'LAST_OWNER',
          message: 'Cannot remove the last owner',
        });
      }
    }
    await this.db.delete(tenantMembers).where(eq(tenantMembers.id, memberId));
    return { status: 'success' };
  }

  // ─── api keys ───────────────────────────────────────────────────────
  async listApiKeys(tenantId: string) {
    await this.ensureTenant(tenantId);
    const rows = await this.db
      .select({
        id: tenantApiKeys.id,
        name: tenantApiKeys.name,
        keyPrefix: tenantApiKeys.keyPrefix,
        createdAt: tenantApiKeys.createdAt,
        lastUsedAt: tenantApiKeys.lastUsedAt,
        revokedAt: tenantApiKeys.revokedAt,
      })
      .from(tenantApiKeys)
      .where(eq(tenantApiKeys.tenantId, tenantId))
      .orderBy(desc(tenantApiKeys.createdAt));
    return rows;
  }

  async createApiKey(tenantId: string, body: ApiKeyCreateBody) {
    await this.ensureTenant(tenantId);
    const secret = randomBytes(24).toString('hex');
    const plaintext = `usk_${secret}`;
    const keyPrefix = plaintext.slice(0, 12);
    const keyHash = await bcrypt.hash(plaintext, 10);
    const inserted = await this.db
      .insert(tenantApiKeys)
      .values({
        tenantId,
        name: body.name,
        keyHash,
        keyPrefix,
      })
      .returning({
        id: tenantApiKeys.id,
        name: tenantApiKeys.name,
        keyPrefix: tenantApiKeys.keyPrefix,
        createdAt: tenantApiKeys.createdAt,
        lastUsedAt: tenantApiKeys.lastUsedAt,
        revokedAt: tenantApiKeys.revokedAt,
      });
    return { ...inserted[0], plaintext };
  }

  async revokeApiKey(tenantId: string, keyId: string) {
    const target = (
      await this.db
        .select()
        .from(tenantApiKeys)
        .where(
          and(eq(tenantApiKeys.id, keyId), eq(tenantApiKeys.tenantId, tenantId)),
        )
        .limit(1)
    )[0];
    if (!target) {
      throw new NotFoundException({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'API key not found',
      });
    }
    if (target.revokedAt) {
      return { status: 'success' };
    }
    await this.db
      .update(tenantApiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(tenantApiKeys.id, keyId));
    return { status: 'success' };
  }

  async deleteApiKey(tenantId: string, keyId: string) {
    const target = (
      await this.db
        .select()
        .from(tenantApiKeys)
        .where(
          and(eq(tenantApiKeys.id, keyId), eq(tenantApiKeys.tenantId, tenantId)),
        )
        .limit(1)
    )[0];
    if (!target) {
      throw new NotFoundException({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'API key not found',
      });
    }
    await this.db.delete(tenantApiKeys).where(eq(tenantApiKeys.id, keyId));
    return { status: 'success' };
  }

  // ─── billing ────────────────────────────────────────────────────────
  async getBilling(tenantId: string) {
    await this.ensureTenant(tenantId);
    const billing = await this.ensureBilling(tenantId);

    const totalRow = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(interactionLogs)
      .where(
        and(
          eq(interactionLogs.tenantId, tenantId),
          gte(interactionLogs.interactionTime, billing.currentPeriodStart),
          lte(interactionLogs.interactionTime, billing.currentPeriodEnd),
        ),
      );
    const periodCalls = totalRow[0]?.count ?? 0;

    const minutesRow = await this.db
      .select({
        seconds: sql<number>`coalesce(sum(${interactionLogs.durationSeconds}), 0)::int`,
      })
      .from(interactionLogs)
      .where(
        and(
          eq(interactionLogs.tenantId, tenantId),
          gte(interactionLogs.interactionTime, billing.currentPeriodStart),
          lte(interactionLogs.interactionTime, billing.currentPeriodEnd),
        ),
      );
    const periodSeconds = minutesRow[0]?.seconds ?? 0;

    return {
      plan: billing.plan as BillingPlanType,
      status: billing.status,
      currentPeriodStart: billing.currentPeriodStart,
      currentPeriodEnd: billing.currentPeriodEnd,
      cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
      stripeCustomerId: billing.stripeCustomerId,
      planDetails: PLAN_DETAILS[billing.plan as BillingPlanType] ?? PLAN_DETAILS.TRIAL,
      usage: {
        calls: periodCalls,
        minutes: Math.round(periodSeconds / 60),
        seconds: periodSeconds,
      },
    };
  }

  async updateBillingPlan(tenantId: string, body: BillingPlanUpdateBody) {
    await this.ensureTenant(tenantId);
    await this.ensureBilling(tenantId);
    await this.db
      .update(tenantBilling)
      .set({ plan: body.plan, updatedAt: new Date() })
      .where(eq(tenantBilling.tenantId, tenantId));
    return this.getBilling(tenantId);
  }

  private async ensureBilling(tenantId: string) {
    const existing = (
      await this.db
        .select()
        .from(tenantBilling)
        .where(eq(tenantBilling.tenantId, tenantId))
        .limit(1)
    )[0];
    if (existing) return existing;
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    const inserted = await this.db
      .insert(tenantBilling)
      .values({
        tenantId,
        plan: 'TRIAL',
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      })
      .returning();
    return inserted[0];
  }

  // ─── helpers ────────────────────────────────────────────────────────
  private async ensureTenant(tenantId: string, softwareType?: string) {
    const existing = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (existing[0]) {
      if (softwareType && existing[0].targetSoftwareType !== softwareType) {
        await this.db
          .update(tenants)
          .set({ targetSoftwareType: softwareType, updatedAt: new Date() })
          .where(eq(tenants.id, tenantId));
      }
      return;
    }
    await this.db.insert(tenants).values({
      id: tenantId,
      companyName: DEFAULT_TENANT_FALLBACK.companyName,
      ownerEmail: DEFAULT_TENANT_FALLBACK.ownerEmail,
      timezone: DEFAULT_TENANT_FALLBACK.timezone,
      targetSoftwareType: softwareType ?? 'TOWBOOK',
      apiKeyHash: `bootstrap-${tenantId}`,
      apiKeyPrefix: 'usk_boot',
    });
  }
}
