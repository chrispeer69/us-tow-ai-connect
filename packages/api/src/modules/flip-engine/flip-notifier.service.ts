import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, count, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { outboundCallLogs, tenants } from '../../db/schema';
import { TwilioSmsService } from '../outbound-sms/twilio-sms.service';
import {
  renderBatchSummarySms,
  renderDailyReportSms,
  renderFlipWinSms,
  type FlipWinTextInput,
} from './flip-sms-templates';

/**
 * Session 49d — Flip notifier.
 *
 * Three streams:
 *   1. Real-time WIN SMS.  Public method `notifyFlipWin()` triggered by
 *      the orchestrator's outcome-handling code (or by a future webhook
 *      that confirms an offer was accepted on the call).
 *   2. Batch summary every N attempts (default 10). Triggered after
 *      every flip log row is finalized; counts unread rows and emits
 *      when the threshold crosses.
 *   3. Daily 24-hour summary. Cron-driven at the configured local hour
 *      per tenant.
 *
 * All three streams skip silently when the tenant has no manager_phones
 * configured. Errors per-recipient are logged but never abort the
 * stream.
 */
@Injectable()
export class FlipNotifierService {
  private readonly logger = new Logger(FlipNotifierService.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly sms: TwilioSmsService,
  ) {}

  // ---------- stream 1: real-time WIN ----------

  async notifyFlipWin(tenantId: string, win: FlipWinTextInput): Promise<{ sent: number }> {
    const tenant = await this.fetchTenant(tenantId);
    if (!tenant) return { sent: 0 };
    const recipients = readManagerPhones(tenant);
    if (recipients.length === 0) return { sent: 0 };

    const body = renderFlipWinSms({ ...win, companyName: win.companyName ?? tenant.companyName });
    let sent = 0;
    for (const phone of recipients) {
      try {
        await this.sms.sendSms({ to: phone, body, tenantId });
        sent += 1;
      } catch (err) {
        this.logger.warn(
          `[flip-notifier] WIN SMS to ${phone} threw: ${(err as Error).message}`,
        );
      }
    }
    return { sent };
  }

  // ---------- stream 2: every-N batch summary ----------

  async maybeSendBatchSummary(tenantId: string): Promise<{ sent: number; thresholdHit: boolean }> {
    const tenant = await this.fetchTenant(tenantId);
    if (!tenant) return { sent: 0, thresholdHit: false };
    const cfg = (tenant.flipEngineConfig as Record<string, unknown> | null) ?? {};
    if (cfg.send_batch_summaries === false) return { sent: 0, thresholdHit: false };

    const windowSize = Number(cfg.batch_summary_size ?? 10);

    // Find the most recent N completed flip rows (any outcome) since the
    // last "BATCH_SENT_AT" mark. We keep the mark in flip_engine_config
    // to avoid a new schema column for v1.
    const lastSentAt = readBatchMark(tenant);
    const filters = [eq(outboundCallLogs.tenantId, tenantId)];
    if (lastSentAt) filters.push(gte(outboundCallLogs.callTime, lastSentAt));
    const rows = await this.db
      .select()
      .from(outboundCallLogs)
      .where(and(...filters))
      .orderBy(desc(outboundCallLogs.callTime))
      .limit(windowSize + 1);

    if (rows.length < windowSize) {
      return { sent: 0, thresholdHit: false };
    }

    const window = rows.slice(0, windowSize);
    const wins = window
      .filter((r) => r.flipOutcome && /WIN|ACCEPTED/i.test(r.flipOutcome))
      .map((r) => ({
        jobNumber: r.id.slice(0, 8),
        redirectedTo: r.nearestOurShop ?? '?',
        offer: pickAcceptedOffer(r),
      }));
    const losses = window
      .filter((r) => !r.flipOutcome || !/WIN|ACCEPTED/i.test(r.flipOutcome))
      .map((r) => r.id.slice(0, 8));

    // Today totals.
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayRows = await this.db
      .select()
      .from(outboundCallLogs)
      .where(
        and(
          eq(outboundCallLogs.tenantId, tenantId),
          gte(outboundCallLogs.callTime, startOfDay),
        ),
      );
    const todayWins = todayRows.filter((r) => r.flipOutcome && /WIN|ACCEPTED/i.test(r.flipOutcome)).length;
    const todayLosses = todayRows.length - todayWins;

    const recipients = readManagerPhones(tenant);
    if (recipients.length === 0) return { sent: 0, thresholdHit: true };

    const body = renderBatchSummarySms({
      companyName: tenant.companyName,
      windowSize,
      wins,
      losses,
      todayWins,
      todayLosses,
    });

    let sent = 0;
    for (const phone of recipients) {
      try {
        await this.sms.sendSms({ to: phone, body, tenantId });
        sent += 1;
      } catch (err) {
        this.logger.warn(
          `[flip-notifier] BATCH SMS to ${phone} threw: ${(err as Error).message}`,
        );
      }
    }

    // Mark the batch as sent.
    const newCfg = {
      ...cfg,
      _batch_summary_last_sent_at: new Date().toISOString(),
    };
    await this.db
      .update(tenants)
      .set({ flipEngineConfig: newCfg as never, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));

    return { sent, thresholdHit: true };
  }

  // ---------- stream 3: daily 24h summary ----------

  @Cron('0 0 * * * *') // hourly; per-tenant local-hour gate inside
  async dailyReportCron(): Promise<void> {
    if (process.env.OUTBOUND_FLIP_ENGINE_ENABLED !== 'true') return;
    const tenantIds = await this.listFlipEnabledTenantIds();
    for (const tenantId of tenantIds) {
      try {
        await this.sendDailyReportIfDue(tenantId);
      } catch (err) {
        this.logger.warn(
          `[flip-notifier] daily report tenant ${tenantId} threw: ${(err as Error).message}`,
        );
      }
    }
  }

  async sendDailyReportIfDue(tenantId: string): Promise<{ sent: number; due: boolean }> {
    const tenant = await this.fetchTenant(tenantId);
    if (!tenant) return { sent: 0, due: false };
    const cfg = (tenant.flipEngineConfig as Record<string, unknown> | null) ?? {};
    if (cfg.send_daily_report === false) return { sent: 0, due: false };

    const targetHour = Number(cfg.daily_report_hour_local ?? 21);
    const localNow = getTenantLocalNow(tenant.timezone);
    if (localNow.hour !== targetHour) return { sent: 0, due: false };

    if (cfg._daily_report_last_sent_date_local === localNow.date) {
      return { sent: 0, due: true };
    }
    const lastSent = typeof cfg._daily_report_last_sent_iso === 'string'
      ? new Date(cfg._daily_report_last_sent_iso)
      : null;
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (lastSent && lastSent > windowStart && cfg._daily_report_last_sent_date_local == null) {
      // Already sent today; skip.
      return { sent: 0, due: true };
    }

    const result = await this.sendDailyReport(tenant, windowStart, localNow.date);

    if (result.recipients.length === 0) return { sent: 0, due: true };

    // Mark as sent for today.
    const newCfg = {
      ...cfg,
      _daily_report_last_sent_iso: new Date().toISOString(),
      _daily_report_last_sent_date_local: localNow.date,
    };
    await this.db
      .update(tenants)
      .set({ flipEngineConfig: newCfg as never, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));

    return { sent: result.sent, due: true };
  }

  async sendDailyReportNow(tenantId: string): Promise<{ sent: number; recipients: string[] }> {
    const tenant = await this.fetchTenant(tenantId);
    if (!tenant) return { sent: 0, recipients: [] };
    const localNow = getTenantLocalNow(tenant.timezone);
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.sendDailyReport(tenant, windowStart, localNow.date);
  }

  private async sendDailyReport(
    tenant: typeof tenants.$inferSelect,
    windowStart: Date,
    dateLocal: string,
  ): Promise<{ sent: number; recipients: string[] }> {
    const tenantId = tenant.id;
    const rows = await this.db
      .select()
      .from(outboundCallLogs)
      .where(
        and(
          eq(outboundCallLogs.tenantId, tenantId),
          gte(outboundCallLogs.callTime, windowStart),
        ),
      );

    const wins = rows.filter((r) => r.flipOutcome && /WIN|ACCEPTED/i.test(r.flipOutcome));
    const losses = rows.length - wins.length;
    const winsByShopMap = new Map<string, number>();
    for (const w of wins) {
      const k = w.nearestOurShop ?? 'Unknown';
      winsByShopMap.set(k, (winsByShopMap.get(k) ?? 0) + 1);
    }
    const winsByOffer = {
      offer1: wins.filter((w) => w.offer1Result === 'ACCEPTED').length,
      offer2: wins.filter((w) => w.offer2Result === 'ACCEPTED').length,
      offer3: wins.filter((w) => w.offer3Result === 'ACCEPTED').length,
    };
    const towbookAttempts = rows.filter((r) => r.motorClub && !/^aaa$/i.test(r.motorClub)).length;
    const towbookWins = wins.filter((w) => w.motorClub && !/^aaa$/i.test(w.motorClub)).length;
    const aaaAttempts = rows.filter((r) => r.motorClub && /^aaa$/i.test(r.motorClub)).length;
    const aaaWins = wins.filter((w) => w.motorClub && /^aaa$/i.test(w.motorClub)).length;
    const conviniSent = rows.filter((r) => r.conviniLinkSent).length;
    const skippedAaaBranded = rows.filter((r) => r.destinationType === 'aaa_branded').length;

    const recipients = readManagerPhones(tenant);
    if (recipients.length === 0) return { sent: 0, recipients };

    const body = renderDailyReportSms({
      companyName: tenant.companyName,
      dateLocal,
      totalAttempts: rows.length,
      wins: wins.length,
      losses,
      winsByShop: Array.from(winsByShopMap.entries())
        .map(([shopName, c]) => ({ shopName, count: c }))
        .sort((a, b) => b.count - a.count),
      winsByOffer,
      source: { towbookAttempts, towbookWins, aaaAttempts, aaaWins },
      conviniSent,
      skippedAaaBranded,
    });

    let sent = 0;
    for (const phone of recipients) {
      try {
        await this.sms.sendSms({ to: phone, body, tenantId });
        sent += 1;
      } catch (err) {
        this.logger.warn(
          `[flip-notifier] DAILY SMS to ${phone} threw: ${(err as Error).message}`,
        );
      }
    }

    return { sent, recipients };
  }

  // ---------- internal ----------

  private async fetchTenant(tenantId: string) {
    const rows = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return rows[0] ?? null;
  }

  private async listFlipEnabledTenantIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.flipEngineEnabled, true), eq(tenants.isActive, true)));
    return rows.map((r) => r.id);
  }
}

function readManagerPhones(tenant: typeof tenants.$inferSelect): string[] {
  const raw = tenant.managerPhones as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function getTenantLocalNow(timeZone: string): { hour: number; date: string } {
  const safeTimeZone = timeZone || 'America/New_York';
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: safeTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
  } catch {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
  }
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    hour: Number(get('hour')),
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

function readBatchMark(tenant: typeof tenants.$inferSelect): Date | null {
  const cfg = (tenant.flipEngineConfig as Record<string, unknown> | null) ?? {};
  const v = cfg._batch_summary_last_sent_at;
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function pickAcceptedOffer(row: typeof outboundCallLogs.$inferSelect): 1 | 2 | 3 {
  if (row.offer1Result === 'ACCEPTED') return 1;
  if (row.offer2Result === 'ACCEPTED') return 2;
  if (row.offer3Result === 'ACCEPTED') return 3;
  return 1;
}

// Lint shims for unused drizzle imports if the file evolves.
void count;
void desc;
void isNull;
void lt;
void sql;
