import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { DriverJobStatusUpdateSchema, type DriverJobStatusUpdate } from '@ustow/shared';
import {
  TenantApiKeyGuard,
  type TenantAuthenticatedRequest,
} from '../../common/guards/tenant-api-key.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DriverJobsService } from './driver-jobs.service';

/**
 * Driver-app endpoints. All tenant-key authed; the driver client is treated
 * as a tenant-scoped device (same pattern as POST /v1/driver-pings). The
 * `driver_phone` query/path arg is the natural key.
 */
@Controller('v1/driver/jobs')
@UseGuards(TenantApiKeyGuard, RateLimitGuard)
export class DriverJobsController {
  constructor(private readonly service: DriverJobsService) {}

  @Get('active')
  async active(
    @Req() req: TenantAuthenticatedRequest,
    @Query('driver_phone') driverPhone?: string,
  ) {
    if (!driverPhone) {
      throw new BadRequestException({
        status: 'error',
        code: 'MISSING_DRIVER_PHONE',
        message: 'driver_phone query parameter is required',
      });
    }
    const job = await this.service.getActive(req.tenantId, driverPhone);
    return { status: 'success', data: { job } };
  }

  @Get('queue')
  async queue(
    @Req() req: TenantAuthenticatedRequest,
    @Query('driver_phone') driverPhone?: string,
  ) {
    if (!driverPhone) {
      throw new BadRequestException({
        status: 'error',
        code: 'MISSING_DRIVER_PHONE',
        message: 'driver_phone query parameter is required',
      });
    }
    const jobs = await this.service.getQueue(req.tenantId, driverPhone);
    return { status: 'success', data: { jobs, count: jobs.length } };
  }

  @Get('history')
  async history(
    @Req() req: TenantAuthenticatedRequest,
    @Query('driver_phone') driverPhone?: string,
    @Query('limit') limit?: string,
    @Query('days') days?: string,
  ) {
    if (!driverPhone) {
      throw new BadRequestException({
        status: 'error',
        code: 'MISSING_DRIVER_PHONE',
        message: 'driver_phone query parameter is required',
      });
    }
    const jobs = await this.service.getHistory(req.tenantId, driverPhone, {
      limit: limit ? Number(limit) : undefined,
      days: days ? Number(days) : undefined,
    });
    return { status: 'success', data: { jobs, count: jobs.length } };
  }

  @Post(':jobId/status')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(DriverJobStatusUpdateSchema))
  async updateStatus(
    @Req() req: TenantAuthenticatedRequest,
    @Param('jobId') jobId: string,
    @Query('driver_phone') driverPhone: string,
    @Body() body: DriverJobStatusUpdate,
  ) {
    if (!driverPhone) {
      throw new BadRequestException({
        status: 'error',
        code: 'MISSING_DRIVER_PHONE',
        message: 'driver_phone query parameter is required',
      });
    }
    try {
      const result = await this.service.updateStatus(req.tenantId, driverPhone, jobId, body);
      return { status: 'success', data: result };
    } catch (err) {
      throw new BadRequestException({
        status: 'error',
        code: 'INVALID_STATUS_UPDATE',
        message: (err as Error).message,
      });
    }
  }
}
