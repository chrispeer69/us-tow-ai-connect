import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { AdaptersModule } from '../adapters/adapters.module';
import { TwilioSignatureGuard } from '../../common/guards/twilio-signature.guard';
import { DigitalDispatchBridge } from './digital-dispatch-bridge';
import { FlipAcceptController, FlipAcceptInboundController } from './flip-accept.controller';
import { FlipAcceptExpiryCron } from './flip-accept-expiry.cron';
import { FlipAcceptService } from './flip-accept.service';

@Module({
  imports: [TenantsModule, AdaptersModule],
  controllers: [FlipAcceptController, FlipAcceptInboundController],
  providers: [
    FlipAcceptService,
    FlipAcceptExpiryCron,
    DigitalDispatchBridge,
    TwilioSignatureGuard,
  ],
  exports: [FlipAcceptService],
})
export class FlipAcceptModule {}
