import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { SentryModule } from '@sentry/nestjs/setup';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { AdminCspMiddleware } from './common/middleware/admin-csp.middleware';
import { AdminIpAllowListGuard } from './common/guards/admin-ip-allowlist.guard';
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
import { MembersModule } from './modules/members/members.module';
import { CommandCenterModule } from './modules/command-center/command-center.module';
import { DigitalDispatchModule } from './modules/digital-dispatch/digital-dispatch.module';
import { KnowledgeEndpointModule } from './modules/knowledge-endpoint/knowledge-endpoint.module';
import { WebhookReceiverModule } from './modules/webhook-receiver/webhook-receiver.module';
import { OutboundModule } from './modules/outbound/outbound.module';
import { OutboundSmsModule } from './modules/outbound-sms/outbound-sms.module';
import { OutboundVoiceModule } from './modules/outbound-voice/outbound-voice.module';
import { FlipEngineModule } from './modules/flip-engine/flip-engine.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { FlipAcceptModule } from './modules/flip-accept/flip-accept.module';
import { DriverPingsModule } from './modules/driver-pings/driver-pings.module';
import { DriverJobsModule } from './modules/driver-jobs/driver-jobs.module';
import { ConviniModule } from './modules/convini/convini.module';
import { RateLimitingModule } from './modules/rate-limiting/rate-limiting.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { AdminDigestModule } from './modules/admin-digest/admin-digest.module';
import { AdminSystemModule } from './modules/admin-system/admin-system.module';
import { TenantOnboardingModule } from './modules/tenant-onboarding/tenant-onboarding.module';
import { BrandingModule } from './modules/branding/branding.module';
import { KnowledgePackModule } from './modules/knowledge-pack/knowledge-pack.module';
import { SuperAdminModule } from './modules/super-admin/super-admin.module';
import { PartnerModule } from './modules/partner/partner.module';
import { BillingModule } from './modules/billing/billing.module';
import { ReportsModule } from './modules/reports/reports.module';
import { PushModule } from './modules/push/push.module';
import { HealthController } from './modules/health/health.controller';
import { DomainStatusController } from './modules/health/domain-status.controller';

@Module({
  imports: [
    // SentryModule.forRoot() wires the Nest interceptor that links Nest's
    // request lifecycle to Sentry's active scope, so captured exceptions
    // carry route + handler context. Init itself lives in instrument.ts.
    SentryModule.forRoot(),
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
    MembersModule,
    CommandCenterModule,
    DigitalDispatchModule,
    KnowledgeEndpointModule,
    WebhookReceiverModule,
    OutboundModule,
    OutboundSmsModule,
    OutboundVoiceModule,
    FlipEngineModule,
    TrackingModule,
    FlipAcceptModule,
    DriverPingsModule,
    DriverJobsModule,
    ConviniModule,
    RateLimitingModule,
    AuditLogModule,
    AdminDigestModule,
    AdminSystemModule,
    TenantOnboardingModule,
    BrandingModule,
    KnowledgePackModule,
    SuperAdminModule,
    PartnerModule,
    BillingModule,
    ReportsModule,
    PushModule,
  ],
  controllers: [HealthController, DomainStatusController],
  providers: [
    // Per-tenant admin IP allow-list. The guard self-skips when the
    // tenants.allowed_admin_ips column is empty (default), so this is a
    // no-op for tenants that haven't opted in.
    { provide: APP_GUARD, useClass: AdminIpAllowListGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware, AdminCspMiddleware).forRoutes('*');
  }
}
