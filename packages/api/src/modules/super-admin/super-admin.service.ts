import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import {
  callInteractions,
  interactionLogs,
  tenantBilling,
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
      })
      .from(tenants)
      .orderBy(desc(tenants.createdAt));

    // Aggregate active jobs + recent calls per tenant. Two cheap queries
    // beat N JOINs across optional tables.
    const activeJobCounts = await this.db
      .select({
        tenantId: unifiedJobs.tenantId,
        count: sql<number>`count(*)::int`,
      })
      .from(unifiedJobs)
      .where(sql`${unifiedJobs.status} IN ('new', 'assigned', 'en_route', 'on_scene', 'in_tow')`)
      .groupBy(unifiedJobs.tenantId);

    const callCounts = await this.db
      .select({
        tenantId: callInteractions.tenantId,
        count: sql<number>`count(*)::int`,
      })
      .from(callInteractions)
      .where(gte(callInteractions.createdAt, cutoff24h))
      .groupBy(callInteractions.tenantId);

    const planRows = await this.db
      .select({ tenantId: tenantBilling.tenantId, plan: tenantBilling.plan })
      .from(tenantBilling);

    const activeByT = new Map(activeJobCounts.map((r) => [r.tenantId, r.count]));
    const callsByT = new Map(callCounts.map((r) => [r.tenantId, r.count]));
    const planByT = new Map(planRows.map((r) => [r.tenantId, r.plan]));

    return rows.map((t) => ({
      ...t,
      activeJobs: activeByT.get(t.id) ?? 0,
      callsLast24h: callsByT.get(t.id) ?? 0,
      plan: planByT.get(t.id) ?? null,
    }));
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

    const billing = (
      await this.db.select().from(tenantBilling).where(eq(tenantBilling.tenantId, tenantId)).limit(1)
    )[0];

    return {
      tenant: t,
      stats: {
        callsLast24h: callsLast24h[0]?.count ?? 0,
        callsLast7d: callsLast7d[0]?.count ?? 0,
        activeJobs: activeJobs[0]?.count ?? 0,
      },
      billing,
      recentInteractions,
    };
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
}
