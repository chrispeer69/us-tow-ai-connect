import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { tenants } from '../../db/schema';
import { AdapterFactory } from '../adapters/adapter.factory';
import type { ActiveJob } from '../adapters/adapter.interface';
import { CommandCenterService } from '../command-center/command-center.service';
import { AaaNormalizer } from '../command-center/normalizers/aaa.normalizer';
import { TowbookNormalizer } from '../command-center/normalizers/towbook.normalizer';
import type { UnifiedJobInput, UnifiedJobSource } from '../command-center/normalizers/types';
import { SessionManagerService } from '../session-manager/session-manager.service';
import { SessionExpiredException } from '../../common/exceptions/session-expired.exception';

const CONCURRENCY = 5;

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
  ) {}

  @Cron('*/60 * * * * *')
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

    try {
      const adapter = this.adapterFactory.getAdapter(tenant.targetSoftwareType);
      const jobs = await adapter.scrapeAllActiveJobs(tenant.id);
      await this.ingestJobs(tenant.id, source, jobs);
    } catch (err) {
      if (err instanceof SessionExpiredException) {
        this.logger.warn(`Session expired for tenant ${tenant.id}. Triggering refresh.`);
        await this.sessionManager.refreshExpiringSessions().catch((e) => {
          this.logger.error(
            `Session refresh after expiry failed for tenant ${tenant.id}: ${(e as Error).message}`,
          );
        });
      } else {
        this.logger.error(`Poll failed for tenant ${tenant.id}: ${(err as Error).message}`);
      }
    }
  }

  private async ingestJobs(tenantId: string, source: UnifiedJobSource, jobs: ActiveJob[]) {
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

      try {
        await this.commandCenter.upsertJob(input);
        // Note: motor-club sources (aaa_salesforce) will trigger the dispatch
        // rules engine once it's wired in — see S22 / digital-dispatch module.
        void MOTOR_CLUB_SOURCES;
      } catch (err) {
        this.logger.error(
          `Upsert failed for ${source}:${input.sourceJobId} (tenant ${tenantId}): ${(err as Error).message}`,
        );
      }
    }
  }
}
