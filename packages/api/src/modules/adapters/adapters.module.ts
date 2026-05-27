import { Module } from '@nestjs/common';
import { TowbookAdapter } from './towbook/towbook.adapter';
import { AaaPortalAdapter } from './aaa-portal/aaa-portal.adapter';
import { TowLogsAdapter } from './towlogs/towlogs.adapter';
import { AdapterFactory } from './adapter.factory';

@Module({
  providers: [TowbookAdapter, AaaPortalAdapter, TowLogsAdapter, AdapterFactory],
  exports: [TowbookAdapter, AaaPortalAdapter, TowLogsAdapter, AdapterFactory],
})
export class AdaptersModule {}
