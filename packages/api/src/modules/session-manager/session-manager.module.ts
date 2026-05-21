import { Module } from '@nestjs/common';
import { SessionManagerService } from './session-manager.service';
import { AdaptersModule } from '../adapters/adapters.module';

@Module({
  imports: [AdaptersModule],
  providers: [SessionManagerService],
  exports: [SessionManagerService],
})
export class SessionManagerModule {}
