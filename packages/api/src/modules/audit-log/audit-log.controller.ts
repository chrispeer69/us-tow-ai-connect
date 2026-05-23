import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { AuditLogService, type ActorType } from './audit-log.service';

const ACTOR_TYPES: ActorType[] = [
  'user',
  'api_key',
  'system',
  'ai_agent',
  'adapter',
  'webhook',
];

@Controller('v1/admin/audit-log')
@UseGuards(AdminAuthGuard)
export class AuditLogController {
  constructor(private readonly service: AuditLogService) {}

  /**
   * GET /v1/admin/audit-log
   *   ?actorType=user|api_key|system|ai_agent|adapter|webhook
   *   ?action=tenant.update
   *   ?resourceType=tenant
   *   ?resourceId=<uuid>
   *   ?from=2026-05-20T00:00:00Z
   *   ?to=2026-05-23T23:59:59Z
   *   ?page=1&limit=50
   */
  @Get()
  async list(
    @Req() req: AdminRequest,
    @Query() query: Record<string, string | undefined>,
  ) {
    const actorType =
      query.actorType && ACTOR_TYPES.includes(query.actorType as ActorType)
        ? (query.actorType as ActorType)
        : undefined;

    return this.service.list({
      tenantId: req.tenantId,
      actorType,
      action: query.action,
      resourceType: query.resourceType,
      resourceId: query.resourceId,
      from: query.from ? safeDate(query.from) : undefined,
      to: query.to ? safeDate(query.to) : undefined,
      page: query.page ? Math.max(1, parseInt(query.page, 10) || 1) : 1,
      limit: query.limit ? Math.min(200, parseInt(query.limit, 10) || 50) : 50,
    });
  }
}

function safeDate(input: string): Date | undefined {
  const d = new Date(input);
  return Number.isFinite(d.getTime()) ? d : undefined;
}
