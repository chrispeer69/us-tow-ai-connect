import { Module } from '@nestjs/common';
import { JobPollerCron } from './job-poller.cron';
import { AdaptersModule } from '../adapters/adapters.module';
import { SessionManagerModule } from '../session-manager/session-manager.module';

@Module({
  imports: [AdaptersModule, SessionManagerModule],
  providers: [JobPollerCron],
  exports: [JobPollerCron],
})
export class JobPollerModule {}
