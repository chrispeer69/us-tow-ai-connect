import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { ConviniService } from './convini.service';

interface TwilioInboundBody {
  Body?: string;
  From?: string;
  To?: string;
  MessageSid?: string;
  AccountSid?: string;
  tenant_id?: string;
}

/**
 * Convini SMS receiver + admin list. The webhook path is intentionally
 * unsigned in this stub: the upstream (Twilio) is expected to forward to
 * this URL once the Convini number is configured, and Twilio signature
 * verification will be added in the same change that wires the live
 * download URL. Until then, we just persist whatever lands.
 *
 * BLOCKERS: real Twilio signature verification, CONVINI_DOWNLOAD_URL, and
 * the production payload format are all pending Chris's onboarding info.
 */
@Controller()
export class ConviniController {
  private readonly logger = new Logger(ConviniController.name);
  constructor(private readonly convini: ConviniService) {}

  @Post('webhooks/twilio/convini-sms-inbound')
  @HttpCode(200)
  async inbound(
    @Req() req: Request,
    @Body() body: TwilioInboundBody,
  ) {
    // Tenant id resolution: prefer explicit hint from the SMS body, then
    // fall back to a query param, then to the dev default. Real prod will
    // route by To= number once tenant_id <-> phone mapping lands.
    const headerTenant = req.headers['x-tenant-id'];
    const tenantId =
      body.tenant_id ||
      (typeof headerTenant === 'string' ? headerTenant : undefined) ||
      (req.query.tenant_id as string | undefined) ||
      process.env.DEFAULT_ADMIN_TENANT_ID ||
      '00000000-0000-0000-0000-000000000001';

    const messageBody = body.Body ?? '';
    if (!messageBody) {
      // Twilio always sends 200 + empty TwiML; nothing to do.
      return { status: 'success', data: { ignored: true, reason: 'empty body' } };
    }

    try {
      const result = await this.convini.ingest(tenantId, messageBody);
      if (!result) {
        return { status: 'success', data: { ignored: true, reason: 'no CONVINI marker' } };
      }
      return { status: 'success', data: result };
    } catch (err) {
      this.logger.error(`Convini ingest failed: ${(err as Error).message}`);
      throw new BadRequestException({
        status: 'error',
        code: 'CONVINI_INGEST_FAILED',
        message: (err as Error).message,
      });
    }
  }

  @Get('v1/admin/convini/incoming')
  @UseGuards(AdminAuthGuard)
  async list(@Req() req: AdminRequest, @Query('limit') limit?: string) {
    const rows = await this.convini.list(req.tenantId, limit ? Number(limit) : 50);
    return { status: 'success', data: { jobs: rows, count: rows.length } };
  }
}
