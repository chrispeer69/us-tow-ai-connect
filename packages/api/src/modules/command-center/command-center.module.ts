import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module';
import { CommandCenterController } from './command-center.controller';
import { CommandCenterGateway } from './command-center.gateway';
import { CommandCenterService } from './command-center.service';
import { GeocoderService } from './geocoder.service';
import { AaaNormalizer } from './normalizers/aaa.normalizer';
import { TowbookNormalizer } from './normalizers/towbook.normalizer';
import { BillingModule } from '../billing/billing.module';
import { GhlRoadsideBridgeModule } from '../ghl-roadside-bridge/ghl-roadside-bridge.module';

@Module({
  imports: [BillingModule, PushModule, GhlRoadsideBridgeModule],
  controllers: [CommandCenterController],
  providers: [
    CommandCenterService,
    CommandCenterGateway,
    GeocoderService,
    TowbookNormalizer,
    AaaNormalizer,
  ],
  exports: [CommandCenterService, TowbookNormalizer, AaaNormalizer, GeocoderService],
})
export class CommandCenterModule {}
