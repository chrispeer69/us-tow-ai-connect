import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { abCsv } from './ab-slim-gemini';
import { AbSlimGeminiService } from './ab-slim-gemini.service';

/**
 * The slim/Gemini A/B table for /m/roadside: one row per day per arm, totals
 * since the window start, the switch state, and the same rows as CSV.
 */
@Controller('v1/admin/flip-engine/ab-slim-gemini')
@UseGuards(AdminAuthGuard)
export class AbSlimGeminiController {
  constructor(private readonly ab: AbSlimGeminiService) {}

  @Get()
  async report(@Req() req: AdminRequest, @Query('days') days?: string) {
    const n = Math.min(90, Math.max(1, Number(days) || 14));
    const r = await this.ab.report(n, req.tenantId);
    return { ...r, days: n, csv: abCsv(r.rows) };
  }
}
