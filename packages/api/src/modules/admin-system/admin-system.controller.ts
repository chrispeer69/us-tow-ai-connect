import { Controller, Get, Req, UseGuards, Inject, Body, Patch } from '@nestjs/common';
import { and, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type Redis from 'ioredis';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { apiKeyUsageStats, auditLog, emailMessages } from '../../db/schema';

const MS_PER_DAY = 86_400_000;

const LimitOverrideSchema = z.object({
  group: z.enum(['public', 'tenant_api', 'admin', 'webhook']),
  identifier: z.string().min(1).max(128),
  limit: z.number().int().positive().max(100_000),
  ttlSeconds: z.number().int().positive().max(7 * 86_400).optional(),
});

type LimitOverrideBody = z.infer<typeof LimitOverrideSchema>;

/**
 * Operator-facing stats + control plane.
 * GET  /v1/admin/system/stats — rate-limit hits + audit + digest send count + error count, 24h window.
 * PATCH /v1/admin/system/limits — set a Redis throttle override for a tenant/key/IP.
 */
@Controller('v1/admin/system')
@UseGuards(AdminAuthGuard)
export class AdminSystemController {
  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get('stats')
  async stats(@Req() req: AdminRequest) {
    const since = new Date(Date.now() - MS_PER_DAY);
    const tenantId = req.tenantId;

    const [rateLimitHits, auditCount, digestSends, errorCount] = await Promise.all([
      this.sumThrottled(tenantId, since),
      this.countAudit(tenantId, since),
      this.countDigestSends(tenantId, since),
      this.countAuditErrors(tenantId, since),
    ]);

    return {
      windowHours: 24,
      tenantId,
      rateLimitHits,
      auditLogEntries: auditCount,
      digestEmailsSent: digestSends,
      errors: errorCount,
      generatedAt: new Date().toISOString(),
    };
  }

  @Patch('limits')
  async setLimit(
    @Body(new ZodValidationPipe(LimitOverrideSchema)) body: LimitOverrideBody,
  ) {
    const key = `throttle:override:${body.group}:${body.identifier}`;
    if (body.ttlSeconds) {
      await this.redis.set(key, String(body.limit), 'EX', body.ttlSeconds);
    } else {
      await this.redis.set(key, String(body.limit));
    }
    return {
      key,
      limit: body.limit,
      ttlSeconds: body.ttlSeconds ?? null,
    };
  }

  private async sumThrottled(tenantId: string, since: Date): Promise<number> {
    try {
      const rows = await this.db
        .select({
          count: sql<number>`coalesce(sum(${apiKeyUsageStats.throttledCount}), 0)::int`,
        })
        .from(apiKeyUsageStats)
        .where(
          and(eq(apiKeyUsageStats.tenantId, tenantId), gte(apiKeyUsageStats.windowStart, since)),
        );
      return rows[0]?.count ?? 0;
    } catch {
      return 0;
    }
  }

  private async countAudit(tenantId: string, since: Date): Promise<number> {
    try {
      const rows = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, tenantId), gte(auditLog.createdAt, since)));
      return rows[0]?.count ?? 0;
    } catch {
      return 0;
    }
  }

  private async countDigestSends(tenantId: string, since: Date): Promise<number> {
    try {
      const rows = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(emailMessages)
        .where(
          and(
            eq(emailMessages.tenantId, tenantId),
            eq(emailMessages.relatedKind, 'admin_digest'),
            gte(emailMessages.createdAt, since),
          ),
        );
      return rows[0]?.count ?? 0;
    } catch {
      return 0;
    }
  }

  private async countAuditErrors(tenantId: string, since: Date): Promise<number> {
    try {
      const rows = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.tenantId, tenantId),
            gte(auditLog.createdAt, since),
            sql`${auditLog.action} LIKE '%.failed'`,
          ),
        );
      return rows[0]?.count ?? 0;
    } catch {
      return 0;
    }
  }
}
