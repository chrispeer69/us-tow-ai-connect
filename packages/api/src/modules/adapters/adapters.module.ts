import { Module } from '@nestjs/common';
import { TowbookAdapter } from './towbook/towbook.adapter';
import { AaaPortalAdapter } from './aaa-portal/aaa-portal.adapter';
import { AdapterFactory } from './adapter.factory';

@Module({
  providers: [TowbookAdapter, AaaPortalAdapter, AdapterFactory],
  exports: [TowbookAdapter, AaaPortalAdapter, AdapterFactory],
})
export class AdaptersModule {}
