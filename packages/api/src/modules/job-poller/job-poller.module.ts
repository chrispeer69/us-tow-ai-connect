import { Module } from '@nestjs/common';
import { JobPollerCron } from './job-poller.cron';
import { AdaptersModule } from '../adapters/adapters.module';
import { CommandCenterModule } from '../command-center/command-center.module';
import { DigitalDispatchModule } from '../digital-dispatch/digital-dispatch.module';
import { SessionManagerModule } from '../session-manager/session-manager.module';

@Module({
  imports: [AdaptersModule, SessionManagerModule, CommandCenterModule, DigitalDispatchModule],
  providers: [JobPollerCron],
  exports: [JobPollerCron],
})
export class JobPollerModule {}
