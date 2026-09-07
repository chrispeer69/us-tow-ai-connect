import { Module } from '@nestjs/common';
import { GhlRoadsideBridgeService } from '../job-poller/ghl-roadside-bridge.service';

@Module({
  providers: [GhlRoadsideBridgeService],
  exports: [GhlRoadsideBridgeService],
})
export class GhlRoadsideBridgeModule {}
