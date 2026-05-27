import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { and, desc, eq, gte, type SQL } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { outboundCallLogs } from '../../db/schema';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';

/**
 * Session 49d — Flip activity log.
 *
 * Read-only feed backing the `/admin/flip-engine` Flip Activity tab.
 * Filters: outcome (WIN / LOSS / SKIPPED), source, since-date.
 *
 * Routed under the existing flip-engine admin namespace so the path
 * pattern stays consistent.
 */
@Controller('v1/admin/flip-engine/activity')
@UseGuards(AdminAuthGuard)
export class FlipActivityController {
  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  @Get()
  async list(
    @Req() req: AdminRequest,
    @Query('outcome') outcome?: string, // WIN | LOSS | SKIPPED | ALL
    @Query('source') source?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const filters: SQL[] = [eq(outboundCallLogs.tenantId, req.tenantId)];
    if (outcome && outcome.toUpperCase() !== 'ALL') {
      // We bucket at SQL level using the existing flip_outcome column when
      // possible; LOSS/SKIPPED join multiple states so they're filtered in
      // memory below for clarity.
    }
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const off = Math.max(Number(offset) || 0, 0);

    const rows = await this.db
      .select()
      .from(outboundCallLogs)
      .where(and(...filters))
      .orderBy(desc(outboundCallLogs.callTime))
      .limit(lim)
      .offset(off);

    const filtered = rows.filter((r) => {
      if (outcome && outcome.toUpperCase() !== 'ALL') {
        const status = bucketOutcome(r);
        if (status !== outcome.toUpperCase()) return false;
      }
      if (source) {
        const src = (r.motorClub ?? '').toLowerCase();
        if (source.toLowerCase() === 'aaa' && src !== 'aaa') return false;
        if (source.toLowerCase() === 'towbook' && src === 'aaa') return false;
      }
      return true;
    });

    // Today aggregates for the activity stats strip.
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const today = await this.db
      .select()
      .from(outboundCallLogs)
      .where(
        and(eq(outboundCallLogs.tenantId, req.tenantId), gte(outboundCallLogs.callTime, startOfDay)),
      );
    const todayWins = today.filter((r) => bucketOutcome(r) === 'WIN').length;
    const todaySkipped = today.filter((r) => bucketOutcome(r) === 'SKIPPED').length;
    const todayLosses = today.length - todayWins - todaySkipped;

    return {
      status: 'success',
      data: {
        items: filtered,
        limit: lim,
        offset: off,
        today: {
          total: today.length,
          wins: todayWins,
          losses: todayLosses,
          skipped: todaySkipped,
          winRate: today.length > 0 ? Math.round((todayWins / today.length) * 100) : 0,
        },
      },
    };
  }
}

function bucketOutcome(r: typeof outboundCallLogs.$inferSelect): 'WIN' | 'LOSS' | 'SKIPPED' {
  if (r.flipOutcome && /WIN|ACCEPTED/i.test(r.flipOutcome)) return 'WIN';
  if (!r.flipEligible) return 'SKIPPED';
  return 'LOSS';
}
