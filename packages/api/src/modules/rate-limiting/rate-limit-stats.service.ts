import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { apiKeyUsageStats } from '../../db/schema';
import { tenants, tenantApiKeys } from '../../db/schema';
import { eq } from 'drizzle-orm';

/**
 * Periodically flushes per-window throttle counters from Redis into Postgres.
 *
 * Redis hash key shape (set by ApiKeyThrottlerGuard.windowKey):
 *   throttle:stats:{epoch_seconds_floor_5m}:{group}:{identifier}
 *
 * Each hash has two fields: `requests` and `throttled`. We scan every 5 min,
 * pull all keys whose window is at least 5 min in the past (i.e. closed),
 * upsert them into api_key_usage_stats, then DEL the Redis keys. Same-window
 * keys are left alone so the live counter is never raced.
 *
 * Tenant / api-key resolution is best-effort:
 *   - if identifier is a 12-char prefix and matches a tenant_api_keys row,
 *     attribute to that key + its tenant
 *   - else if it matches tenants.api_key_prefix, attribute to the tenant
 *     (legacy single-key)
 *   - else leave tenant_id / api_key_id null
 */
@Injectable()
export class RateLimitStatsService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimitStatsService.name);
  private scanning = false;
  private destroyed = false;

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onModuleDestroy() {
    this.destroyed = true;
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'rate-limit-stats-flush' })
  async flushOnSchedule() {
    if (this.scanning || this.destroyed) return;
    this.scanning = true;
    try {
      const flushed = await this.flushClosedWindows();
      if (flushed > 0) {
        this.logger.log(`flushed ${flushed} closed window(s) to api_key_usage_stats`);
      }
    } catch (err) {
      this.logger.warn(`flush failed: ${(err as Error).message}`);
    } finally {
      this.scanning = false;
    }
  }

  /** Returns the number of (identifier, group, window) rows upserted. */
  async flushClosedWindows(): Promise<number> {
    const cutoffEpoch = Math.floor(Date.now() / 1000 / 300) * 300; // current window start
    const keys = await scan(this.redis, 'throttle:stats:*');
    if (keys.length === 0) return 0;

    let flushed = 0;
    for (const key of keys) {
      const parts = key.split(':');
      // throttle:stats:{epoch}:{group}:{identifier...}
      if (parts.length < 5) continue;
      const windowEpoch = parseInt(parts[2], 10);
      if (!Number.isFinite(windowEpoch)) continue;
      if (windowEpoch >= cutoffEpoch) continue; // window still open

      const group = parts[3];
      const identifier = parts.slice(4).join(':');
      const hash = await this.redis.hgetall(key);
      const requestCount = parseInt(hash.requests ?? '0', 10) || 0;
      const throttledCount = parseInt(hash.throttled ?? '0', 10) || 0;
      if (requestCount === 0 && throttledCount === 0) {
        await this.redis.del(key);
        continue;
      }

      const windowStart = new Date(windowEpoch * 1000);
      const { tenantId, apiKeyId } = await this.resolveAttribution(identifier);

      try {
        await this.db
          .insert(apiKeyUsageStats)
          .values({
            tenantId,
            apiKeyId,
            identifier,
            endpointGroup: group,
            requestCount,
            throttledCount,
            windowStart,
          })
          .onConflictDoUpdate({
            target: [
              apiKeyUsageStats.identifier,
              apiKeyUsageStats.endpointGroup,
              apiKeyUsageStats.windowStart,
            ],
            set: {
              requestCount: sql`${apiKeyUsageStats.requestCount} + ${requestCount}`,
              throttledCount: sql`${apiKeyUsageStats.throttledCount} + ${throttledCount}`,
            },
          });
        flushed++;
        await this.redis.del(key);
      } catch (err) {
        this.logger.warn(
          `failed to upsert stats for ${identifier}/${group}: ${(err as Error).message}`,
        );
        // leave the redis key alone — next pass will retry
      }
    }
    return flushed;
  }

  private async resolveAttribution(identifier: string): Promise<{
    tenantId: string | null;
    apiKeyId: string | null;
  }> {
    // identifier shapes we expect:
    //   usk_xxxxxxxx  — api-key prefix (12 chars)
    //   admin:<tenantId-uuid>
    //   tenant:<tenantId-uuid>
    //   ip:<ip>
    //   admin:bearer:<…>
    if (identifier.length === 12 && identifier.startsWith('usk_')) {
      const issued = (
        await this.db
          .select({ id: tenantApiKeys.id, tenantId: tenantApiKeys.tenantId })
          .from(tenantApiKeys)
          .where(eq(tenantApiKeys.keyPrefix, identifier))
          .limit(1)
      )[0];
      if (issued) return { tenantId: issued.tenantId, apiKeyId: issued.id };
      // Legacy single-key tenant
      const direct = (
        await this.db
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.apiKeyPrefix, identifier))
          .limit(1)
      )[0];
      if (direct) return { tenantId: direct.id, apiKeyId: null };
    }
    if (identifier.startsWith('admin:') || identifier.startsWith('tenant:')) {
      const candidate = identifier.split(':')[1] ?? '';
      if (UUID_RE.test(candidate)) {
        return { tenantId: candidate, apiKeyId: null };
      }
    }
    return { tenantId: null, apiKeyId: null };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function scan(redis: Redis, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}
