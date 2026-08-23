import { Module } from '@nestjs/common';
import { InboundCallController } from './inbound-call.controller';
import { UstdWebhookController } from './ustd-webhook.controller';

@Module({ controllers: [InboundCallController, UstdWebhookController] })
export class InboundCallsModule {}
