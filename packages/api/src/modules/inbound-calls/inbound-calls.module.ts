import { Module } from '@nestjs/common';
import { AdminDigestModule } from '../admin-digest/admin-digest.module';
import { ClaudeClient } from '../call-review/claude.client';
import { InboundCallController } from './inbound-call.controller';
import { InboundReviewController } from './inbound-review.controller';
import { InboundReviewService } from './inbound-review.service';
import { UstdWebhookController } from './ustd-webhook.controller';

@Module({
  // AdminDigestModule exports SendGridEmailService — the daily inbound review
  // (2026-09-10) mails through the same provider and email_messages trail as
  // every other message this API sends.
  imports: [AdminDigestModule],
  controllers: [InboundCallController, UstdWebhookController, InboundReviewController],
  providers: [ClaudeClient, InboundReviewService],
})
export class InboundCallsModule {}
