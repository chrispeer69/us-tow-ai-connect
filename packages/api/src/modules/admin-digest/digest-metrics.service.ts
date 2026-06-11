import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import {
  apiKeyUsageStats,
  callInteractions,
  dispatchRequests,
  dispatchDecisions,
  driverPings,
  driverJobEvents,
  outboundCalls,
  smsMessages,
  unifiedJobs,
} from '../../db/schema';

export type DigestRange = 'daily' | 'weekly';

export interface DigestMetrics {
  range: DigestRange;
  windowStart: Date;
  windowEnd: Date;
  callsHandled: {
    count: number;
    totalMinutes: number;
    avgDurationSec: number;
    byType: { inbound: number; outbound: number };
  };
  jobsCreated: { total: number; bySource: Record<string, number> };
  jobsCompleted: number;
  conversionRate: number;
  topDeclineReasons: Array<{ reason: string; count: number }>;
  driverActivity: {
    activeDrivers: number;
    totalMilesEstimated: number;
    avgJobsPerDriver: number;
  };
  topCallers: Array<{ phone: string; count: number }>;
  failures: {
    failedSmsSends: number;
    rateLimitHits: number;
  };
}

const MS_PER_DAY = 86_400_000;

/**
 * Pulls one row of summary metrics for the admin digest. Every query is
 * defensive: if a feature isn't installed yet (no driver_pings rows, no
 * dispatch_decisions, etc.) the corresponding metric is zero rather than a
 * crash. The digest is one of the first surfaces the operator sees, so
 * partial data is fine — silence is not.
 */
@Injectable()
export class DigestMetricsService {
  private readonly logger = new Logger(DigestMetricsService.name);

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  async collect(tenantId: string, range: DigestRange, asOf = new Date()): Promise<DigestMetrics> {
    const windowEnd = asOf;
    const windowStart = new Date(asOf.getTime() - (range === 'weekly' ? 7 : 1) * MS_PER_DAY);

    const [
      callsHandled,
      jobsCreated,
      jobsCompleted,
      topDeclineReasons,
      driverActivity,
      topCallers,
      failures,
    ] = await Promise.all([
      this.collectCalls(tenantId, windowStart, windowEnd),
      this.collectJobsCreated(tenantId, windowStart, windowEnd),
      this.collectJobsCompleted(tenantId, windowStart, windowEnd),
      this.collectDeclineReasons(tenantId, windowStart, windowEnd),
      this.collectDriverActivity(tenantId, windowStart, windowEnd),
      this.collectTopCallers(tenantId, windowStart, windowEnd),
      this.collectFailures(tenantId, windowStart, windowEnd),
    ]);

    const conversionRate =
      callsHandled.count === 0 ? 0 : Math.min(1, jobsCreated.total / callsHandled.count);

    return {
      range,
      windowStart,
      windowEnd,
      callsHandled,
      jobsCreated,
      jobsCompleted,
      conversionRate,
      topDeclineReasons,
      driverActivity,
      topCallers,
      failures,
    };
  }

  private async collectCalls(tenantId: string, from: Date, to: Date) {
    try {
      const [inboundRows, outboundRows] = await Promise.all([
        this.db
          .select({
            count: sql<number>`count(*)::int`,
            totalSec: sql<number>`coalesce(sum(${callInteractions.durationSec}), 0)::int`,
          })
          .from(callInteractions)
          .where(
            and(
              eq(callInteractions.tenantId, tenantId),
              gte(callInteractions.createdAt, from),
              lt(callInteractions.createdAt, to),
            ),
          ),
        this.db
          .select({
            count: sql<number>`count(*)::int`,
            totalSec: sql<number>`coalesce(sum(${outboundCalls.durationSeconds}), 0)::int`,
          })
          .from(outboundCalls)
          .where(
            and(
              eq(outboundCalls.tenantId, tenantId),
              gte(outboundCalls.createdAt, from),
              lt(outboundCalls.createdAt, to),
              sql`${outboundCalls.status} in ('completed', 'no_answer')`,
            ),
          ),
      ]);
      const inbound = inboundRows[0] ?? { count: 0, totalSec: 0 };
      const outbound = outboundRows[0] ?? { count: 0, totalSec: 0 };
      const count = (inbound.count ?? 0) + (outbound.count ?? 0);
      const totalSec = (inbound.totalSec ?? 0) + (outbound.totalSec ?? 0);
      const totalMinutes = Math.round(totalSec / 60);
      const avgDurationSec = count > 0 ? Math.round(totalSec / count) : 0;
      return {
        count,
        totalMinutes,
        avgDurationSec,
        byType: {
          inbound: inbound.count ?? 0,
          outbound: outbound.count ?? 0,
        },
      };
    } catch (err) {
      this.logger.warn(`collectCalls failed: ${(err as Error).message}`);
      return { count: 0, totalMinutes: 0, avgDurationSec: 0, byType: { inbound: 0, outbound: 0 } };
    }
  }

  private async collectJobsCreated(tenantId: string, from: Date, to: Date) {
    try {
      const rows = await this.db
        .select({
          source: unifiedJobs.source,
          count: sql<number>`count(*)::int`,
        })
        .from(unifiedJobs)
        .where(
          and(
            eq(unifiedJobs.tenantId, tenantId),
            gte(unifiedJobs.createdAt, from),
            lt(unifiedJobs.createdAt, to),
          ),
        )
        .groupBy(unifiedJobs.source);
      const bySource: Record<string, number> = {};
      let total = 0;
      for (const r of rows) {
        bySource[r.source] = r.count;
        total += r.count;
      }
      // Fold in dispatch_requests (AI-driven) when unified_jobs is missing
      // them — older deployments wrote there instead. Treat as 'ai_dispatch'.
      try {
        const drRows = await this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(dispatchRequests)
          .where(
            and(
              eq(dispatchRequests.tenantId, tenantId),
              gte(dispatchRequests.createdAt, from),
              lt(dispatchRequests.createdAt, to),
            ),
          );
        const drCount = drRows[0]?.count ?? 0;
        if (drCount > 0) {
          bySource['ai_dispatch'] = (bySource['ai_dispatch'] ?? 0) + drCount;
          total += drCount;
        }
      } catch {
        // dispatch_requests may not exist — fine.
      }
      return { total, bySource };
    } catch (err) {
      this.logger.warn(`collectJobsCreated failed: ${(err as Error).message}`);
      return { total: 0, bySource: {} };
    }
  }

  private async collectJobsCompleted(tenantId: string, from: Date, to: Date) {
    try {
      const rows = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(unifiedJobs)
        .where(
          and(
            eq(unifiedJobs.tenantId, tenantId),
            gte(unifiedJobs.completedAt, from),
            lt(unifiedJobs.completedAt, to),
          ),
        );
      return rows[0]?.count ?? 0;
    } catch (err) {
      this.logger.warn(`collectJobsCompleted failed: ${(err as Error).message}`);
      return 0;
    }
  }

  private async collectDeclineReasons(tenantId: string, from: Date, to: Date) {
    try {
      const rows = await this.db
        .select({
          reason: dispatchDecisions.reason,
          count: sql<number>`count(*)::int`,
        })
        .from(dispatchDecisions)
        .innerJoin(unifiedJobs, eq(unifiedJobs.id, dispatchDecisions.jobId))
        .where(
          and(
            eq(unifiedJobs.tenantId, tenantId),
            eq(dispatchDecisions.decision, 'decline'),
            gte(dispatchDecisions.decidedAt, from),
            lt(dispatchDecisions.decidedAt, to),
          ),
        )
        .groupBy(dispatchDecisions.reason)
        .orderBy(desc(sql`count(*)`))
        .limit(5);
      return rows
        .filter((r) => r.reason)
        .map((r) => ({ reason: r.reason ?? 'unspecified', count: r.count }));
    } catch (err) {
      this.logger.warn(`collectDeclineReasons failed: ${(err as Error).message}`);
      return [];
    }
  }

  private async collectDriverActivity(tenantId: string, from: Date, to: Date) {
    try {
      const driverRows = await this.db
        .select({
          phone: driverPings.driverPhone,
          pingCount: sql<number>`count(*)::int`,
        })
        .from(driverPings)
        .where(
          and(
            eq(driverPings.tenantId, tenantId),
            gte(driverPings.recordedAt, from),
            lt(driverPings.recordedAt, to),
          ),
        )
        .groupBy(driverPings.driverPhone);
      const activeDrivers = driverRows.length;
      // Rough miles estimate: 0.05 mile per ping at typical 1-min cadence
      // (~3 mph in town). Good enough for the email — proper telematics
      // would replace this once GPS-derived odometer lands.
      const totalPings = driverRows.reduce((acc, r) => acc + r.pingCount, 0);
      const totalMilesEstimated = Math.round(totalPings * 0.05);

      let jobCount = 0;
      try {
        const jobRows = await this.db
          .select({ count: sql<number>`count(distinct ${driverJobEvents.jobId})::int` })
          .from(driverJobEvents)
          .where(
            and(
              eq(driverJobEvents.tenantId, tenantId),
              gte(driverJobEvents.createdAt, from),
              lt(driverJobEvents.createdAt, to),
            ),
          );
        jobCount = jobRows[0]?.count ?? 0;
      } catch {
        // driver_job_events optional
      }
      const avgJobsPerDriver =
        activeDrivers === 0 ? 0 : Math.round((jobCount / activeDrivers) * 10) / 10;
      return { activeDrivers, totalMilesEstimated, avgJobsPerDriver };
    } catch (err) {
      this.logger.warn(`collectDriverActivity failed: ${(err as Error).message}`);
      return { activeDrivers: 0, totalMilesEstimated: 0, avgJobsPerDriver: 0 };
    }
  }

  private async collectTopCallers(tenantId: string, from: Date, to: Date) {
    try {
      const [inboundRows, outboundRows] = await Promise.all([
        this.db
          .select({
            phone: callInteractions.callerPhone,
            count: sql<number>`count(*)::int`,
          })
          .from(callInteractions)
          .where(
            and(
              eq(callInteractions.tenantId, tenantId),
              gte(callInteractions.createdAt, from),
              lt(callInteractions.createdAt, to),
            ),
          )
          .groupBy(callInteractions.callerPhone)
          .orderBy(desc(sql`count(*)`))
          .limit(10),
        this.db
          .select({
            phone: outboundCalls.toPhone,
            count: sql<number>`count(*)::int`,
          })
          .from(outboundCalls)
          .where(
            and(
              eq(outboundCalls.tenantId, tenantId),
              gte(outboundCalls.createdAt, from),
              lt(outboundCalls.createdAt, to),
              sql`${outboundCalls.status} in ('completed', 'no_answer')`,
            ),
          )
          .groupBy(outboundCalls.toPhone)
          .orderBy(desc(sql`count(*)`))
          .limit(10),
      ]);
      const counts = new Map<string, number>();
      for (const row of [...inboundRows, ...outboundRows]) {
        if (!row.phone) continue;
        counts.set(row.phone, (counts.get(row.phone) ?? 0) + row.count);
      }
      return Array.from(counts.entries())
        .map(([phone, count]) => ({ phone, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
    } catch (err) {
      this.logger.warn(`collectTopCallers failed: ${(err as Error).message}`);
      return [];
    }
  }

  private async collectFailures(tenantId: string, from: Date, to: Date) {
    let failedSmsSends = 0;
    let rateLimitHits = 0;
    try {
      const rows = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(smsMessages)
        .where(
          and(
            eq(smsMessages.tenantId, tenantId),
            eq(smsMessages.status, 'failed'),
            gte(smsMessages.createdAt, from),
            lt(smsMessages.createdAt, to),
          ),
        );
      failedSmsSends = rows[0]?.count ?? 0;
    } catch {
      // sms_messages may be absent in dev
    }
    try {
      const rows = await this.db
        .select({
          count: sql<number>`coalesce(sum(${apiKeyUsageStats.throttledCount}), 0)::int`,
        })
        .from(apiKeyUsageStats)
        .where(
          and(
            eq(apiKeyUsageStats.tenantId, tenantId),
            gte(apiKeyUsageStats.windowStart, from),
            lt(apiKeyUsageStats.windowStart, to),
          ),
        );
      rateLimitHits = rows[0]?.count ?? 0;
    } catch {
      // api_key_usage_stats may be empty
    }
    return { failedSmsSends, rateLimitHits };
  }
}
