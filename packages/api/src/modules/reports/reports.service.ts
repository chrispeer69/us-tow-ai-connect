import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, isNotNull, lte, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type Redis from 'ioredis';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { drivers, smsMessages, unifiedJobs } from '../../db/schema';
import {
  type JobsPerDayReport,
  type ReportMetric,
  type ReportRange,
  type ResolvedRange,
  type ResponseTimeReport,
  type RevenueReport,
  type SmsVolumeReport,
  type TopDriversReport,
  type WinRateReport,
} from './reports.types';

const MS_PER_DAY = 86_400_000;
const CACHE_TTL_SECONDS = 300; // 5 min — large aggregates over the whole window.

/** UTC 'YYYY-MM-DD' key for a Date. */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve a `range` query param into an inclusive UTC day window.
 *
 *   7d / 30d / 90d  → that many days ending today (today + N-1 prior days)
 *   custom          → explicit `from`/`to` (YYYY-MM-DD); falls back to 30d
 *                     if either is missing or unparseable.
 *
 * Pure + exported so the windowing math is unit-testable without a DB.
 */
export function resolveRange(
  query: { range?: string; from?: string; to?: string },
  defaultRange: ReportRange = '30d',
  now: Date = new Date(),
): ResolvedRange {
  const raw = (query.range ?? defaultRange) as ReportRange;
  const presets: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

  let from: Date;
  let to: Date;
  let range: ReportRange;

  if (raw === 'custom' && query.from && query.to) {
    const f = new Date(`${query.from}T00:00:00.000Z`);
    const t = new Date(`${query.to}T23:59:59.999Z`);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || f > t) {
      return resolveRange({ range: defaultRange }, defaultRange, now);
    }
    range = 'custom';
    from = startOfUtcDay(f);
    to = t;
  } else {
    const span = presets[raw] ?? presets[defaultRange] ?? 30;
    range = (presets[raw] ? raw : defaultRange) as ReportRange;
    to = now;
    from = startOfUtcDay(new Date(now.getTime() - (span - 1) * MS_PER_DAY));
  }

  return {
    range,
    from,
    to,
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    days: enumerateDays(from, to),
  };
}

function startOfUtcDay(d: Date): Date {
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/** Inclusive list of UTC day keys from `from`..`to` (capped at 366 to be safe). */
function enumerateDays(from: Date, to: Date): string[] {
  const out: string[] = [];
  let cursor = startOfUtcDay(from).getTime();
  const end = to.getTime();
  for (let i = 0; cursor <= end && i < 366; i++) {
    out.push(dayKey(new Date(cursor)));
    cursor += MS_PER_DAY;
  }
  return out;
}

/**
 * Operational analytics aggregator. Every method is tenant-scoped and
 * defensive: a missing table or empty tenant yields a zero-filled report
 * rather than a 500, so fresh tenants render clean empty-state charts.
 *
 * Day bucketing is done in Postgres against the UTC wall clock
 * (`AT TIME ZONE 'UTC'`) and gap-filled in JS so every day in the window
 * appears even when no rows landed on it.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ─── jobs per day ───────────────────────────────────────────────────
  async jobsPerDay(tenantId: string, win: ResolvedRange): Promise<JobsPerDayReport> {
    return this.cached(tenantId, 'jobs-per-day', win, async () => {
      const counts = await this.dayCounts(unifiedJobs.createdAt, tenantId, win);
      const points = win.days.map((date) => ({ date, jobs: counts.get(date) ?? 0 }));
      const total = points.reduce((s, p) => s + p.jobs, 0);
      return { ...this.base('jobs-per-day', win), points, total };
    });
  }

  // ─── win rate per adapter ───────────────────────────────────────────
  async winRate(tenantId: string, win: ResolvedRange): Promise<WinRateReport> {
    return this.cached(tenantId, 'win-rate', win, async () => {
      const rows = await this.safe(
        () =>
          this.db
            .select({
              source: unifiedJobs.source,
              offered: sql<number>`count(*)::int`,
              accepted: sql<number>`count(${unifiedJobs.acceptedAt})::int`,
            })
            .from(unifiedJobs)
            .where(this.windowWhere(unifiedJobs.tenantId, unifiedJobs.createdAt, tenantId, win))
            .groupBy(unifiedJobs.source),
        [] as Array<{ source: string; offered: number; accepted: number }>,
      );
      const adapters = rows
        .map((r) => ({
          source: r.source,
          offered: r.offered,
          accepted: r.accepted,
          winRate: r.offered > 0 ? Math.round((r.accepted / r.offered) * 10_000) / 10_000 : 0,
        }))
        .sort((a, b) => b.offered - a.offered);
      return { ...this.base('win-rate', win), adapters };
    });
  }

  // ─── avg response time (call → dispatch) ────────────────────────────
  async responseTime(tenantId: string, win: ResolvedRange): Promise<ResponseTimeReport> {
    return this.cached(tenantId, 'response-time', win, async () => {
      const rows = await this.safe(
        () =>
          this.db
            .select({
              day: sql<string>`to_char(${unifiedJobs.dispatchedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
              avgSeconds: sql<number>`coalesce(avg(extract(epoch from (${unifiedJobs.dispatchedAt} - ${unifiedJobs.createdAt}))), 0)::float8`,
              samples: sql<number>`count(*)::int`,
            })
            .from(unifiedJobs)
            .where(
              and(
                eq(unifiedJobs.tenantId, tenantId),
                isNotNull(unifiedJobs.dispatchedAt),
                gte(unifiedJobs.dispatchedAt, win.from),
                lte(unifiedJobs.dispatchedAt, win.to),
              ),
            )
            .groupBy(sql`1`),
        [] as Array<{ day: string; avgSeconds: number; samples: number }>,
      );
      const byDay = new Map(rows.map((r) => [r.day, r]));
      const points = win.days.map((date) => {
        const r = byDay.get(date);
        return {
          date,
          avgSeconds: r ? Math.round(r.avgSeconds) : 0,
          samples: r?.samples ?? 0,
        };
      });
      const totalSamples = points.reduce((s, p) => s + p.samples, 0);
      const weighted = points.reduce((s, p) => s + p.avgSeconds * p.samples, 0);
      const avgSeconds = totalSamples > 0 ? Math.round(weighted / totalSamples) : 0;
      return { ...this.base('response-time', win), points, avgSeconds };
    });
  }

  // ─── revenue per day (stubbed: no per-job monetary column yet) ──────
  async revenue(tenantId: string, win: ResolvedRange): Promise<RevenueReport> {
    return this.cached(tenantId, 'revenue', win, async () => {
      const counts = await this.dayCounts(
        unifiedJobs.completedAt,
        tenantId,
        win,
        isNotNull(unifiedJobs.completedAt),
      );
      const points = win.days.map((date) => ({
        date,
        completedJobs: counts.get(date) ?? 0,
        revenueCents: null,
      }));
      return {
        ...this.base('revenue', win),
        points,
        stubbed: true,
        note: 'No per-job monetary field in schema yet — showing completed-job counts. Wire to billing line items when available.',
      };
    });
  }

  // ─── top 5 drivers by completed jobs ────────────────────────────────
  async topDrivers(tenantId: string, win: ResolvedRange): Promise<TopDriversReport> {
    return this.cached(tenantId, 'top-drivers', win, async () => {
      const rows = await this.safe(
        () =>
          this.db
            .select({
              driverId: unifiedJobs.assignedDriverId,
              name: sql<string | null>`max(${drivers.name})`,
              completedJobs: sql<number>`count(*)::int`,
            })
            .from(unifiedJobs)
            .leftJoin(drivers, eq(drivers.id, unifiedJobs.assignedDriverId))
            .where(
              and(
                eq(unifiedJobs.tenantId, tenantId),
                isNotNull(unifiedJobs.assignedDriverId),
                isNotNull(unifiedJobs.completedAt),
                gte(unifiedJobs.completedAt, win.from),
                lte(unifiedJobs.completedAt, win.to),
              ),
            )
            .groupBy(unifiedJobs.assignedDriverId)
            .orderBy(sql`count(*) desc`)
            .limit(5),
        [] as Array<{ driverId: string | null; name: string | null; completedJobs: number }>,
      );
      const driverRows = rows.map((r) => ({
        driverId: r.driverId,
        name: r.name ?? 'Unknown driver',
        completedJobs: r.completedJobs,
      }));
      return { ...this.base('top-drivers', win), drivers: driverRows };
    });
  }

  // ─── SMS volume (inbound vs outbound, per day) ──────────────────────
  async smsVolume(tenantId: string, win: ResolvedRange): Promise<SmsVolumeReport> {
    return this.cached(tenantId, 'sms-volume', win, async () => {
      const rows = await this.safe(
        () =>
          this.db
            .select({
              day: sql<string>`to_char(${smsMessages.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
              direction: smsMessages.direction,
              count: sql<number>`count(*)::int`,
            })
            .from(smsMessages)
            .where(this.windowWhere(smsMessages.tenantId, smsMessages.createdAt, tenantId, win))
            .groupBy(sql`1`, smsMessages.direction),
        [] as Array<{ day: string; direction: string; count: number }>,
      );
      const inboundByDay = new Map<string, number>();
      const outboundByDay = new Map<string, number>();
      for (const r of rows) {
        const target = r.direction === 'inbound' ? inboundByDay : outboundByDay;
        target.set(r.day, (target.get(r.day) ?? 0) + r.count);
      }
      const points = win.days.map((date) => ({
        date,
        inbound: inboundByDay.get(date) ?? 0,
        outbound: outboundByDay.get(date) ?? 0,
      }));
      const totalInbound = points.reduce((s, p) => s + p.inbound, 0);
      const totalOutbound = points.reduce((s, p) => s + p.outbound, 0);
      return { ...this.base('sms-volume', win), points, totalInbound, totalOutbound };
    });
  }

  // ─── helpers ────────────────────────────────────────────────────────
  private base<M extends ReportMetric>(metric: M, win: ResolvedRange) {
    return { metric, range: win.range, from: win.fromIso, to: win.toIso };
  }

  private windowWhere(
    tenantCol: AnyPgColumn,
    dateCol: AnyPgColumn,
    tenantId: string,
    win: ResolvedRange,
  ): SQL {
    return and(eq(tenantCol, tenantId), gte(dateCol, win.from), lte(dateCol, win.to)) as SQL;
  }

  /** Count rows in unified_jobs per UTC day, gap-filled by the caller. */
  private async dayCounts(
    dateCol: AnyPgColumn,
    tenantId: string,
    win: ResolvedRange,
    extra?: SQL,
  ): Promise<Map<string, number>> {
    const conditions: SQL[] = [
      eq(unifiedJobs.tenantId, tenantId) as SQL,
      gte(dateCol, win.from),
      lte(dateCol, win.to),
    ];
    if (extra) conditions.push(extra);
    const rows = await this.safe(
      () =>
        this.db
          .select({
            day: sql<string>`to_char(${dateCol} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
            count: sql<number>`count(*)::int`,
          })
          .from(unifiedJobs)
          .where(and(...conditions))
          .groupBy(sql`1`),
      [] as Array<{ day: string; count: number }>,
    );
    return new Map(rows.map((r) => [r.day, r.count]));
  }

  /** Run a query, returning `fallback` (and logging) on any DB error. */
  private async safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn(`report query failed: ${(err as Error).message}`);
      return fallback;
    }
  }

  /**
   * Redis-backed memoization (5 min TTL). Cache + serialization failures are
   * swallowed — the report is always recomputed rather than erroring out.
   */
  private async cached<T>(
    tenantId: string,
    metric: ReportMetric,
    win: ResolvedRange,
    compute: () => Promise<T>,
  ): Promise<T> {
    const key = `reports:${tenantId}:${metric}:${win.range}:${win.fromIso}:${win.toIso}`;
    try {
      const hit = await this.redis.get(key);
      if (hit) return JSON.parse(hit) as T;
    } catch {
      // cache read failed — fall through to recompute.
    }
    const value = await compute();
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // cache write failed — non-fatal.
    }
    return value;
  }
}
