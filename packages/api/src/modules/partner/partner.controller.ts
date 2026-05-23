import { Body, Controller, Post, Req, UseGuards, UsePipes } from '@nestjs/common';
import { PartnerTenantCreateSchema, type PartnerTenantCreateBody } from '@ustow/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PartnerApiKeyGuard, type PartnerRequest } from './partner-api-key.guard';
import { PartnerService } from './partner.service';

@Controller('v1/partner')
@UseGuards(PartnerApiKeyGuard)
export class PartnerController {
  constructor(private readonly service: PartnerService) {}

  @Post('tenants')
  @UsePipes(new ZodValidationPipe(PartnerTenantCreateSchema))
  bulkCreate(@Req() req: PartnerRequest, @Body() body: PartnerTenantCreateBody) {
    return this.service.bulkCreate(body, req.partnerName);
  }
}
