import { Module } from '@nestjs/common';
import { AiConnectController } from './ai-connect.controller';
import { AiConnectService } from './ai-connect.service';
import { TenantsModule } from '../tenants/tenants.module';
import { OutboundModule } from '../outbound/outbound.module';
import { DriverPingsModule } from '../driver-pings/driver-pings.module';
import { TrackingModule } from '../tracking/tracking.module';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { TenantApiKeyGuard } from '../../common/guards/tenant-api-key.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';

@Module({
  imports: [TenantsModule, OutboundModule, DriverPingsModule, TrackingModule],
  controllers: [AiConnectController],
  providers: [AiConnectService, ApiKeyGuard, TenantApiKeyGuard, RateLimitGuard],
  exports: [AiConnectService],
})
export class AiConnectModule {}
