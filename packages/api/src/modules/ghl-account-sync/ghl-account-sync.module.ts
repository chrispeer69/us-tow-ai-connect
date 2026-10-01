import { Module } from '@nestjs/common';
import { GhlAccountSyncService } from './ghl-account-sync.service';
import { GhlAccountSyncController } from './ghl-account-sync.controller';

@Module({
  controllers: [GhlAccountSyncController],
  providers: [GhlAccountSyncService],
  exports: [GhlAccountSyncService],
})
export class GhlAccountSyncModule {}
