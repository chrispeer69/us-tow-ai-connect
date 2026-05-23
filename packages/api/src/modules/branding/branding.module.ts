import { Module } from '@nestjs/common';
import {
  BrandingAdminController,
  BrandingPublicController,
  BrandingTenantController,
} from './branding.controller';
import { BrandingService } from './branding.service';
import { BrandingAssetsService } from './branding-assets.service';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [TenantsModule],
  controllers: [
    BrandingAdminController,
    BrandingTenantController,
    BrandingPublicController,
  ],
  providers: [BrandingService, BrandingAssetsService],
  exports: [BrandingService],
})
export class BrandingModule {}
