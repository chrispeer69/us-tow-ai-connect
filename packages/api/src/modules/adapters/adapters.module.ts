import { Module } from '@nestjs/common';
import { TowbookAdapter } from './towbook/towbook.adapter';
import { AdapterFactory } from './adapter.factory';

@Module({
  providers: [TowbookAdapter, AdapterFactory],
  exports: [TowbookAdapter, AdapterFactory],
})
export class AdaptersModule {}
