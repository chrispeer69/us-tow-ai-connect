import { Module } from '@nestjs/common';
import { GhlAccountSyncService } from './ghl-account-sync.service';

@Module({
  providers: [GhlAccountSyncService],
  exports: [GhlAccountSyncService],
})
export class GhlAccountSyncModule {}
