// Session 73 — the daily outbound-call review loop.
//
// A cron reads yesterday's calls, samples the transcripts (stratified so wins
// and near-misses are always included), asks Claude to classify the failure
// modes, and writes proposed script edits for a human to approve. Nothing it
// produces reaches a live call on its own.
//
// The prerequisite is script attribution (migration 0041): without
// script_version / scenario stamped on each call, no recommendation can ever be
// evaluated against the win rate it claims to move.

import { Module } from '@nestjs/common';
import { CallReviewController } from './call-review.controller';
import { CallReviewService } from './call-review.service';
import { ClaudeClient } from './claude.client';
import { RetellAgentService } from './retell-agent.service';

@Module({
  controllers: [CallReviewController],
  providers: [CallReviewService, ClaudeClient, RetellAgentService],
  exports: [CallReviewService, RetellAgentService],
})
export class CallReviewModule {}
