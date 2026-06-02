import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { eq } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { tenantCredentials, tenants } from '../../db/schema';
import { AdapterFactory } from '../adapters/adapter.factory';
import type { ActiveJob } from '../adapters/adapter.interface';
import { CommandCenterService } from '../command-center/command-center.service';
import { AaaNormalizer } from '../command-center/normalizers/aaa.normalizer';
import { TowbookNormalizer } from '../command-center/normalizers/towbook.normalizer';
import type { UnifiedJobInput, UnifiedJobSource } from '../command-center/normalizers/types';
import { DispatchRulesEngineService } from '../digital-dispatch/dispatch-rules-engine.service';
import {
  SessionManagerService,
  getSessionRefreshTimeoutMs,
} from '../session-manager/session-manager.service';
import { SessionExpiredException } from '../../common/exceptions/session-expired.exception';

const CONCURRENCY = 5;

// Extra head-room added to the SessionManager's own refresh timeout to derive
// the poller-side watchdog ceiling. The session layer should always time out
// first (producing a cleanly classified failure); this watchdog only fires if
// that layer ever regresses, guaranteeing the poll cycle still releases its
// in-flight lock.
const REFRESH_WATCHDOG_BUFFER_MS = 10_000;

const SOURCE_BY_SOFTWARE: Record<string, UnifiedJobSource | undefined> = {
  TOWBOOK: 'towbook',
  AAA_PORTAL: 'aaa_salesforce',
};

const MOTOR_CLUB_SOURCES: ReadonlySet<UnifiedJobSource> = new Set(['aaa_salesforce']);

@Injectable()
export class JobPollerCron {
  private readonly logger = new Logger(JobPollerCron.name);
  private isRunning = false;

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly adapterFactory: AdapterFactory,
    private readonly sessionManager: SessionManagerService,
    private readonly commandCenter: CommandCenterService,
    private readonly towbookNormalizer: TowbookNormalizer,
    private readonly aaaNormalizer: AaaNormalizer,
    private readonly dispatchEngine: DispatchRulesEngineService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async pollAllTenants(): Promise<void> {
    if (!process.env.DATABASE_URL) {
      // Skip silently when DB not configured (boot-without-DB dev case).
      return;
    }

    if (this.isRunning) {
      this.logger.warn('Previous poll cycle still running. Skipping.');
      return;
    }
    this.isRunning = true;
    const startTime = Date.now();

    try {
      const activeTenants = await this.db.query.tenants.findMany({
        where: eq(tenants.isActive, true),
      });

      this.logger.log(`Polling ${activeTenants.length} active tenants...`);

      for (let i = 0; i < activeTenants.length; i += CONCURRENCY) {
        const batch = activeTenants.slice(i, i + CONCURRENCY);
        await Promise.allSettled(batch.map((t) => this.pollSingleTenant(t)));
      }

      this.logger.log(`Poll cycle complete in ${Date.now() - startTime}ms`);
    } catch (err) {
      this.logger.error(`Poll cycle failed: ${(err as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }

  private async pollSingleTenant(tenant: {
    id: string;
    targetSoftwareType: string;
  }): Promise<void> {
    const source = SOURCE_BY_SOFTWARE[tenant.targetSoftwareType.toUpperCase()];
    if (!source) {
      this.logger.debug(
        `Tenant ${tenant.id} software ${tenant.targetSoftwareType} has no unified-jobs mapping`,
      );
      return;
    }

    // S65 — circuit breaker. If credentials have failed 3 or more times
    // in the last hour, stop hammering the upstream until the cooldown
    // expires. Operators can clear failed_login_count manually after
    // fixing the credentials, or wait for the natural backoff.
    const cred = await this.db.query.tenantCredentials.findFirst({
      where: eq(tenantCredentials.tenantId, tenant.id),
    });

    if (!cred || cred.sessionStatus === 'PAUSED') {
      this.logger.debug(`No credentials found or integration paused for tenant ${tenant.id}. Skipping scraper polling.`);
      return;
    }

    if (cred.failedLoginCount >= 3) {
      const lastFailureMs = cred.lastFailureAt?.getTime() ?? 0;
      const cooldownMs = 60 * 60 * 1000; // 1 hour
      if (Date.now() - lastFailureMs < cooldownMs) {
        this.logger.debug(
          `Circuit breaker open for tenant ${tenant.id} (failedLoginCount=${cred.failedLoginCount}). Skipping until cooldown.`,
        );
        return;
      }
    }

    try {
      const adapter = this.adapterFactory.getAdapter(tenant.targetSoftwareType);
      const jobs = await adapter.scrapeAllActiveJobs(tenant.id);
      await this.ingestJobs(tenant.id, source, jobs);
    } catch (err) {
      if (err instanceof SessionExpiredException) {
        this.logger.warn(`Session expired for tenant ${tenant.id}. Triggering refresh.`);
        await this.refreshWithWatchdog(tenant.id);
      } else {
        this.logger.error(`Poll failed for tenant ${tenant.id}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Trigger a session refresh without ever letting it freeze this poll cycle.
   * The refresh is already bounded by SessionManager's own
   * SESSION_REFRESH_TIMEOUT_MS; this watchdog is a second, slightly-longer
   * ceiling so that even a regression in the session layer cannot leave
   * pollAllTenants()'s `await` pending and its `isRunning` lock stuck on.
   * Always resolves; never throws.
   */
  private async refreshWithWatchdog(tenantId: string): Promise<void> {
    const ceilingMs = getSessionRefreshTimeoutMs() + REFRESH_WATCHDOG_BUFFER_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watchdog = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        this.logger.error(
          `Session refresh watchdog fired for tenant ${tenantId} after ${ceilingMs}ms; abandoning wait so the poll cycle can release its lock.`,
        );
        resolve();
      }, ceilingMs);
    });
    const refresh = this.sessionManager.refreshExpiringSessions().catch((e) => {
      this.logger.error(
        `Session refresh after expiry failed for tenant ${tenantId}: ${(e as Error).message}`,
      );
    });
    try {
      await Promise.race([refresh, watchdog]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async ingestJobs(tenantId: string, source: UnifiedJobSource, jobs: ActiveJob[]) {
    const activeSourceJobIds: string[] = [];

    for (const job of jobs) {
      let input: UnifiedJobInput;
      switch (source) {
        case 'towbook':
          input = this.towbookNormalizer.normalize(tenantId, job);
          break;
        case 'aaa_salesforce':
          input = this.aaaNormalizer.normalize(tenantId, job);
          break;
        default:
          continue;
      }

      activeSourceJobIds.push(input.sourceJobId);

      try {
        const result = await this.commandCenter.upsertJob(input);
        if (result.created && MOTOR_CLUB_SOURCES.has(source)) {
          this.dispatchEngine
            .evaluateForJob(tenantId, result.job)
            .catch((err) =>
              this.logger.warn(
                `Rules engine failed for job ${result.job.id}: ${(err as Error).message}`,
              ),
            );
        }
      } catch (err) {
        this.logger.error(
          `Upsert failed for ${source}:${input.sourceJobId} (tenant ${tenantId}): ${(err as Error).message}`,
        );
      }
    }

    try {
      await this.commandCenter.archiveMissingJobs(tenantId, source, activeSourceJobIds);
    } catch (err) {
      this.logger.error(
        `Failed to run cleanup rule (archiveMissingJobs) for tenant ${tenantId}, source ${source}: ${(err as Error).message}`,
      );
    }
  }
}
