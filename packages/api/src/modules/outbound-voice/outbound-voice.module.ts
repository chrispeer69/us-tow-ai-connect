import { Module } from '@nestjs/common';
import { GeocoderService } from '../command-center/geocoder.service';
import { DbModule } from '../../db/db.module';
import { OutboundSmsModule } from '../outbound-sms/outbound-sms.module';
import { PushModule } from '../push/push.module';
import { OutboundVoiceController } from './outbound-voice.controller';
import { OutboundVoiceWebhookController } from './outbound-voice-webhook.controller';
import { PublicDemoCallController } from './public-demo-call.controller';
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
  // PushModule: a flip win buzzes every registered manager device (Session 77),
  // alongside the manager SMS that already fires from the same place.
  imports: [DbModule, OutboundSmsModule, PushModule],
  controllers: [
    OutboundVoiceController,
    OutboundVoiceWebhookController,
    PublicDemoCallController,
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
    // Session 75 — the test-call path geocodes the pickup so it picks a real
    // nearest shop instead of the first DB row and a hardcoded 3 miles.
    // Provided directly rather than by importing CommandCenterModule:
    // GeocoderService only needs REDIS_CLIENT, which is @Global, so this avoids
    // a module cycle with flip-engine (which already depends on this service).
    GeocoderService,
  ],
  exports: [OutboundVoiceService],
})
export class OutboundVoiceModule {}
