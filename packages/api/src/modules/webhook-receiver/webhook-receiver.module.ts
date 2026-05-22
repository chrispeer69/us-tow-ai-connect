import { Module } from '@nestjs/common';
import { WebhookReceiverController } from './webhook-receiver.controller';
import { WebhookReceiverService } from './webhook-receiver.service';

@Module({
  controllers: [WebhookReceiverController],
  providers: [WebhookReceiverService],
  exports: [WebhookReceiverService],
})
export class WebhookReceiverModule {}
