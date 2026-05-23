import { Module } from '@nestjs/common';
import { PartnerController } from './partner.controller';
import { PartnerService } from './partner.service';
import { PartnerApiKeyGuard } from './partner-api-key.guard';

@Module({
  controllers: [PartnerController],
  providers: [PartnerService, PartnerApiKeyGuard],
  exports: [PartnerService],
})
export class PartnerModule {}
