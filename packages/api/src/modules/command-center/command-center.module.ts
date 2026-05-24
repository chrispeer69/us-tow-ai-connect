import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module';
import { CommandCenterController } from './command-center.controller';
import { CommandCenterGateway } from './command-center.gateway';
import { CommandCenterService } from './command-center.service';
import { GeocoderService } from './geocoder.service';
import { AaaNormalizer } from './normalizers/aaa.normalizer';
import { TowbookNormalizer } from './normalizers/towbook.normalizer';

@Module({
  imports: [PushModule],
  controllers: [CommandCenterController],
  providers: [
    CommandCenterService,
    CommandCenterGateway,
    GeocoderService,
    TowbookNormalizer,
    AaaNormalizer,
  ],
  exports: [CommandCenterService, TowbookNormalizer, AaaNormalizer],
})
export class CommandCenterModule {}
