import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, lt, lte, sql, type SQL } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { auditLog, type AuditLogRow, tenants } from '../../db/schema';
import { sanitizeForAudit } from './audit-sanitizer';

export type ActorType =
  | 'user'
  | 'api_key'
  | 'system'
  | 'ai_agent'
  | 'adapter'
  | 'webhook';

export interface RecordAuditParams {
  tenantId?: string | null;
  actorType: ActorType;
  actorId: string;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export interface ListAuditParams {
  tenantId: string;
  actorType?: ActorType;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  /** Best-effort insert. Audit failures never block the parent request. */
  async record(params: RecordAuditParams): Promise<AuditLogRow | null> {
    try {
      const inserted = await this.db
        .insert(auditLog)
        .values({
          tenantId: params.tenantId ?? null,
          actorType: params.actorType,
          actorId: params.actorId,
          action: params.action,
          resourceType: params.resourceType ?? null,
          resourceId: params.resourceId ?? null,
          beforeState: params.before === undefined ? null : sanitizeForAudit(params.before),
          afterState: params.after === undefined ? null : sanitizeForAudit(params.after),
          metadata: sanitizeForAudit(params.metadata ?? {}),
        })
        .returning();
      return inserted[0];
    } catch (err) {
      this.logger.warn(
        `audit-log write failed for action=${params.action}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  async list(params: ListAuditParams) {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const page = Math.max(params.page ?? 1, 1);
    const offset = (page - 1) * limit;

    const where: SQL[] = [eq(auditLog.tenantId, params.tenantId)];
    if (params.actorType) where.push(eq(auditLog.actorType, params.actorType));
    if (params.action) where.push(eq(auditLog.action, params.action));
    if (params.resourceType) where.push(eq(auditLog.resourceType, params.resourceType));
    if (params.resourceId) where.push(eq(auditLog.resourceId, params.resourceId));
    if (params.from) where.push(gte(auditLog.createdAt, params.from));
    if (params.to) where.push(lte(auditLog.createdAt, params.to));

    const filter = where.length > 1 ? and(...where) : where[0];

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(filter);

    const items = await this.db
      .select()
      .from(auditLog)
      .where(filter)
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset);

    return { items, total: count, page, limit };
  }

  /** Retention sweep — called by AuditLogRetentionService cron. */
  async pruneOlderThan(tenantId: string, days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86400_000);
    const deleted = await this.db
      .delete(auditLog)
      .where(and(eq(auditLog.tenantId, tenantId), lt(auditLog.createdAt, cutoff)))
      .returning({ id: auditLog.id });
    return deleted.length;
  }

  async listAllTenantsForRetention() {
    return this.db
      .select({ id: tenants.id, days: tenants.auditRetentionDays })
      .from(tenants)
      .where(eq(tenants.isActive, true));
  }
}
