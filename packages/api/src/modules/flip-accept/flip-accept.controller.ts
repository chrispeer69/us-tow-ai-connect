import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard, type AuthenticatedRequest } from '../../common/guards/api-key.guard';
import { TenantApiKeyGuard, type TenantAuthenticatedRequest } from '../../common/guards/tenant-api-key.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { TwilioSignatureGuard } from '../../common/guards/twilio-signature.guard';
import { TwilioSmsService } from '../outbound-sms/twilio-sms.service';
import { FlipAcceptService } from './flip-accept.service';

interface CreateRequestBody {
  tenant_id?: string;
  source_adapter?: string;
  source_job_id?: string;
  job_summary?: Record<string, unknown>;
  manager_phones?: string[];
}

interface ManualOverrideBody {
  decision: 'approve' | 'decline';
  notes?: string | null;
  reason?: string | null;
  actor?: string | null;
}

interface TwilioInboundBody {
  From?: string;
  To?: string;
  Body?: string;
  MessageSid?: string;
}

const HELP_REPLY =
  'Reply YES to accept, NO REASON to decline, or YES NOTE followed by your notes in CAPS.';

@Controller('v1/flip-accept')
export class FlipAcceptController {
  private readonly logger = new Logger(FlipAcceptController.name);

  constructor(
    private readonly service: FlipAcceptService,
    private readonly sms: TwilioSmsService,
  ) {}

  // ─── creation (server-to-server with legacy x-api-key) ─────────────
  @Post('request')
  @HttpCode(201)
  @UseGuards(ApiKeyGuard, RateLimitGuard)
  async create(@Req() req: AuthenticatedRequest, @Body() body: CreateRequestBody) {
    const tenantId = body.tenant_id ?? req.tenantId;
    if (!tenantId || !body.source_adapter || !body.source_job_id) {
      return {
        status: 'error',
        code: 'INVALID_PAYLOAD',
        message: 'tenant_id, source_adapter, source_job_id are required',
      };
    }
    const row = await this.service.createRequest({
      tenantId,
      sourceAdapter: body.source_adapter,
      sourceJobId: body.source_job_id,
      jobSummary: body.job_summary ?? {},
      managerPhones: body.manager_phones ?? null,
    });
    return {
      status: 'success',
      data: {
        id: row.id,
        status: row.status,
        expires_at: row.expiresAt.toISOString(),
        source_adapter: row.sourceAdapter,
        source_job_id: row.sourceJobId,
      },
    };
  }

  // ─── history (per-tenant) ───────────────────────────────────────────
  @Get('history')
  @UseGuards(TenantApiKeyGuard, RateLimitGuard)
  async history(
    @Req() req: TenantAuthenticatedRequest,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const data = await this.service.listHistory(req.tenantId, {
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { status: 'success', data };
  }

  // ─── manual override ────────────────────────────────────────────────
  @Post('manual-override')
  @HttpCode(200)
  @UseGuards(TenantApiKeyGuard, RateLimitGuard)
  async manualOverride(
    @Req() req: TenantAuthenticatedRequest,
    @Body() body: ManualOverrideBody & { request_id?: string },
  ) {
    if (!body?.request_id || !body?.decision) {
      return { status: 'error', code: 'INVALID_PAYLOAD', message: 'request_id + decision required' };
    }
    const updated = await this.service.manualOverride(req.tenantId, body.request_id, {
      decision: body.decision,
      notes: body.notes ?? null,
      reason: body.reason ?? null,
      actor: body.actor ?? 'admin',
    });
    return {
      status: 'success',
      data: { id: updated.id, status: updated.status, responded_at: updated.respondedAt },
    };
  }

  // Inbound SMS handler lives in FlipAcceptInboundController (below), because
  // Twilio posts to /webhooks/twilio/sms-inbound and that path is on a
  // different controller prefix.
}

@Controller('webhooks/twilio')
@UseGuards(TwilioSignatureGuard)
export class FlipAcceptInboundController {
  private readonly logger = new Logger(FlipAcceptInboundController.name);

  constructor(
    private readonly service: FlipAcceptService,
    private readonly sms: TwilioSmsService,
  ) {}

  @Post('sms-inbound')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  async inbound(@Body() body: TwilioInboundBody): Promise<string> {
    const fromPhone = (body?.From ?? '').trim();
    const toPhone = (body?.To ?? '').trim();
    const rawBody = (body?.Body ?? '').trim();

    if (!fromPhone || !rawBody) {
      this.logger.warn('sms-inbound received without From/Body');
      return '<Response/>';
    }

    const stopCheck = rawBody.toUpperCase();
    if (['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'STOPALL'].includes(stopCheck)) {
      this.logger.log(`STOP received from ${fromPhone}`);
      return this.twimlReply('You have been opted out of automated messages.');
    }

    let result: Awaited<ReturnType<FlipAcceptService['applyInboundReply']>>;
    try {
      result = await this.service.applyInboundReply({ fromPhone, rawBody });
    } catch (err) {
      this.logger.error(`applyInboundReply failed: ${(err as Error).message}`);
      return this.twimlReply(HELP_REPLY);
    }

    if (result.request) {
      // Record the inbound message audit row tied to the matched request.
      await this.sms
        .recordInbound({
          tenantId: result.request.tenantId,
          fromPhone,
          toPhone,
          body: rawBody,
          twilioSid: body?.MessageSid ?? null,
          relatedFlipRequestId: result.request.id,
        })
        .catch((err) =>
          this.logger.warn(`recordInbound failed: ${(err as Error).message}`),
        );
    }

    return this.twimlReply(result.reply ?? HELP_REPLY);
  }

  private twimlReply(message: string): string {
    const safe = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<Response><Message>${safe}</Message></Response>`;
  }
}
