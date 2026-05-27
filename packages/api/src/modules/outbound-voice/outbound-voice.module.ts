import { Global, Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { OutboundVoiceController } from './outbound-voice.controller';
import { OutboundVoiceService } from './outbound-voice.service';
import { OutboundVoiceWebhookController } from './outbound-voice-webhook.controller';
import { ThinkrrOutboundClient } from './thinkrr-outbound.client';

/**
 * Session 49 — Outbound voice orchestrator.
 *
 * Mirrors the OutboundSmsModule shape: @Global so other modules can import
 * the service for lifecycle hooks (notifyJobDispatched et al.) without
 * having to add the module to their own imports[].
 */
@Global()
@Module({
  imports: [TenantsModule],
  controllers: [OutboundVoiceController, OutboundVoiceWebhookController],
  providers: [OutboundVoiceService, ThinkrrOutboundClient],
  exports: [OutboundVoiceService],
})
export class OutboundVoiceModule {}
