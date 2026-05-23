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
import { CommandCenterModule } from './modules/command-center/command-center.module';
import { DigitalDispatchModule } from './modules/digital-dispatch/digital-dispatch.module';
import { KnowledgeEndpointModule } from './modules/knowledge-endpoint/knowledge-endpoint.module';
import { WebhookReceiverModule } from './modules/webhook-receiver/webhook-receiver.module';
import { OutboundModule } from './modules/outbound/outbound.module';
import { OutboundSmsModule } from './modules/outbound-sms/outbound-sms.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { FlipAcceptModule } from './modules/flip-accept/flip-accept.module';
import { DriverPingsModule } from './modules/driver-pings/driver-pings.module';
import { DriverJobsModule } from './modules/driver-jobs/driver-jobs.module';
import { ConviniModule } from './modules/convini/convini.module';
import { RateLimitingModule } from './modules/rate-limiting/rate-limiting.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
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
    CommandCenterModule,
    DigitalDispatchModule,
    KnowledgeEndpointModule,
    WebhookReceiverModule,
    OutboundModule,
    OutboundSmsModule,
    TrackingModule,
    FlipAcceptModule,
    DriverPingsModule,
    DriverJobsModule,
    ConviniModule,
    RateLimitingModule,
    AuditLogModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
