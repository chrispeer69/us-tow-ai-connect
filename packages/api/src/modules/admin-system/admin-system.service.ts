import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import {
  apiKeyUsageStats,
  auditLog,
  emailMessages,
  tenants,
} from '../../db/schema';
import {
  type EndpointGroup,
  THROTTLE_TIERS,
} from '../rate-limiting/throttle-tiers';

export interface SystemStats {
  tenantId: string;
  windowHours: number;
  generatedAt: string;
  rateLimit: {
    requests24h: number;
    throttled24h: number;
    byGroup: Array<{ group: string; requests: number; throttled: number }>;
  };
  audit: {
    entries24h: number;
    byAction: Array<{ action: string; count: number }>;
  };
  email: {
    sent24h: number;
    logged24h: number;
    failed24h: number;
  };
  errors: {
    errorActions24h: number;
  };
  overrides: Array<{ group: string; identifier: string; limit: number }>;
}

const OVERRIDE_KEY_PATTERN = 'throttle:override:*';

@Injectable()
export class AdminSystemService {
  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async getStats(tenantId: string, hours = 24): Promise<SystemStats> {
    const since = new Date(Date.now() - hours * 3_600_000);
    const [rateLimit, audit, email, errors, overrides] = await Promise.all([
      this.collectRateLimit(tenantId, since),
      this.collectAudit(tenantId, since),
      this.collectEmail(tenantId, since),
      this.collectErrors(tenantId, since),
      this.collectOverrides(),
    ]);
    return {
      tenantId,
      windowHours: hours,
      generatedAt: new Date().toISOString(),
      rateLimit,
      audit,
      email,
      errors,
      overrides,
    };
  }

  async setLimitOverride(
    group: EndpointGroup,
    identifier: string,
    limit: number,
    ttlSeconds: number,
  ): Promise<void> {
    if (!THROTTLE_TIERS[group]) {
      throw new Error(`Unknown throttle group: ${group}`);
    }
    if (limit < 1 || limit > 100_000) {
      throw new Error('limit must be between 1 and 100000');
    }
    const key = `throttle:override:${group}:${identifier}`;
    if (ttlSeconds > 0) {
      await this.redis.set(key, String(limit), 'EX', Math.max(60, ttlSeconds));
    } else {
      await this.redis.set(key, String(limit));
    }
  }

  async clearLimitOverride(group: EndpointGroup, identifier: string): Promise<void> {
    await this.redis.del(`throttle:override:${group}:${identifier}`);
  }

  private async collectRateLimit(tenantId: string, since: Date) {
    try {
      const rows = await this.db
        .select({
          group: apiKeyUsageStats.endpointGroup,
          requests: sql<number>`coalesce(sum(${apiKeyUsageStats.requestCount}), 0)::int`,
          throttled: sql<number>`coalesce(sum(${apiKeyUsageStats.throttledCount}), 0)::int`,
        })
        .from(apiKeyUsageStats)
        .where(
          and(
            eq(apiKeyUsageStats.tenantId, tenantId),
            gte(apiKeyUsageStats.windowStart, since),
          ),
        )
        .groupBy(apiKeyUsageStats.endpointGroup);
      const byGroup = rows.map((r) => ({
        group: r.group,
        requests: r.requests,
        throttled: r.throttled,
      }));
      const requests24h = byGroup.reduce((acc, r) => acc + r.requests, 0);
      const throttled24h = byGroup.reduce((acc, r) => acc + r.throttled, 0);
      return { requests24h, throttled24h, byGroup };
    } catch {
      return { requests24h: 0, throttled24h: 0, byGroup: [] };
    }
  }

  private async collectAudit(tenantId: string, since: Date) {
    try {
      const totalRow = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, tenantId), gte(auditLog.createdAt, since)));
      const entries24h = totalRow[0]?.count ?? 0;

      const byActionRows = await this.db
        .select({
          action: auditLog.action,
          count: sql<number>`count(*)::int`,
        })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, tenantId), gte(auditLog.createdAt, since)))
        .groupBy(auditLog.action)
        .orderBy(sql`count(*) desc`)
        .limit(10);

      return {
        entries24h,
        byAction: byActionRows.map((r) => ({ action: r.action, count: r.count })),
      };
    } catch {
      return { entries24h: 0, byAction: [] };
    }
  }

  private async collectEmail(tenantId: string, since: Date) {
    const result = { sent24h: 0, logged24h: 0, failed24h: 0 };
    try {
      const rows = await this.db
        .select({
          status: emailMessages.status,
          count: sql<number>`count(*)::int`,
        })
        .from(emailMessages)
        .where(
          and(
            eq(emailMessages.tenantId, tenantId),
            gte(emailMessages.createdAt, since),
          ),
        )
        .groupBy(emailMessages.status);
      for (const r of rows) {
        if (r.status === 'sent') result.sent24h += r.count;
        else if (r.status === 'logged_only') result.logged24h += r.count;
        else if (r.status === 'failed') result.failed24h += r.count;
      }
    } catch {
      // table absent
    }
    return result;
  }

  private async collectErrors(tenantId: string, since: Date) {
    try {
      const rows = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.tenantId, tenantId),
            gte(auditLog.createdAt, since),
            sql`${auditLog.action} like '%.failed'`,
          ),
        );
      return { errorActions24h: rows[0]?.count ?? 0 };
    } catch {
      return { errorActions24h: 0 };
    }
  }

  private async collectOverrides() {
    try {
      const keys = await scanKeys(this.redis, OVERRIDE_KEY_PATTERN, 100);
      if (keys.length === 0) return [];
      const values = await this.redis.mget(keys);
      return keys
        .map((key, idx) => {
          const parts = key.split(':');
          // throttle:override:{group}:{identifier...}
          const group = parts[2] ?? 'unknown';
          const identifier = parts.slice(3).join(':');
          const limit = parseInt(values[idx] ?? '0', 10) || 0;
          return { group, identifier, limit };
        })
        .filter((r) => r.limit > 0);
    } catch {
      return [];
    }
  }

  /** Used by /v1/admin/system/tenants — returns all tenants this admin can see. */
  async listTenants() {
    return this.db
      .select({
        id: tenants.id,
        companyName: tenants.companyName,
        isActive: tenants.isActive,
        digestFrequency: tenants.digestFrequency,
      })
      .from(tenants)
      .orderBy(tenants.companyName);
  }
}

async function scanKeys(redis: Redis, pattern: string, cap = 200): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    keys.push(...batch);
    if (keys.length >= cap) break;
  } while (cursor !== '0');
  return keys.slice(0, cap);
}
