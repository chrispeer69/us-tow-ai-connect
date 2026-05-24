import { Body, Controller, Get, Post, Req, UseGuards, UsePipes } from '@nestjs/common';
import { CheckoutSessionSchema, type CheckoutSessionBody } from '@ustow/shared';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BillingService } from './billing.service';

/**
 * Tenant-facing billing actions. Shares the admin prefix + AdminAuthGuard with
 * AdminController; routes are disjoint (status/portal/checkout vs the legacy
 * GET /v1/admin/billing + PUT /v1/admin/billing/plan), so no route collision.
 */
@Controller('v1/admin/billing')
@UseGuards(AdminAuthGuard)
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @Get('status')
  getStatus(@Req() req: AdminRequest) {
    return this.service.getStatus(req.tenantId);
  }

  @Post('checkout')
  @UsePipes(new ZodValidationPipe(CheckoutSessionSchema))
  createCheckout(@Req() req: AdminRequest, @Body() body: CheckoutSessionBody) {
    return this.service.createCheckoutSession(req.tenantId, body);
  }

  @Get('portal')
  getPortal(@Req() req: AdminRequest) {
    return this.service.getPortalUrl(req.tenantId);
  }
}
