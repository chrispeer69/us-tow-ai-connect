import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { TenantApiKeyGuard } from '../../common/guards/tenant-api-key.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { DriverJobsController } from './driver-jobs.controller';
import { DriverJobsService } from './driver-jobs.service';

/**
 * Driver-jobs module — read-only view over Command Center's unified_jobs +
 * a small append-only audit table (driver_job_events) owned here.
 */
@Module({
  imports: [TenantsModule],
  controllers: [DriverJobsController],
  providers: [DriverJobsService, TenantApiKeyGuard, RateLimitGuard],
  exports: [DriverJobsService],
})
export class DriverJobsModule {}
