import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TenantApiKeyGuard, type TenantAuthenticatedRequest } from '../../common/guards/tenant-api-key.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { TrackingService } from './tracking.service';

interface CreateTrackingBody {
  caller_phone: string;
  caller_name?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  job_id?: string | null;
}

interface UpdateTrackingBody {
  status?: string;
  assigned_driver_phone?: string | null;
  assigned_driver_name?: string | null;
  last_eta_minutes?: number | null;
}

@Controller('v1/tracking')
export class TrackingController {
  constructor(private readonly service: TrackingService) {}

  @Post('create')
  @HttpCode(201)
  @UseGuards(TenantApiKeyGuard, RateLimitGuard)
  async create(
    @Req() req: TenantAuthenticatedRequest,
    @Body() body: CreateTrackingBody,
  ) {
    if (!body?.caller_phone) {
      return { status: 'error', code: 'CALLER_PHONE_REQUIRED' };
    }
    const data = await this.service.create(req.tenantId, {
      callerPhone: body.caller_phone,
      callerName: body.caller_name ?? null,
      pickupLat: body.pickup_lat ?? null,
      pickupLng: body.pickup_lng ?? null,
      jobId: body.job_id ?? null,
    });
    return { status: 'success', data };
  }

  // PUBLIC — no auth so callers can open the link from SMS.
  @Get(':token')
  async getPublic(@Param('token') token: string) {
    const data = await this.service.getPublicView(token);
    return { status: 'success', data };
  }

  @Post(':token/update')
  @HttpCode(200)
  @UseGuards(TenantApiKeyGuard, RateLimitGuard)
  async update(
    @Req() req: TenantAuthenticatedRequest,
    @Param('token') token: string,
    @Body() body: UpdateTrackingBody,
  ) {
    const data = await this.service.update(req.tenantId, token, {
      status: body?.status,
      assignedDriverPhone: body?.assigned_driver_phone,
      assignedDriverName: body?.assigned_driver_name,
      lastEtaMinutes: body?.last_eta_minutes,
    });
    return { status: 'success', data };
  }
}
