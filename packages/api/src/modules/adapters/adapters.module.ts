import { Module } from '@nestjs/common';
import { TowbookAdapter } from './towbook/towbook.adapter';
import { AaaPortalAdapter } from './aaa-portal/aaa-portal.adapter';
import { TowLogsAdapter } from './towlogs/towlogs.adapter';
import { OmadiAdapter } from './omadi/omadi.adapter';
import { AdapterFactory } from './adapter.factory';
@Module({
  providers: [TowbookAdapter, AaaPortalAdapter, TowLogsAdapter, OmadiAdapter, AdapterFactory],
  exports: [TowbookAdapter, AaaPortalAdapter, TowLogsAdapter, OmadiAdapter, AdapterFactory],
})
export class AdaptersModule {}
