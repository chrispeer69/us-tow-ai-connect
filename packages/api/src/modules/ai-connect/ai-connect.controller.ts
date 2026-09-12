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

/**
 * 2026-09-10 — the caller's own number, from the `call` context Retell wraps
 * around every custom-tool POST (`{ call, name, args }`). Only trusted on an
 * inbound call: on an outbound call `from_number` is OUR dialler.
 *
 * Ten days of inbound calls (09-01..09-10): 9 of 54 lookups came back
 * not_found, and in 7 of those the caller had read out a number that was NOT
 * the phone they were calling from — the job was under their caller ID the
 * whole time. Emily then transferred. This is the fallback that catches it.
 */
/** The Retell call id from the `{ call, name, args }` wrapper, if present. */
function retellCallId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const call = (raw as Record<string, unknown>).call;
  if (!call || typeof call !== 'object') return null;
  const id = (call as Record<string, unknown>).call_id;
  return typeof id === 'string' ? id : null;
}

function retellInboundCallerId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const call = (raw as Record<string, unknown>).call;
  if (!call || typeof call !== 'object') return null;
  const c = call as Record<string, unknown>;
  if (c.direction !== 'inbound') return null;
  return typeof c.from_number === 'string' ? c.from_number : null;
}

const ClaimLookupSchema = z
  .object({
    claim_id: z.string().max(60).nullish(),
    job_reference: z.string().max(120).nullish(),
    vin_last6: z.string().max(20).nullish(),
  })
  .refine((v) => v.claim_id || v.job_reference || v.vin_last6, {
    message: 'one of claim_id, job_reference, vin_last6 is required',
  });

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
    @Body() raw: unknown,
  ) {
    const args = new UnwrapRetellArgsPipe().transform(raw) as
      | { phone?: string; job_number?: string; po_number?: string }
      | undefined;
    // 2026-09-10 — three keys, not one: our job number, the motor-club PO,
    // or the phone; caller ID as the last resort. Same route and tool name
    // so a call already in progress on the old tool config keeps working.
    const result = await this.service.lookupJob(req.tenantId, {
      phone: args?.phone ?? '',
      jobNumber: args?.job_number ?? '',
      poNumber: args?.po_number ?? '',
      fallbackPhone: retellInboundCallerId(raw),
    });
    if (!result.found) {
      return { status: 'not_found', message: result.message };
    }
    // 2026-09-11 — job_state tells Emily whether this is a live tow or one
    // that already finished (see AiConnectService.findRecentlyClosedJob).
    return {
      status: 'success',
      source: result.source,
      data: result.job,
      matched_by: result.matchedBy,
      job_state: result.jobState ?? 'active',
      ...(result.closedAt ? { closed_at: result.closedAt } : {}),
    };
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

  /**
   * Emily books a new tow. Unwraps Retell's `{ call, name, args }` body and
   * forwards it to US Tow Dispatch's phone-intake route — see
   * AiConnectService.createTowJob for why this cannot be a direct call.
   * Always 200: the result's `status` field is what Emily reads.
   */
  @Post('create-tow-job')
  @HttpCode(200)
  @UseGuards(TenantApiKeyGuard, RateLimitGuard)
  async createTowJob(@Req() req: TenantAuthenticatedRequest, @Body() raw: unknown) {
    const args = new UnwrapRetellArgsPipe().transform(raw);
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return { status: 'error', message: 'No job details were received.' };
    }
    return this.service.createTowJob(req.tenantId, {
      args: args as Record<string, unknown>,
      providerCallId: retellCallId(raw),
      fromNumber: retellInboundCallerId(raw),
    });
  }

  /**
   * A motor club rep asking about a damage claim (ClaimShield). Read-only
   * passthrough — see AiConnectService.lookupClaim for why no money fields
   * come back.
   */
  @Post('claims/lookup')
  @HttpCode(200)
  @UseGuards(TenantApiKeyGuard, RateLimitGuard)
  async lookupClaim(
    @Body(new UnwrapRetellArgsPipe(), new ZodValidationPipe(ClaimLookupSchema))
    body: z.infer<typeof ClaimLookupSchema>,
  ) {
    const result = await this.service.lookupClaim({
      claimId: body.claim_id ?? null,
      jobReference: body.job_reference ?? null,
      vinLast6: body.vin_last6 ?? null,
    });
    if (!result.found) {
      return { status: 'not_found', message: result.message };
    }
    return { status: 'success', data: result.claim };
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
