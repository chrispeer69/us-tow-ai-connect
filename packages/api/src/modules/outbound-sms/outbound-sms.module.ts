import { Global, Module } from '@nestjs/common';
import { TwilioSignatureGuard } from '../../common/guards/twilio-signature.guard';
import { SmsWebhookController } from './sms-webhook.controller';
import { TwilioSmsService } from './twilio-sms.service';

@Global()
@Module({
  controllers: [SmsWebhookController],
  providers: [TwilioSmsService, TwilioSignatureGuard],
  exports: [TwilioSmsService],
})
export class OutboundSmsModule {}
