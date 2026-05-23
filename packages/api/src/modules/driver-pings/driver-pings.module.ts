import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { TenantApiKeyGuard } from '../../common/guards/tenant-api-key.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { DriverPingsController } from './driver-pings.controller';
import { DriverPingsService } from './driver-pings.service';
import { GoogleDistanceMatrixService } from './google-distance-matrix.service';

@Module({
  imports: [TenantsModule],
  controllers: [DriverPingsController],
  providers: [
    DriverPingsService,
    GoogleDistanceMatrixService,
    TenantApiKeyGuard,
    RateLimitGuard,
    AdminAuthGuard,
  ],
  exports: [DriverPingsService, GoogleDistanceMatrixService],
})
export class DriverPingsModule {}
