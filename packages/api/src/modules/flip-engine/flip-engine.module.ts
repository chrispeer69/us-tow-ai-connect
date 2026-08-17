import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TenantsModule } from '../tenants/tenants.module';
import { FlipEngineController } from './flip-engine.controller';
import { FlipActivityController } from './flip-activity.controller';
import { FlipEngineService } from './flip-engine.service';
import { DestinationClassifierService } from './destination-classifier.service';
import { IssueClassifierService } from './issue-classifier.service';
import { FlipOrchestratorService } from './flip-orchestrator.service';
import { FlipNotifierService } from './flip-notifier.service';
import { OutboundVoiceModule } from '../outbound-voice/outbound-voice.module';
import { CommandCenterModule } from '../command-center/command-center.module';
import { SuperAdminAuthGuard } from '../super-admin/super-admin-auth.guard';
import { AdaptersModule } from '../adapters/adapters.module';
import { AiNotesWriterService } from './ai-notes-writer.service';

/**
 * Session 49b — Flip Engine data layer.
 *
 * Owns the alpha_shops registry, AAA-branded blocklist, tenant
 * flip_engine_enabled / flip_engine_config, and the helper queries 49c
 * uses to drive the flip orchestration.
 *
 * @Global so 49c's poller + 49d's notifier can constructor-inject
 * FlipEngineService without re-importing this module everywhere.
 */
@Global()
@Module({
  imports: [
    ScheduleModule.forRoot(),
    TenantsModule,
    OutboundVoiceModule,
    CommandCenterModule,
    // AI Notes write-back needs the dispatch adapters to reach the customer's
    // own job records.
    AdaptersModule,
  ],
  controllers: [FlipEngineController, FlipActivityController],
  providers: [
    FlipEngineService,
    DestinationClassifierService,
    IssueClassifierService,
    FlipOrchestratorService,
    FlipNotifierService,
    AiNotesWriterService,
    SuperAdminAuthGuard,
  ],
  exports: [
    FlipEngineService,
    DestinationClassifierService,
    IssueClassifierService,
    FlipOrchestratorService,
    FlipNotifierService,
    AiNotesWriterService,
  ],
})
export class FlipEngineModule {}
