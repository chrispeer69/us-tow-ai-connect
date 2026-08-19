import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import {
  attentionDismissals,
  outboundCallLogs,
  outboundCalls,
  tenants,
} from '../../db/schema';
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
    //
    // "Today" MUST be the tenant's today, not the server's. This was
    // `new Date(); setHours(0,0,0,0)`, which is the server's local midnight —
    // UTC on Railway. At 8:14pm in Columbus it is already 00:14 UTC, so the
    // window had started fourteen minutes earlier and the whole working day
    // counted as yesterday: the board showed six wins in the list and 0 / 0 /
    // 0% in the tiles above them.
    //
    // That is not a cosmetic bug. It breaks for the four hours between 8pm ET
    // and midnight ET, which is exactly the evening window this board exists to
    // be watched in.
    //
    // Done in SQL against the tenant's own zone rather than with JS date maths,
    // so it stays correct across DST without anyone remembering it exists.
    const tenantRow = await this.db
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, req.tenantId))
      .limit(1);
    const tz = tenantRow[0]?.timezone || 'America/New_York';

    const today = await this.db
      .select()
      .from(outboundCallLogs)
      .where(
        and(
          eq(outboundCallLogs.tenantId, req.tenantId),
          sql`(${outboundCallLogs.callTime} AT TIME ZONE ${tz})::date
              = (now() AT TIME ZONE ${tz})::date`,
        ),
      );
    const todayWins = today.filter((r) => bucketOutcome(r) === 'WIN').length;
    const todaySkipped = today.filter((r) => bucketOutcome(r) === 'SKIPPED').length;
    const todayLosses = today.length - todayWins - todaySkipped;

    // Session 77 — Chris, 2026-08-19: "when a call does not complete, alert the
    // cell phone, make that job red and pop it up in a bubble so we know we need
    // to intervene."
    //
    // This cannot come from outbound_call_logs. A call nobody answered has no
    // meaningful log row — no duration, no transcript, nothing to show — and the
    // fact that MATTERS ("we dialled three times and gave up") lives on
    // outbound_calls.attempts. So it is queried separately and returned
    // alongside, rather than trying to squeeze it into the activity list.
    //
    // Scoped to the tenant's last 24 hours: an unanswered job from last week is
    // history, not something anyone is going to intervene on now.
    const needsAttention = await this.db
      .select({
        id: outboundCalls.id,
        customerName: outboundCalls.toName,
        customerPhone: outboundCalls.toPhone,
        attempts: outboundCalls.attempts,
        maxAttempts: outboundCalls.maxAttempts,
        status: outboundCalls.status,
        error: outboundCalls.error,
        lastTriedAt: outboundCalls.updatedAt,
        // Chris, 2026-08-19: confirming you are handling a call must not make it
        // disappear. "That call stays red in the flow so we know it was a non-AI
        // call, and we can review those." So a dismissal marks the row as
        // claimed; it never removes it. The tick replaces the X, the red stays.
        handledBy: attentionDismissals.dismissedBy,
        handledAt: attentionDismissals.dismissedAt,
      })
      .from(outboundCalls)
      .leftJoin(
        attentionDismissals,
        eq(attentionDismissals.outboundCallId, outboundCalls.id),
      )
      .where(
        and(
          eq(outboundCalls.tenantId, req.tenantId),
          // Terminal-and-unreachable only. 'failed' is included because a dial
          // that never connected is the same problem for a dispatcher as one
          // that rang out.
          sql`${outboundCalls.status} IN ('no_answer', 'busy', 'rejected', 'failed')`,
          // Only once the automated attempts are genuinely spent — otherwise the
          // board would light up red for a job that is about to be redialled.
          sql`${outboundCalls.attempts} >= ${outboundCalls.maxAttempts}`,
          sql`${outboundCalls.updatedAt} > NOW() - INTERVAL '24 hours'`,
        ),
      )
      .orderBy(desc(outboundCalls.updatedAt))
      .limit(25);

    return {
      status: 'success',
      data: {
        items: filtered,
        needsAttention,
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
