import { Module } from '@nestjs/common';
import { AdminDigestModule } from '../admin-digest/admin-digest.module';
import { PushModule } from '../push/push.module';
import { ClaudeClient } from '../call-review/claude.client';
import { AlphaCrashCallsController } from './alpha-crash-calls.controller';
import { AlphaCrashMiddlewareClient } from './alpha-crash-middleware.client';
import { AlphaCrashReviewService } from './alpha-crash-review.service';

@Module({
  // AdminDigestModule exports SendGridEmailService, reused by the daily review
  // email — same provider, same email_messages audit trail as everything else
  // that sends mail from this API.
  imports: [PushModule, AdminDigestModule],
  controllers: [AlphaCrashCallsController],
  providers: [AlphaCrashMiddlewareClient, ClaudeClient, AlphaCrashReviewService],
})
export class AlphaCrashCallsModule {}
