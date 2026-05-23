import { Module } from '@nestjs/common';
import { AdminDigestController } from './admin-digest.controller';
import { DigestMetricsService } from './digest-metrics.service';
import { DigestSchedulerService } from './digest-scheduler.cron';
import { SendGridEmailService } from './sendgrid-email.service';

/**
 * Session 26 — Bundle B section 3.
 *
 * Daily / weekly summary email per tenant. The scheduler cron is driven by
 * @nestjs/schedule (already mounted globally in AppModule), so no extra
 * ScheduleModule.forRoot needed here.
 *
 * SendGrid is a soft dependency: if SENDGRID_API_KEY is unset every send
 * lands as status='logged_only' in email_messages and the recipient list
 * is logged at INFO. No crash, no exception.
 */
@Module({
  controllers: [AdminDigestController],
  providers: [
    DigestMetricsService,
    DigestSchedulerService,
    SendGridEmailService,
  ],
  exports: [DigestSchedulerService, SendGridEmailService],
})
export class AdminDigestModule {}
