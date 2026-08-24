import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module';
import { AlphaCrashCallsController } from './alpha-crash-calls.controller';
import { AlphaCrashMiddlewareClient } from './alpha-crash-middleware.client';

@Module({
  imports: [PushModule],
  controllers: [AlphaCrashCallsController],
  providers: [AlphaCrashMiddlewareClient],
})
export class AlphaCrashCallsModule {}
