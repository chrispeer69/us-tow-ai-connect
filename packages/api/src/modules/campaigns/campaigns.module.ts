import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignWebhookController } from './campaign-webhook.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignDialerService } from './campaign-dialer.service';
import { RetellCampaignClient } from './retell-campaign.client';

/**
 * Session 78 — outreach calling.
 *
 * Two controllers because the two audiences authenticate differently:
 * CampaignsController is the admin JWT surface (UI + `usta` CLI), and
 * CampaignWebhookController is Retell posting call events with an HMAC
 * signature and no session at all.
 */
@Module({
  controllers: [CampaignsController, CampaignWebhookController],
  providers: [CampaignsService, CampaignDialerService, RetellCampaignClient],
  exports: [CampaignsService, CampaignDialerService],
})
export class CampaignsModule {}
