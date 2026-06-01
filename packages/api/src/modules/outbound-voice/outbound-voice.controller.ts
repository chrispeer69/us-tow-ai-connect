import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { MissingVariableError } from './script-templates';
import { OutboundVoiceService } from './outbound-voice.service';

const PurposeEnum = z.enum([
  'customer_status_update',
  'eta_confirmation',
  'post_job_followup',
  'driver_escalation',
  'motor_club_update',
  'custom',
]);

const PlaceCallSchema = z.object({
  purpose: PurposeEnum,
  toPhone: z
    .string()
    .min(7)
    .max(20)
    .regex(/^[+0-9 ()\-]+$/, 'invalid phone format'),
  toName: z.string().max(120).optional().nullable(),
  scriptTemplate: z.string().min(1).max(60),
  scriptVariables: z.record(z.unknown()).default({}),
  relatedJobId: z.string().uuid().optional().nullable(),
  scheduledFor: z.string().datetime().optional().nullable(),
  maxAttempts: z.number().int().positive().max(10).optional(),
});
type PlaceCallBody = z.infer<typeof PlaceCallSchema>;

const ConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  config: z
    .object({
      dispatch_cron_enabled: z.boolean().optional(),
      dispatch_interval_seconds: z.number().int().min(5).max(3600).optional(),
      require_consent: z.boolean().optional(),
      enabled_purposes: z.array(PurposeEnum).optional(),
      thinkrr_outbound_agent_id: z.string().min(1).max(120).optional().nullable(),
    })
    .partial()
    .optional(),
});
type ConfigPatchBody = z.infer<typeof ConfigPatchSchema>;

@Controller('v1/admin/outbound-voice')
@UseGuards(AdminAuthGuard)
export class OutboundVoiceController {
  constructor(private readonly service: OutboundVoiceService) { }

  // --- calls ---

  @Post('calls')
  @UsePipes(new ZodValidationPipe(PlaceCallSchema))
  async placeCall(@Req() req: AdminRequest, @Body() body: PlaceCallBody) {
    try {
      const row = await this.service.enqueueCall({
        tenantId: req.tenantId,
        purpose: body.purpose,
        toPhone: body.toPhone,
        toName: body.toName ?? null,
        scriptTemplate: body.scriptTemplate,
        scriptVariables: body.scriptVariables,
        relatedJobId: body.relatedJobId ?? null,
        scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
        maxAttempts: body.maxAttempts,
      });
      return { status: 'success', data: row };
    } catch (err) {
      if (err instanceof MissingVariableError) {
        throw new BadRequestException({
          status: 'error',
          code: 'MISSING_VARIABLES',
          message: err.message,
          missing: err.missing,
        });
      }
      if (err instanceof Error && /disabled|not enabled/i.test(err.message)) {
        throw new BadRequestException({
          status: 'error',
          code: 'OUTBOUND_VOICE_DISABLED',
          message: err.message,
        });
      }
      throw err;
    }
  }

  @Get('calls')
  async listCalls(
    @Req() req: AdminRequest,
    @Query('purpose') purpose?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.service.listCalls(req.tenantId, {
      purpose,
      status,
      from,
      to,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { status: 'success', data: result };
  }

  @Get('calls/:id')
  async getCall(@Req() req: AdminRequest, @Param('id') id: string) {
    const row = await this.service.getCall(req.tenantId, id);
    if (!row) {
      throw new NotFoundException({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'outbound call not found',
      });
    }
    return { status: 'success', data: row };
  }

  @Post('calls/:id/cancel')
  @HttpCode(200)
  async cancelCall(@Req() req: AdminRequest, @Param('id') id: string) {
    try {
      const row = await this.service.cancelCall(req.tenantId, id);
      return { status: 'success', data: row };
    } catch (err) {
      if (err instanceof Error && /not found/i.test(err.message)) {
        throw new NotFoundException({
          status: 'error',
          code: 'NOT_FOUND',
          message: err.message,
        });
      }
      throw err;
    }
  }

  @Post('calls/:id/retry')
  @HttpCode(200)
  async retryCall(@Req() req: AdminRequest, @Param('id') id: string) {
    try {
      const row = await this.service.requeueCall(req.tenantId, id);
      return { status: 'success', data: row };
    } catch (err) {
      if (err instanceof Error && /not found/i.test(err.message)) {
        throw new NotFoundException({
          status: 'error',
          code: 'NOT_FOUND',
          message: err.message,
        });
      }
      throw err;
    }
  }

  @Delete('calls/:id')
  @HttpCode(200)
  async deleteCall(@Req() req: AdminRequest, @Param('id') id: string) {
    // DELETE is an alias for cancel — cancellation is the only "delete" the
    // audit log permits. We never actually delete rows.
    return this.cancelCall(req, id);
  }

  // --- config ---

  @Get('config')
  async getConfig(@Req() req: AdminRequest) {
    const result = await this.service.getConfig(req.tenantId);
    return { status: 'success', data: result };
  }

  @Patch('config')
  @UsePipes(new ZodValidationPipe(ConfigPatchSchema))
  async updateConfig(@Req() req: AdminRequest, @Body() body: ConfigPatchBody) {
    const result = await this.service.updateConfig(req.tenantId, body);
    return { status: 'success', data: result };
  }

  // --- debug test endpoint ---

  @Post('debug/test-call')
  @UseGuards(AdminAuthGuard)
  async testCall(
    @Req() req: AdminRequest,
    @Body() body: {
      scenario: 'competitor_repair' | 'auto_body' | 'residence' | 'our_shop' | 'unknown';
      toPhone: string;
      customerName?: string;
      vehicle?: string;
      destination?: string;
    },
  ) {
    return this.service.testCall(req.tenantId, body);
  }
}
