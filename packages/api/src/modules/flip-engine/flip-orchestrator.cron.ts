import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FlipOrchestratorService } from './flip-orchestrator.service';
import { FlipEngineService } from './flip-engine.service';
import { TenantService } from '../tenant/tenant.service';

@Injectable()
export class FlipOrchestratorCron {
  private readonly logger = new Logger(FlipOrchestratorCron.name);

  constructor(
    private orchestrator: FlipOrchestratorService,
    private flipEngine: FlipEngineService,
    private tenants: TenantService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handlePendingFlipJobs(): Promise<void> {
    const activeTenants = await this.tenants.findActive();
    
    for (const tenant of activeTenants) {
      try {
        const jobs = await this.flipEngine.fetchPendingFlipJobs(tenant.id);
        
        for (const job of jobs) {
          try {
            await this.orchestrator.handleJob(tenant.id, job);
          } catch (err) {
            this.logger.error(Job failed: , err);
          }
        }
      } catch (err) {
        this.logger.error(Tenant  failed, err);
      }
    }
  }
}
