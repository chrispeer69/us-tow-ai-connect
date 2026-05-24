import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { ReportsService, resolveRange } from './reports.service';
import {
  csvFilename,
  reportToCsv,
  type AnyReport,
  type ReportMetric,
  type ReportRange,
} from './reports.types';

type ReportQuery = { range?: string; from?: string; to?: string; format?: string };

/**
 * Operational reporting endpoints. All read-only, all tenant-scoped via
 * AdminAuthGuard (req.tenantId). Every endpoint accepts:
 *   ?range=7d|30d|90d|custom  (+ from=YYYY-MM-DD&to=YYYY-MM-DD for custom)
 *   ?format=csv               → streams a CSV download instead of JSON
 */
@Controller('v1/admin/reports')
@UseGuards(AdminAuthGuard)
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('jobs-per-day')
  jobsPerDay(@Req() req: AdminRequest, @Query() q: ReportQuery, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, q, () => this.service.jobsPerDay(req.tenantId, resolveRange(q, '30d')));
  }

  @Get('win-rate')
  winRate(@Req() req: AdminRequest, @Query() q: ReportQuery, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, q, () => this.service.winRate(req.tenantId, resolveRange(q, '30d')));
  }

  @Get('response-time')
  responseTime(@Req() req: AdminRequest, @Query() q: ReportQuery, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, q, () => this.service.responseTime(req.tenantId, resolveRange(q, '7d')));
  }

  @Get('revenue')
  revenue(@Req() req: AdminRequest, @Query() q: ReportQuery, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, q, () => this.service.revenue(req.tenantId, resolveRange(q, '30d')));
  }

  @Get('top-drivers')
  topDrivers(@Req() req: AdminRequest, @Query() q: ReportQuery, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, q, () => this.service.topDrivers(req.tenantId, resolveRange(q, '30d')));
  }

  @Get('sms-volume')
  smsVolume(@Req() req: AdminRequest, @Query() q: ReportQuery, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, q, () => this.service.smsVolume(req.tenantId, resolveRange(q, '30d')));
  }

  /** JSON by default; `format=csv` sets download headers and returns CSV text. */
  private async respond<T extends AnyReport>(
    res: Response,
    q: ReportQuery,
    produce: () => Promise<T>,
  ): Promise<T | string> {
    const report = await produce();
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${csvFilename(report.metric as ReportMetric, report.range as ReportRange)}"`,
      );
      return reportToCsv(report);
    }
    return report;
  }
}
