import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, desc, asc, like, gte, lte, SQL, sql } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
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
  tenants,
} from '../../db/schema';
import { EncryptionUtil } from '../../common/utils/encryption.util';
import { AdapterFactory } from '../adapters/adapter.factory';
import { classifyFailure } from '../session-manager/classify-failure';
import type {
  AgentConfigUpdateBody,
  ApiKeyCreateBody,
  BillingPlanType,
  BillingPlanUpdateBody,
  CompanyUpdateBody,
  RoutingRuleCreateBody,
  SaveCredentialsBody,
} from '@ustow/shared';

const DEFAULT_GREETING = 'Thank you for calling.';
const AGENT_SETTINGS_KEY = '__settings';
const DEFAULT_OUTBOUND_CALL_MODE = 'AUTO';
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
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly encryption: EncryptionUtil,
    private readonly adapters: AdapterFactory,
  ) {}

  // ─── credentials ─────────────────────────────────────────────────────
  async saveCredentials(tenantId: string, body: SaveCredentialsBody) {
    try {
      await this.ensureTenant(tenantId, body.softwareType);
      const usernameHash = createHash('sha256').update(body.username).digest('hex');

      // 1. Verify credentials live BEFORE allowing a possible reassignment to prevent DoS
      const adapter = this.adapters.getAdapter(body.softwareType);
      const testResult = await adapter.testConnection({ username: body.username, password: body.password });
      if (!testResult.success) {
        throw new BadRequestException(`Invalid credentials: ${testResult.message}`);
      }

      // 2. Check if this Towbook account is already connected to another tenant
      const existingHash = await this.db
        .select()
        .from(tenantCredentials)
        .where(eq(tenantCredentials.usernameHash, usernameHash))
        .limit(1);
      
      let warning: string | undefined = undefined;
      if (existingHash[0] && existingHash[0].tenantId !== tenantId) {
        // Disconnect old tenant
        await this.deleteCredentials(existingHash[0].tenantId, existingHash[0].softwareType);
        warning = 'Previously associated account was disconnected. To share this integration, use the Members tab to invite users to a single workspace.';
      }

      const enc = this.encryption.encryptCredentials(body.username, body.password);
      const existing = await this.db
        .select()
        .from(tenantCredentials)
        .where(
          and(
            eq(tenantCredentials.tenantId, tenantId),
            eq(tenantCredentials.softwareType, body.softwareType)
          )
        )
        .limit(1);
      const now = new Date();
      if (existing[0]) {
        await this.db
          .update(tenantCredentials)
          .set({
            usernameEncrypted: enc.usernameEncrypted,
            passwordEncrypted: enc.passwordEncrypted,
            usernameHash,
            encryptionIv: enc.iv,
            authTag: enc.authTag,
            sessionStatus: 'PENDING',
            updatedAt: now,
          })
          .where(eq(tenantCredentials.id, existing[0].id));
      } else {
        await this.db.insert(tenantCredentials).values({
          tenantId,
          softwareType: body.softwareType,
          usernameEncrypted: enc.usernameEncrypted,
          passwordEncrypted: enc.passwordEncrypted,
          usernameHash,
          encryptionIv: enc.iv,
          authTag: enc.authTag,
          sessionStatus: 'PENDING',
          updatedAt: now,
        });
      }
      return { status: 'success', warning };
    } catch (err) {
      this.logger.error(`saveCredentials failed for tenant ${tenantId}: ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }
  }

  async deleteCredentials(tenantId: string, softwareType: string) {
    try {
      // 1. Delete credentials from Postgres database
      await this.db
        .delete(tenantCredentials)
        .where(
          and(
            eq(tenantCredentials.tenantId, tenantId),
            eq(tenantCredentials.softwareType, softwareType)
          )
        );

      // 2. Clear Redis session and active jobs caches
      const software = softwareType.toLowerCase();
      
      await this.redis.del(`session:${software}:${tenantId}`);
      await this.redis.del(`jobs:${software}:${tenantId}`);

      this.logger.log(`Successfully disconnected ${softwareType} credentials for tenant ${tenantId}`);
      return { status: 'success' };
    } catch (err) {
      this.logger.error(`deleteCredentials failed for tenant ${tenantId} (${softwareType}): ${(err as Error).message}`);
      throw err;
    }
  }

  async pauseIntegration(tenantId: string, softwareType: string) {
    try {
      await this.db
        .update(tenantCredentials)
        .set({ sessionStatus: 'PAUSED', updatedAt: new Date() })
        .where(
          and(
            eq(tenantCredentials.tenantId, tenantId),
            eq(tenantCredentials.softwareType, softwareType)
          )
        );
      
      // Clear current Redis active jobs cache to keep UI empty while paused
      const software = softwareType.toLowerCase();
      await this.redis.del(`jobs:${software}:${tenantId}`);

      this.logger.log(`Tenant ${tenantId} ${softwareType} integration paused.`);
      return { status: 'success' };
    } catch (err) {
      this.logger.error(`pauseIntegration failed for tenant ${tenantId} (${softwareType}): ${(err as Error).message}`);
      throw err;
    }
  }

  async resumeIntegration(tenantId: string, softwareType: string) {
    try {
      await this.db
        .update(tenantCredentials)
        .set({ sessionStatus: 'ACTIVE', updatedAt: new Date() })
        .where(
          and(
            eq(tenantCredentials.tenantId, tenantId),
            eq(tenantCredentials.softwareType, softwareType)
          )
        );
      
      this.logger.log(`Tenant ${tenantId} ${softwareType} integration resumed.`);
      return { status: 'success' };
    } catch (err) {
      this.logger.error(`resumeIntegration failed for tenant ${tenantId} (${softwareType}): ${(err as Error).message}`);
      throw err;
    }
  }

  async testConnection(tenantId: string, softwareType: string) {
    const cred = (
      await this.db
        .select()
        .from(tenantCredentials)
        .where(
          and(
            eq(tenantCredentials.tenantId, tenantId),
            eq(tenantCredentials.softwareType, softwareType)
          )
        )
        .limit(1)
    )[0];
    if (!cred) {
      throw new NotFoundException({
        status: 'error',
        code: 'NO_CREDENTIALS',
        message: 'No credentials saved for tenant',
      });
    }

    const decoded = this.encryption.decrypt(
      cred.usernameEncrypted,
      cred.passwordEncrypted,
      cred.encryptionIv,
      cred.authTag,
    );
    const adapter = this.adapters.getAdapter(softwareType);
    const result = await adapter.testConnection(decoded);
    const next = result.success ? 'ACTIVE' : 'FAILED';
    const failureReason = result.success ? null : (result.message ?? '').slice(0, 2000);
    const failureKind = result.success ? null : classifyFailure(result.message ?? '');
    await this.db
      .update(tenantCredentials)
      .set({
        sessionStatus: next,
        lastLoginSuccess: result.success ? new Date() : cred.lastLoginSuccess,
        updatedAt: new Date(),
        failureReason,
        failureKind,
        lastFailureAt: result.success ? null : new Date(),
        failedLoginCount: result.success
          ? 0
          : sql`${tenantCredentials.failedLoginCount} + 1`,
      })
      .where(eq(tenantCredentials.id, cred.id));
    return result;
  }

  async getIntegrationStatus(tenantId: string) {
    const creds = await this.db
        .select()
        .from(tenantCredentials)
        .where(eq(tenantCredentials.tenantId, tenantId));

    return creds.map(cred => {
      let username: string | null = null;
      try {
        const decoded = this.encryption.decrypt(
          cred.usernameEncrypted,
          cred.passwordEncrypted,
          cred.encryptionIv,
          cred.authTag,
        );
        username = decoded.username;
      } catch (err) {
        this.logger.warn(`Failed to decrypt username for tenant ${tenantId} status view`);
      }

      return {
        softwareType: cred.softwareType,
        hasCredentials: true,
        sessionStatus: cred.sessionStatus,
        lastLoginSuccess: cred.lastLoginSuccess ?? null,
        username,
        failureReason: cred.failureReason ?? null,
        failureKind: cred.failureKind ?? null,
        failedLoginCount: cred.failedLoginCount ?? 0,
        lastFailureAt: cred.lastFailureAt ?? null,
      };
    });
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
    const [existing, tenant] = await Promise.all([
      this.db
        .select()
        .from(aiAgentConfigs)
        .where(eq(aiAgentConfigs.tenantId, tenantId))
        .limit(1)
        .then((res) => res[0]),
      this.db
        .select({
          outboundVoiceEnabled: tenants.outboundVoiceEnabled,
          outboundVoiceConfig: tenants.outboundVoiceConfig,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
        .then((res) => res[0]),
    ]);

    const defaultMode = tenant?.outboundVoiceEnabled ? 'AUTO' : 'OFF';

    if (existing) {
      let mode = readOutboundCallMode(existing.serviceToggles);
      if (mode === DEFAULT_OUTBOUND_CALL_MODE && !tenant?.outboundVoiceEnabled) {
        mode = 'OFF';
      }
      return {
        ...existing,
        serviceToggles: stripAgentSettings(existing.serviceToggles),
        outboundCallMode: mode,
        testModeEnabled: readConfigBool(tenant?.outboundVoiceConfig, 'test_mode_enabled', false),
        testOverrideNumber: readConfigString(tenant?.outboundVoiceConfig, 'test_override_number', null),
      };
    }

    return {
      tenantId,
      greetingMessage: DEFAULT_GREETING,
      serviceToggles: {},
      defaultEtaMins: 45,
      impoundEnabled: false,
      outboundCallMode: defaultMode,
      testModeEnabled: readConfigBool(tenant?.outboundVoiceConfig, 'test_mode_enabled', false),
      testOverrideNumber: readConfigString(tenant?.outboundVoiceConfig, 'test_override_number', null),
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
    const serviceToggles = withAgentSettings(body.serviceToggles, {
      outboundCallMode: body.outboundCallMode ?? readOutboundCallMode(existing?.serviceToggles),
    });
    if (body.outboundCallMode) {
      const tenantRows = await this.db
        .select({ outboundVoiceConfig: tenants.outboundVoiceConfig })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      const currentConfig =
        (tenantRows[0]?.outboundVoiceConfig as Record<string, unknown> | null | undefined) ?? {};
      const nextConfig = {
        ...currentConfig,
        ...(typeof body.testModeEnabled === 'boolean'
          ? { test_mode_enabled: body.testModeEnabled }
          : {}),
        ...(body.testOverrideNumber !== undefined
          ? { test_override_number: normalizeOptionalPhone(body.testOverrideNumber) }
          : {}),
      };
      await this.db
        .update(tenants)
        .set({
          outboundVoiceEnabled: body.outboundCallMode !== 'OFF',
          outboundVoiceConfig: nextConfig as never,
          updatedAt: now,
        })
        .where(eq(tenants.id, tenantId));
    } else if (
      typeof body.testModeEnabled === 'boolean' ||
      body.testOverrideNumber !== undefined
    ) {
      const tenantRows = await this.db
        .select({ outboundVoiceConfig: tenants.outboundVoiceConfig })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      const currentConfig =
        (tenantRows[0]?.outboundVoiceConfig as Record<string, unknown> | null | undefined) ?? {};
      const nextConfig = {
        ...currentConfig,
        ...(typeof body.testModeEnabled === 'boolean'
          ? { test_mode_enabled: body.testModeEnabled }
          : {}),
        ...(body.testOverrideNumber !== undefined
          ? { test_override_number: normalizeOptionalPhone(body.testOverrideNumber) }
          : {}),
      };
      await this.db
        .update(tenants)
        .set({
          outboundVoiceConfig: nextConfig as never,
          updatedAt: now,
        })
        .where(eq(tenants.id, tenantId));
    }
    if (existing) {
      await this.db
        .update(aiAgentConfigs)
        .set({
          greetingMessage: body.greetingMessage,
          serviceToggles: serviceToggles as never,
          defaultEtaMins: body.defaultEtaMins,
          impoundEnabled: body.impoundEnabled ?? existing.impoundEnabled,
          updatedAt: now,
        })
        .where(eq(aiAgentConfigs.tenantId, tenantId));
    } else {
      await this.db.insert(aiAgentConfigs).values({
        tenantId,
        greetingMessage: body.greetingMessage,
        serviceToggles: serviceToggles as never,
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
          managerPhones: tenants.managerPhones,
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
        ...(body.managerPhones ? { managerPhones: body.managerPhones as unknown as never } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));
    return this.getCompany(tenantId);
  }

  // ─── members ────────────────────────────────────────────────────────
  // Moved to the dedicated MembersModule in Session 45 (real RBAC). The
  // routes (/v1/admin/members) now live in members.controller.ts; leaving the
  // handlers here would silently shadow them. See docs/sessions/S45_DECISIONS.md.

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

function readOutboundCallMode(serviceToggles: unknown): 'AUTO' | 'MANUAL_ONLY' | 'OFF' {
  const settings = (serviceToggles as Record<string, unknown> | null | undefined)?.[AGENT_SETTINGS_KEY] as
    | { outboundCallMode?: unknown }
    | undefined;
  if (
    settings?.outboundCallMode === 'AUTO' ||
    settings?.outboundCallMode === 'MANUAL_ONLY' ||
    settings?.outboundCallMode === 'OFF'
  ) {
    return settings.outboundCallMode;
  }
  return DEFAULT_OUTBOUND_CALL_MODE;
}

function stripAgentSettings(serviceToggles: unknown): Record<string, unknown> {
  const input = { ...((serviceToggles as Record<string, unknown> | null | undefined) ?? {}) };
  delete input[AGENT_SETTINGS_KEY];
  return input;
}

function withAgentSettings(
  serviceToggles: Record<string, unknown>,
  settings: { outboundCallMode: 'AUTO' | 'MANUAL_ONLY' | 'OFF' },
): Record<string, unknown> {
  return {
    ...serviceToggles,
    [AGENT_SETTINGS_KEY]: settings,
  };
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
