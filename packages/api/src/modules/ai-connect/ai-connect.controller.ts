import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  type PipeTransform,
} from '@nestjs/common';
import { z } from 'zod';
import {
  DispatchRequestCreateSchema,
  LogInteractionRequestSchema,
  SmartActionRequestSchema,
  type DispatchRequestCreate,
  type LogInteractionRequest,
  type SmartActionRequest,
} from '@ustow/shared';
import { ApiKeyGuard, type AuthenticatedRequest } from '../../common/guards/api-key.guard';
import {
  TenantApiKeyGuard,
  type TenantAuthenticatedRequest,
} from '../../common/guards/tenant-api-key.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AiConnectService } from './ai-connect.service';

/**
 * What Emily may put on the dispatch board. Only the callback number and the
 * message itself are required — everything else is a bonus, and rejecting a
 * message because the topic was odd would lose the customer's words entirely.
 */
/**
 * Retell's POST custom-tool calls wrap the LLM's arguments inside
 * `{ call: {...entire call context...}, name: "...", args: {...} }` — not
 * the flat body a `parameters` schema seems to promise. Discovered
 * 2026-08-25: `lookup_job_by_phone` had correct-looking config (POST,
 * content-type: application/json) and still failed on every real call,
 * because `@Body('phone')` was reading a top-level key that never existed
 * — the real value was at `body.args.phone`. Unwraps `args` when present so
 * a Zod schema or a plain `@Body('field')` sees the actual arguments.
 */
class UnwrapRetellArgsPipe implements PipeTransform {
  transform(value: unknown): unknown {
    if (value && typeof value === 'object' && 'args' in (value as Record<string, unknown>)) {
      return (value as Record<string, unknown>).args;
    }
    return value;
  }
}

const DispatchMessageSchema = z.object({
  caller_phone: z.string().min(7).max(32),
  message: z.string().min(1).max(2000),
  caller_name: z.string().max(160).nullish(),
  job_number: z.string().max(60).nullish(),
  topic: z.string().max(60).nullish(),
  urgency: z.enum(['normal', 'urgent']).nullish(),
  callback_requested: z.boolean().nullish(),
  callback_window: z.string().max(160).nullish(),
  call_reference: z.string().max(120).nullish(),
});

@Controller('v1/ai-connect')
export class AiConnectController {
  private readonly logger = new Logger(AiConnectController.name);
  constructor(private readonly service: AiConnectService) {}

  // ---- legacy endpoints (x-api-key) ----
  @Get('transfer-route')
  @UseGuards(ApiKeyGuard, RateLimitGuard)
  async getTransferRoute(@Req() req: AuthenticatedRequest) {
    const rule = await this.service.getActiveTransferRoute(req.tenantId);
    return {
      status: 'success',
      data: { transfer_number: rule.phoneNumber, label: rule.ruleName },
    };
  }

  @Post('log-interaction')
  @HttpCode(201)
  @UseGuards(ApiKeyGuard, RateLimitGuard)
  @UsePipes(new ZodValidationPipe(LogInteractionRequestSchema))
  async logInteraction(
    @Req() req: AuthenticatedRequest,
    @Body() body: LogInteractionRequest,
  ) {
    await this.service.logInteraction(req.tenantId, body);
    return { status: 'success', message: 'Interaction logged successfully.' };
  }

  // ---- Session 23: agent lookup/dispatch endpoints (X-Tenant-API-Key) ----
  /**
   * POST, not GET. Retell custom tools never fill LLM-supplied arguments
   * into query_params or the URL — only the request body — per
   * https://docs.retellai.com/build/single-multi-prompt/custom-function.
   * This was a GET with `query_params: { phone: '{{phone}}' }` and that
   * template was never substituted: every call silently hit `phone is
   * required` and Emily fell through to "not found" -> transfer, on every
   * ETA-check and motor-club lookup, regardless of whether the job existed.
   */
  @Post('lookup/by-phone')
  @HttpCode(200)
  @UseGuards(TenantApiKeyGuard, RateLimitGuard)
  async lookupByPhone(
    @Req() req: TenantAuthenticatedRequest,
    @Body(new UnwrapRetellArgsPipe()) args: { phone?: string },
  ) {
    const result = await this.service.lookupByPhone(req.tenantId, args?.phone ?? '');
    if (!result.found) {
      return { status: 'not_found', message: result.message };
    }
    return { status: 'success', source: result.source, data: result.job };
  }

  /**
   * Emily leaves a message for dispatch rather than transferring the call.
   *
   * Deliberately forgiving about everything except the two fields a message is
   * useless without — who to ring back, and what to tell them. A validation
   * error here is a customer's message thrown on the floor mid-call.
   */
  @Post('dispatch-message')
  @HttpCode(201)
  @UseGuards(TenantApiKeyGuard, RateLimitGuard)
  async dispatchMessage(
    @Req() req: TenantAuthenticatedRequest,
    @Body(new UnwrapRetellArgsPipe(), new ZodValidationPipe(DispatchMessageSchema))
    body: z.infer<typeof DispatchMessageSchema>,
  ) {
    return this.service.takeDispatchMessage(req.tenantId, {
      callerPhone: body.caller_phone,
      message: body.message,
      callerName: body.caller_name ?? null,
      jobNumber: body.job_number ?? null,
      topic: body.topic ?? null,
      urgency: body.urgency ?? null,
      callbackRequested: body.callback_requested ?? true,
      callbackWindow: body.callback_window ?? null,
      providerCallId: body.call_reference ?? null,
    });
  }

  @Get('eta')
  @UseGuards(TenantApiKeyGuard, RateLimitGuard)
  async getEta(
    @Req() req: TenantAuthenticatedRequest,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ) {
    const latNum = lat ? Number(lat) : null;
    const lngNum = lng ? Number(lng) : null;
    const data = await this.service.estimateEta(req.tenantId, latNum, lngNum);
    return { status: 'success', data };
  }

  @Get('services')
  @UseGuards(TenantApiKeyGuard, RateLimitGuard)
  async getServices(@Req() req: TenantAuthenticatedRequest) {
    const data = await this.service.getServices(req.tenantId);
    return { status: 'success', data };
  }

  @Post('dispatch-request')
  @HttpCode(201)
  @UseGuards(TenantApiKeyGuard, RateLimitGuard)
  @UsePipes(new ZodValidationPipe(DispatchRequestCreateSchema))
  async createDispatchRequest(
    @Req() req: TenantAuthenticatedRequest,
    @Body() body: DispatchRequestCreate,
  ) {
    const data = await this.service.createDispatchRequest(req.tenantId, body);
    return { status: 'success', data };
  }

  @Post('smart-action')
  @HttpCode(202)
  @UseGuards(TenantApiKeyGuard, RateLimitGuard)
  @UsePipes(new ZodValidationPipe(SmartActionRequestSchema))
  async smartAction(
    @Req() req: TenantAuthenticatedRequest,
    @Body() body: SmartActionRequest,
  ) {
    const data = await this.service.recordSmartAction(req.tenantId, body);
    return { status: 'accepted', data };
  }
}
