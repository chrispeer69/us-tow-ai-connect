import { Module } from '@nestjs/common';
import { TowLogsAdapter } from './towlogs.adapter';

@Module({
  providers: [TowLogsAdapter],
  exports: [TowLogsAdapter],
})
export class TowLogsModule {}
