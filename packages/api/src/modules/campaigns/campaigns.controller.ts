import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { CampaignsService } from './campaigns.service';
import { CampaignDialerService } from './campaign-dialer.service';

/**
 * Session 78 — the admin surface for outreach campaigns.
 *
 * Every route is tenant-scoped through AdminAuthGuard: the tenant id comes off
 * the verified JWT, never off the request body. A vendor can only ever see and
 * dial its own list.
 *
 * These endpoints are what both the Campaigns UI and the `usta` CLI talk to —
 * there is one implementation of "add a lead", not two that drift.
 */
@Controller('v1/admin/campaigns')
@UseGuards(AdminAuthGuard)
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly dialer: CampaignDialerService,
  ) {}

  @Get()
  async list(@Req() req: AdminRequest) {
    return { data: await this.campaigns.listCampaigns(req.tenantId) };
  }

  @Get(':id')
  async get(@Req() req: AdminRequest, @Param('id') id: string) {
    return { data: await this.campaigns.getCampaign(req.tenantId, id) };
  }

  @Get(':id/status')
  async status(@Req() req: AdminRequest, @Param('id') id: string) {
    return { data: await this.campaigns.status(req.tenantId, id) };
  }

  @Patch(':id')
  async update(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body()
    body: {
      status?: string;
      concurrency?: number;
      dailyCap?: number;
      maxAttempts?: number;
      callWindowStartHour?: number;
      callWindowEndHour?: number;
      callDays?: number[];
      outboundAgentId?: string;
      outboundAgentVersion?: string;
      inboundAgentId?: string;
      inboundAgentVersion?: string;
      fromNumber?: string;
    },
  ) {
    return { data: await this.campaigns.updateCampaign(req.tenantId, id, body) };
  }

  /**
   * Bulk ingest. Accepts either a raw paste (`text`) or structured `rows`.
   *
   * Returns the full report — added, duplicates, suppressed, and every invalid
   * row with its reason. An ingest that cannot account for what it dropped is
   * how a list quietly rots.
   */
  @Post(':id/leads')
  async addLeads(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: { text?: string; rows?: Array<{ phone: string; company?: string; state?: string }>; source?: string },
  ) {
    const rows = body.rows?.length
      ? body.rows
      : body.text
        ? this.campaigns.parseIngestText(body.text)
        : null;
    if (!rows || rows.length === 0) {
      throw new BadRequestException('provide `text` (paste or CSV) or `rows`');
    }
    return {
      data: await this.campaigns.ingest(req.tenantId, id, rows, body.source ?? 'csv'),
    };
  }

  /** Mark a profile claimed — the win condition. */
  @Post('leads/accepted')
  async accept(@Req() req: AdminRequest, @Body() body: { phone?: string }) {
    if (!body?.phone) throw new BadRequestException('phone is required');
    return { data: await this.campaigns.markAccepted(req.tenantId, body.phone) };
  }

  /** Permanent do-not-call. */
  @Post('leads/dnc')
  async dnc(@Req() req: AdminRequest, @Body() body: { phone?: string; reason?: string; quote?: string }) {
    if (!body?.phone) throw new BadRequestException('phone is required');
    return {
      data: await this.campaigns.suppress(req.tenantId, body.phone, body.reason ?? 'manual', body.quote),
    };
  }

  /**
   * Launch a batch.
   *
   * `dryRun` resolves every guard and reports what WOULD be dialled without
   * placing a call. It is the only safe way to check a freshly imported list,
   * and it is allowed against an OFF campaign for exactly that reason.
   */
  @Post(':id/run')
  async run(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: { limit?: number; dryRun?: boolean },
  ) {
    return {
      data: await this.dialer.run(req.tenantId, id, {
        limit: body?.limit,
        dryRun: body?.dryRun === true,
      }),
    };
  }

  /** The call list — what Chris reads and listens to. */
  @Get(':id/calls')
  async calls(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Query('disposition') disposition?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return {
      data: await this.campaigns.listCalls(req.tenantId, {
        campaignId: id,
        disposition,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      }),
    };
  }

  @Get('calls/:callId')
  async call(@Req() req: AdminRequest, @Param('callId') callId: string) {
    return { data: await this.campaigns.getCall(req.tenantId, callId) };
  }
}
