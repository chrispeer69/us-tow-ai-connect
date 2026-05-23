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
} from '@nestjs/common';
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
  @Get('lookup/by-phone')
  @UseGuards(TenantApiKeyGuard, RateLimitGuard)
  async lookupByPhone(
    @Req() req: TenantAuthenticatedRequest,
    @Query('phone') phone: string,
  ) {
    const result = await this.service.lookupByPhone(req.tenantId, phone ?? '');
    if (!result.found) {
      return { status: 'not_found', message: result.message };
    }
    return { status: 'success', source: result.source, data: result.job };
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
