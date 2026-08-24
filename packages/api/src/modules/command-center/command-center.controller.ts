import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CommandCenterService } from './command-center.service';
import type { UnifiedJobStatus } from './normalizers/types';

const StatusEnum = z.enum([
  'new',
  'assigned',
  'en_route',
  'on_scene',
  'in_tow',
  'completed',
  'canceled',
  'declined',
]);

const AssignSchema = z.object({
  driver_id: z.string().uuid().nullable().optional(),
  truck_id: z.string().uuid().nullable().optional(),
});

const StatusSchema = z.object({
  status: StatusEnum,
  notes: z.string().max(500).optional(),
});

const ManualJobSchema = z.object({
  caller_name: z.string().min(1).max(255),
  caller_phone: z.string().max(20).optional().nullable(),
  vehicle_year: z.string().max(10).optional().nullable(),
  vehicle_make: z.string().max(60).optional().nullable(),
  vehicle_model: z.string().max(60).optional().nullable(),
  vehicle_color: z.string().max(40).optional().nullable(),
  pickup_address: z.string().max(500).optional().nullable(),
  dropoff_address: z.string().max(500).optional().nullable(),
  service_type: z.string().max(60).optional().nullable(),
  priority: z.enum(['low', 'normal', 'urgent']).optional(),
  notes: z.string().max(1000).optional().nullable(),
});

const DriverCreateSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().max(20).nullable().optional(),
  status: z.enum(['available', 'on_job', 'off_duty']).optional(),
});

const DriverUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(20).nullable().optional(),
  status: z.enum(['available', 'on_job', 'off_duty']).optional(),
  current_lat: z.number().nullable().optional(),
  current_lng: z.number().nullable().optional(),
});

const TruckCreateSchema = z.object({
  name: z.string().min(1).max(60),
  type: z.enum(['light', 'medium', 'heavy', 'flatbed']).optional(),
  status: z.enum(['available', 'in_use', 'out_of_service']).optional(),
  assigned_driver_id: z.string().uuid().nullable().optional(),
});

const TruckUpdateSchema = TruckCreateSchema.partial();

@Controller('v1/admin/command-center')
@UseGuards(AdminAuthGuard)
export class CommandCenterController {
  constructor(private readonly service: CommandCenterService) {}

  @Get('jobs')
  listJobs(@Req() req: AdminRequest, @Query() q: Record<string, string | undefined>) {
    return this.service.listJobs(req.tenantId, {
      status: q.status,
      source: q.source,
      driverId: q.driver_id,
      priority: q.priority,
      search: q.search,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
  }

  @Get('jobs/:id')
  getJob(@Req() req: AdminRequest, @Param('id') id: string) {
    return this.service.getJob(req.tenantId, id);
  }

  @Post('jobs/:id/assign')
  @UsePipes(new ZodValidationPipe(AssignSchema))
  assignJob(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof AssignSchema>,
  ) {
    return this.service.assignJob(req.tenantId, id, body.driver_id ?? null, body.truck_id ?? null);
  }

  @Post('jobs/:id/status')
  @UsePipes(new ZodValidationPipe(StatusSchema))
  changeStatus(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof StatusSchema>,
  ) {
    return this.service.transitionStatus(
      req.tenantId,
      id,
      body.status as UnifiedJobStatus,
      body.notes,
    );
  }

  @Post('jobs/:id/call-customer')
  callCustomer(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: { scriptType?: string },
  ) {
    return this.service.callCustomerManually(req.tenantId, id, {
      scriptType: parseManualScriptType(body?.scriptType),
    });
  }

  @Post('jobs/manual')
  @UsePipes(new ZodValidationPipe(ManualJobSchema))
  createManual(@Req() req: AdminRequest, @Body() body: z.infer<typeof ManualJobSchema>) {
    return this.service.createManualJob(req.tenantId, {
      callerName: body.caller_name,
      callerPhone: body.caller_phone ?? null,
      vehicleYear: body.vehicle_year ?? null,
      vehicleMake: body.vehicle_make ?? null,
      vehicleModel: body.vehicle_model ?? null,
      vehicleColor: body.vehicle_color ?? null,
      pickupAddress: body.pickup_address ?? null,
      dropoffAddress: body.dropoff_address ?? null,
      serviceType: body.service_type ?? null,
      priority: body.priority,
      notes: body.notes ?? null,
    });
  }

  @Get('drivers')
  listDrivers(@Req() req: AdminRequest) {
    return this.service.listDrivers(req.tenantId);
  }

  @Post('drivers')
  @UsePipes(new ZodValidationPipe(DriverCreateSchema))
  createDriver(@Req() req: AdminRequest, @Body() body: z.infer<typeof DriverCreateSchema>) {
    return this.service.createDriver(req.tenantId, body);
  }

  @Put('drivers/:id')
  @UsePipes(new ZodValidationPipe(DriverUpdateSchema))
  updateDriver(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof DriverUpdateSchema>,
  ) {
    return this.service.updateDriver(req.tenantId, id, {
      name: body.name,
      phone: body.phone,
      status: body.status,
      currentLat: body.current_lat,
      currentLng: body.current_lng,
    });
  }

  @Get('trucks')
  listTrucks(@Req() req: AdminRequest) {
    return this.service.listTrucks(req.tenantId);
  }

  @Post('trucks')
  @UsePipes(new ZodValidationPipe(TruckCreateSchema))
  createTruck(@Req() req: AdminRequest, @Body() body: z.infer<typeof TruckCreateSchema>) {
    return this.service.createTruck(req.tenantId, {
      name: body.name,
      type: body.type,
      status: body.status,
      assignedDriverId: body.assigned_driver_id ?? null,
    });
  }

  @Put('trucks/:id')
  @UsePipes(new ZodValidationPipe(TruckUpdateSchema))
  updateTruck(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof TruckUpdateSchema>,
  ) {
    return this.service.updateTruck(req.tenantId, id, {
      name: body.name,
      type: body.type,
      status: body.status,
      assignedDriverId: body.assigned_driver_id ?? null,
    });
  }

  @Get('stats')
  stats(@Req() req: AdminRequest) {
    return this.service.stats(req.tenantId);
  }

  // ─── ETA check calls ────────────────────────────────────────────────
  //
  // Customers ringing in to ask where their truck is. Emily records every one
  // through the phone lookup; this is where the office reads them.

  @Get('eta-checks')
  listEtaChecks(@Req() req: AdminRequest, @Query() q: Record<string, string | undefined>) {
    return this.service.listEtaChecks(req.tenantId, { includeHandled: q.all === '1' });
  }

  @Post('eta-checks/:id/handled')
  handleEtaCheck(@Req() req: AdminRequest, @Param('id') id: string) {
    return this.service.handleEtaCheck(req.tenantId, id, req.user?.email ?? req.user?.sub ?? null);
  }

  // ─── messages for dispatch ──────────────────────────────────────────
  //
  // What Emily wrote down instead of handing the call over. Same two moves as
  // the ETA list: read them, tick them off.

  @Get('dispatch-messages')
  listDispatchMessages(@Req() req: AdminRequest, @Query() q: Record<string, string | undefined>) {
    return this.service.listDispatchMessages(req.tenantId, { includeHandled: q.all === '1' });
  }

  @Post('dispatch-messages/:id/handled')
  handleDispatchMessage(@Req() req: AdminRequest, @Param('id') id: string) {
    return this.service.handleDispatchMessage(
      req.tenantId,
      id,
      req.user?.email ?? req.user?.sub ?? null,
    );
  }

  // ─── inbound calls (Emily) ───────────────────────────────────────────
  // Transcript + recording for every call to the 844 line — captured since
  // migration 0056, unreachable from any UI until this.

  @Get('inbound-calls')
  listInboundCalls(@Req() req: AdminRequest, @Query() q: Record<string, string | undefined>) {
    return this.service.listInboundCalls(req.tenantId, {
      phone: q.phone,
      branch: q.branch,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  }

  @Get('inbound-calls/:id')
  getInboundCall(@Req() req: AdminRequest, @Param('id') id: string) {
    return this.service.getInboundCall(req.tenantId, id);
  }
}

function parseManualScriptType(value: unknown) {
  const parsed = z
    .enum(['auto_flip', 'eta_confirmation', 'status_update', 'winch_out', 'convini_only'])
    .safeParse(value);
  return parsed.success ? parsed.data : 'auto_flip';
}
