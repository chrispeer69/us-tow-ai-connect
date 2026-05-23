import {
  Body,
  Controller,
  Delete,
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
import { DigitalDispatchService } from './digital-dispatch.service';

const ConditionSchema = z.union([
  z.object({ type: z.literal('distance_max_miles'), miles: z.number().positive() }),
  z.object({
    type: z.literal('time_of_day'),
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  }),
  z.object({
    type: z.literal('day_of_week'),
    days: z.array(z.number().int().min(0).max(6)).min(1),
  }),
  z.object({ type: z.literal('service_type_in'), values: z.array(z.string()).min(1) }),
  z.object({ type: z.literal('estimated_payout_min'), amount: z.number().nonnegative() }),
  z.object({ type: z.literal('driver_available_count_min'), count: z.number().int().nonnegative() }),
  z.object({ type: z.literal('job_age_minutes_max'), minutes: z.number().int().positive() }),
  z.object({ type: z.literal('caller_phone_blacklist'), phones: z.array(z.string()) }),
  z.object({ type: z.literal('custom_jsonpath'), expression: z.string().min(1) }),
]);

const RuleCreateSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  conditions: z.array(ConditionSchema),
  action: z.enum(['accept', 'decline', 'flag']),
});

const RuleUpdateSchema = RuleCreateSchema.partial();

const TestSchema = z.object({
  job_id: z.string().uuid(),
});

@Controller('v1/admin/digital-dispatch')
@UseGuards(AdminAuthGuard)
export class DigitalDispatchController {
  constructor(private readonly service: DigitalDispatchService) {}

  @Get('rules')
  listRules(@Req() req: AdminRequest) {
    return this.service.listRules(req.tenantId);
  }

  @Post('rules')
  @UsePipes(new ZodValidationPipe(RuleCreateSchema))
  createRule(@Req() req: AdminRequest, @Body() body: z.infer<typeof RuleCreateSchema>) {
    return this.service.createRule(req.tenantId, body);
  }

  @Put('rules/:id')
  @UsePipes(new ZodValidationPipe(RuleUpdateSchema))
  updateRule(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof RuleUpdateSchema>,
  ) {
    return this.service.updateRule(req.tenantId, id, body);
  }

  @Delete('rules/:id')
  async deleteRule(@Req() req: AdminRequest, @Param('id') id: string) {
    await this.service.deleteRule(req.tenantId, id);
    return { deleted: true };
  }

  @Post('rules/:id/test')
  @UsePipes(new ZodValidationPipe(TestSchema))
  testRule(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof TestSchema>,
  ) {
    return this.service.testRule(req.tenantId, id, body.job_id);
  }

  @Get('decisions')
  listDecisions(@Req() req: AdminRequest, @Query() q: Record<string, string | undefined>) {
    return this.service.listDecisions(req.tenantId, {
      decision: q.decision,
      ruleId: q.rule_id,
      jobId: q.job_id,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
  }

  @Get('stats')
  stats(@Req() req: AdminRequest) {
    return this.service.stats(req.tenantId);
  }
}
