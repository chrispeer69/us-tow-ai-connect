import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { TenantApiKeyGuard } from '../../common/guards/tenant-api-key.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { FlipPushController } from './flip-push.controller';
import { PushController } from './push.controller';
import { PushService } from './push.service';

@Module({
  imports: [TenantsModule],
  // PushController = driver PWA (tenant API key). FlipPushController = the
  // flip board's win alerts (admin JWT). Same service and same VAPID config,
  // two controllers because the two audiences authenticate differently.
  controllers: [PushController, FlipPushController],
  providers: [PushService, TenantApiKeyGuard, RateLimitGuard],
  exports: [PushService],
})
export class PushModule {}
