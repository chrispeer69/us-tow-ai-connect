import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, desc, eq, gte, isNull, notExists, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import {
  dispatchDecisions,
  flipAcceptRequests,
  unifiedJobs,
} from '../../db/schema';
import { FlipAcceptService } from './flip-accept.service';

const LOOKBACK_MS = 15 * 60 * 1000;

/**
 * Bridge between Digital Dispatch (Session 22) and Flip-Accept (Session 24).
 *
 * Intentionally NOT a code-level import of DigitalDispatchService — that
 * module is owned by a parallel session. Instead, this cron polls the shared
 * `dispatch_decisions` table for rows where `decision = 'flagged'` and no
 * flip_accept_request exists yet for the underlying (tenant, source,
 * source_job_id). When found, it calls FlipAcceptService.createRequest()
 * which fans out the manager SMS.
 *
 * Polling cadence: every 15 s. Lookback: 15 minutes — long enough to catch
 * a freshly inserted decision row before its underlying job moves status.
 */
@Injectable()
export class DigitalDispatchBridge {
  private readonly logger = new Logger(DigitalDispatchBridge.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly flipAccept: FlipAcceptService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async sweep(): Promise<void> {
    if (!process.env.DATABASE_URL) return;
    let processed = 0;
    try {
      const since = new Date(Date.now() - LOOKBACK_MS);
      const flaggedRows = await this.db
        .select({
          tenantId: unifiedJobs.tenantId,
          source: unifiedJobs.source,
          sourceJobId: unifiedJobs.sourceJobId,
          callerName: unifiedJobs.callerName,
          callerPhone: unifiedJobs.callerPhone,
          pickupAddress: unifiedJobs.pickupAddress,
          vehicleYear: unifiedJobs.vehicleYear,
          vehicleMake: unifiedJobs.vehicleMake,
          vehicleModel: unifiedJobs.vehicleModel,
          serviceType: unifiedJobs.serviceType,
          decisionReason: dispatchDecisions.reason,
        })
        .from(dispatchDecisions)
        .innerJoin(unifiedJobs, eq(dispatchDecisions.jobId, unifiedJobs.id))
        .where(
          and(
            eq(dispatchDecisions.decision, 'flagged'),
            gte(dispatchDecisions.decidedAt, since),
            notExists(
              this.db
                .select({ x: sql<number>`1` })
                .from(flipAcceptRequests)
                .where(
                  and(
                    eq(flipAcceptRequests.tenantId, unifiedJobs.tenantId),
                    eq(flipAcceptRequests.sourceAdapter, unifiedJobs.source),
                    eq(flipAcceptRequests.sourceJobId, unifiedJobs.sourceJobId),
                  ),
                ),
            ),
            isNull(unifiedJobs.completedAt),
          ),
        )
        .orderBy(desc(dispatchDecisions.decidedAt))
        .limit(25);

      for (const row of flaggedRows) {
        try {
          const vehicle = [row.vehicleYear, row.vehicleMake, row.vehicleModel]
            .filter(Boolean)
            .join(' ')
            .trim();
          await this.flipAccept.createRequest({
            tenantId: row.tenantId,
            sourceAdapter: row.source,
            sourceJobId: row.sourceJobId,
            jobSummary: {
              service_type: row.serviceType ?? 'tow',
              pickup_address: row.pickupAddress ?? '',
              vehicle: vehicle || 'TBD',
              caller_name: row.callerName ?? '',
              caller_phone: row.callerPhone ?? '',
              decision_reason: row.decisionReason ?? '',
            },
            managerPhones: null,
          });
          processed += 1;
        } catch (err) {
          this.logger.warn(
            `bridge failed to create flip-accept for ${row.source}/${row.sourceJobId}: ${(err as Error).message}`,
          );
        }
      }

      if (processed > 0) {
        this.logger.log(`bridge enqueued ${processed} flip-accept request(s) from flagged decisions`);
      }
    } catch (err) {
      this.logger.warn(`bridge sweep failed: ${(err as Error).message}`);
    }
  }
}
