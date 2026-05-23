import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLogService } from './audit-log.service';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { AuditLogController } from './audit-log.controller';
import { AuditLogRetentionService } from './audit-log-retention.cron';

/**
 * Session 26 — Bundle B section 2.
 *
 * Wires the audit log service + interceptor + retention cron + admin
 * controller. The interceptor is registered as a global APP_INTERCEPTOR so
 * every POST/PUT/PATCH/DELETE under /v1/admin/*, /v1/ai-connect/* and
 * /v1/partner/* lands a row without each module having to opt in.
 *
 * The service is `@Global` so any module can inject AuditLogService and
 * call `record()` directly when domain-specific before/after detail is
 * worth capturing.
 */
@Global()
@Module({
  controllers: [AuditLogController],
  providers: [
    AuditLogService,
    AuditLogRetentionService,
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
  exports: [AuditLogService],
})
export class AuditLogModule {}
