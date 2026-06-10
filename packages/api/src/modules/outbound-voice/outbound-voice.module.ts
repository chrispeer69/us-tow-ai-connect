import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { OutboundSmsModule } from '../outbound-sms/outbound-sms.module';
import { OutboundVoiceController } from './outbound-voice.controller';
import { OutboundVoiceWebhookController } from './outbound-voice-webhook.controller';
import { OutboundVoiceService } from './outbound-voice.service';
import { ThinkrrOutboundClient } from './thinkrr-outbound.client';
import { RetellOutboundClient } from './retell-outbound.client';
import { RetellWebhookController } from './retell-webhook.controller';
import {
  OUTBOUND_VOICE_PROVIDER,
  pickOutboundVoiceProvider,
} from './outbound-voice-provider.factory';

/**
 * Session 49 — outbound voice module.
 * Session 68 — adds Retell client + provider factory + Retell webhook controller.
 *
 * Both Thinkrr and Retell clients are provided so:
 *   - The factory can pick either based on env / config.
 *   - Legacy thinkrr_call_id rows continue to resolve through the Thinkrr
 *     webhook + cancel paths after the cutover.
 *   - Rollback is a single env var flip with zero code change.
 */
@Module({
  imports: [DbModule, OutboundSmsModule],
  controllers: [
    OutboundVoiceController,
    OutboundVoiceWebhookController,
    RetellWebhookController,
  ],
  providers: [
    ThinkrrOutboundClient,
    RetellOutboundClient,
    {
      provide: OUTBOUND_VOICE_PROVIDER,
      inject: [RetellOutboundClient, ThinkrrOutboundClient],
      useFactory: (retell: RetellOutboundClient, thinkrr: ThinkrrOutboundClient) =>
        pickOutboundVoiceProvider(retell, thinkrr),
    },
    OutboundVoiceService,
  ],
  exports: [OutboundVoiceService],
})
export class OutboundVoiceModule {}
