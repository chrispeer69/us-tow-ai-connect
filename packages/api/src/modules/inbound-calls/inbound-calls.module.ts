import { Module } from '@nestjs/common';
import { InboundCallController } from './inbound-call.controller';

@Module({ controllers: [InboundCallController] })
export class InboundCallsModule {}
