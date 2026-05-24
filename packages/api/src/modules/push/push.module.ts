import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { TenantApiKeyGuard } from '../../common/guards/tenant-api-key.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { PushController } from './push.controller';
import { PushService } from './push.service';

@Module({
  imports: [TenantsModule],
  controllers: [PushController],
  providers: [PushService, TenantApiKeyGuard, RateLimitGuard],
  exports: [PushService],
})
export class PushModule {}
