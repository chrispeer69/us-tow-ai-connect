import { Global, Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { FlipEngineController } from './flip-engine.controller';
import { FlipEngineService } from './flip-engine.service';
import { DestinationClassifierService } from './destination-classifier.service';
import { IssueClassifierService } from './issue-classifier.service';
import { FlipOrchestratorService } from './flip-orchestrator.service';

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
  imports: [TenantsModule],
  controllers: [FlipEngineController],
  providers: [
    FlipEngineService,
    DestinationClassifierService,
    IssueClassifierService,
    FlipOrchestratorService,
  ],
  exports: [
    FlipEngineService,
    DestinationClassifierService,
    IssueClassifierService,
    FlipOrchestratorService,
  ],
})
export class FlipEngineModule {}
