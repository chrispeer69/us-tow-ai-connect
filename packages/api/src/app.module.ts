import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RedisModule } from './common/redis/redis.module';
import { EncryptionModule } from './common/utils/encryption.module';
import { DbModule } from './db/db.module';
import { AdaptersModule } from './modules/adapters/adapters.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SessionManagerModule } from './modules/session-manager/session-manager.module';
import { JobPollerModule } from './modules/job-poller/job-poller.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { AiConnectModule } from './modules/ai-connect/ai-connect.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    RedisModule,
    EncryptionModule,
    DbModule,
    AdaptersModule,
    NotificationsModule,
    SessionManagerModule,
    JobPollerModule,
    TenantsModule,
    AiConnectModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
