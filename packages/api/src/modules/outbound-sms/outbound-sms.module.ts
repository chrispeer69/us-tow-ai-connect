import { Global, Module } from '@nestjs/common';
import { TwilioSignatureGuard } from '../../common/guards/twilio-signature.guard';
import { TenantsModule } from '../tenants/tenants.module';
import { SmsLogController } from './sms-log.controller';
import { SmsWebhookController } from './sms-webhook.controller';
import { TwilioSmsService } from './twilio-sms.service';

@Global()
@Module({
  imports: [TenantsModule],
  controllers: [SmsWebhookController, SmsLogController],
  providers: [TwilioSmsService, TwilioSignatureGuard],
  exports: [TwilioSmsService],
})
export class OutboundSmsModule {}
