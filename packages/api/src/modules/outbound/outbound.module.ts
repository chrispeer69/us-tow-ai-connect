import { Module } from '@nestjs/common';
import { OutboundPollerCron } from './outbound-poller.cron';
import { GooglePlacesService } from './google-places.service';
import { FlipLogicService } from './flip-logic.service';
import { TwilioOutboundService } from './twilio-outbound.service';
import { TwilioWebhookController } from './webhooks/twilio-webhook.controller';

@Module({
  controllers: [TwilioWebhookController],
  providers: [OutboundPollerCron, GooglePlacesService, FlipLogicService, TwilioOutboundService],
  exports: [GooglePlacesService, FlipLogicService, TwilioOutboundService],
})
export class OutboundModule {}
