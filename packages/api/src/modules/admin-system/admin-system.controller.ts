import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminSystemService } from './admin-system.service';
import type { EndpointGroup } from '../rate-limiting/throttle-tiers';

const GROUPS = ['public', 'tenant_api', 'admin', 'webhook'] as const;

const LimitOverrideSchema = z.object({
  group: z.enum(GROUPS),
  identifier: z.string().min(1).max(128),
  limit: z.number().int().positive().max(100_000),
  ttlSeconds: z.number().int().min(60).max(7 * 86_400).optional(),
});

type LimitOverrideBody = z.infer<typeof LimitOverrideSchema>;

/**
 * Operator-facing stats + control plane.
 *
 *   GET    /v1/admin/system/stats              — 24h window of throttle / audit / digest / errors.
 *   PATCH  /v1/admin/system/limits             — set a Redis throttle override.
 *   DELETE /v1/admin/system/limits/:group/:id  — clear an override.
 */
@Controller('v1/admin/system')
@UseGuards(AdminAuthGuard)
export class AdminSystemController {
  constructor(private readonly service: AdminSystemService) {}

  @Get('stats')
  async stats(
    @Req() req: AdminRequest,
    @Query('hours') hoursRaw?: string,
  ) {
    const hours = hoursRaw ? Math.min(168, Math.max(1, parseInt(hoursRaw, 10) || 24)) : 24;
    return this.service.getStats(req.tenantId, hours);
  }

  @Patch('limits')
  async setLimit(
    @Body(new ZodValidationPipe(LimitOverrideSchema)) body: LimitOverrideBody,
  ) {
    await this.service.setLimitOverride(
      body.group,
      body.identifier,
      body.limit,
      body.ttlSeconds ?? 0,
    );
    return {
      key: `throttle:override:${body.group}:${body.identifier}`,
      limit: body.limit,
      ttlSeconds: body.ttlSeconds ?? null,
    };
  }

  @Delete('limits/:group/:identifier')
  async clearLimit(
    @Param('group') group: EndpointGroup,
    @Param('identifier') identifier: string,
  ) {
    if (!GROUPS.includes(group)) {
      return { ok: false, error: `Unknown group: ${group}` };
    }
    await this.service.clearLimitOverride(group, identifier);
    return { ok: true, group, identifier };
  }
}
