import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { smsMessages } from '../../db/schema';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';

/**
 * Read-only audit log of all SMS activity for the current tenant. Backs the
 * admin /admin/sms-log page. Filters: direction, status, date range. The
 * admin dashboard talks to this via the Next rewrite (/api/v1/admin/sms-log)
 * which forwards the x-tenant-id header used by every other admin endpoint.
 */
@Controller('v1/admin/sms-log')
@UseGuards(AdminAuthGuard)
export class SmsLogController {
  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  @Get()
  async list(
    @Req() req: AdminRequest,
    @Query('direction') direction?: string,
    @Query('status') status?: string,
    @Query('from') fromIso?: string,
    @Query('to') toIso?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const filters: SQL[] = [eq(smsMessages.tenantId, req.tenantId)];
    if (direction === 'inbound' || direction === 'outbound') {
      filters.push(eq(smsMessages.direction, direction));
    }
    if (status) filters.push(eq(smsMessages.status, status));
    if (fromIso) {
      const d = new Date(fromIso);
      if (!isNaN(d.getTime())) filters.push(gte(smsMessages.createdAt, d));
    }
    if (toIso) {
      const d = new Date(toIso);
      if (!isNaN(d.getTime())) filters.push(lte(smsMessages.createdAt, d));
    }
    const where = and(...filters);
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const off = Math.max(Number(offset) || 0, 0);

    const items = await this.db
      .select()
      .from(smsMessages)
      .where(where)
      .orderBy(desc(smsMessages.createdAt))
      .limit(lim)
      .offset(off);

    const totalRow = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(smsMessages)
      .where(where);

    return {
      status: 'success',
      data: {
        items: items.map((row) => ({
          id: row.id,
          direction: row.direction,
          to_phone: row.toPhone,
          from_phone: row.fromPhone,
          body: row.body,
          status: row.status,
          twilio_sid: row.twilioSid,
          related_tracking_link_id: row.relatedTrackingLinkId,
          related_flip_request_id: row.relatedFlipRequestId,
          sent_at: row.sentAt,
          delivered_at: row.deliveredAt,
          error: row.error,
          created_at: row.createdAt,
        })),
        total: totalRow[0]?.count ?? 0,
        limit: lim,
        offset: off,
      },
    };
  }
}
