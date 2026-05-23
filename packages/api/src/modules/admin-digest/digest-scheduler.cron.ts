import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq, ne } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { tenants } from '../../db/schema';
import { DigestMetricsService, type DigestRange } from './digest-metrics.service';
import { renderDigestHtml } from './digest-renderer';
import { SendGridEmailService } from './sendgrid-email.service';

const DEFAULT_WEB_BASE = process.env.WEB_PUBLIC_URL ?? 'https://app.ustow-aiconnect.com';

/**
 * Daily 08:00 server-local + weekly Monday 08:00 server-local digest send.
 * Cron expressions are server-time today; if multiple timezones are in
 * scope later, each tenant should specify its own timezone column and we
 * fan-out per-timezone schedules.
 */
@Injectable()
export class DigestSchedulerService {
  private readonly logger = new Logger(DigestSchedulerService.name);
  private running = false;

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly metrics: DigestMetricsService,
    private readonly email: SendGridEmailService,
  ) {}

  @Cron('0 8 * * *', { name: 'admin-digest-daily' })
  async daily() {
    await this.runForRange('daily');
  }

  @Cron('0 8 * * 1', { name: 'admin-digest-weekly' })
  async weekly() {
    await this.runForRange('weekly');
  }

  /** Public so /v1/admin/digest/test can fire a send on demand. */
  async sendForTenant(
    tenantId: string,
    range: DigestRange,
  ): Promise<{ sent: number; recipients: string[] }> {
    const tenant = (
      await this.db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
    )[0];
    if (!tenant) return { sent: 0, recipients: [] };
    const recipients = recipientList(tenant.digestEmails);
    if (recipients.length === 0) {
      this.logger.log(`tenant=${tenantId} digest skipped — no recipients configured`);
      return { sent: 0, recipients: [] };
    }
    const metrics = await this.metrics.collect(tenantId, range);
    const html = renderDigestHtml({
      tenantName: tenant.companyName,
      metrics,
      webBaseUrl: DEFAULT_WEB_BASE,
    });
    const subject = `${range === 'weekly' ? 'Weekly' : 'Daily'} digest — ${tenant.companyName}`;
    let sent = 0;
    for (const to of recipients) {
      const result = await this.email.sendEmail({
        tenantId,
        to,
        subject,
        html,
        related: { kind: 'admin_digest', id: range },
      });
      if (result.status === 'sent' || result.status === 'logged_only') sent++;
    }
    return { sent, recipients };
  }

  async renderForTenant(tenantId: string, range: DigestRange): Promise<string | null> {
    const tenant = (
      await this.db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
    )[0];
    if (!tenant) return null;
    const metrics = await this.metrics.collect(tenantId, range);
    return renderDigestHtml({
      tenantName: tenant.companyName,
      metrics,
      webBaseUrl: DEFAULT_WEB_BASE,
    });
  }

  private async runForRange(range: DigestRange) {
    if (this.running) return;
    this.running = true;
    try {
      const eligible = await this.db
        .select({
          id: tenants.id,
          companyName: tenants.companyName,
          digestFrequency: tenants.digestFrequency,
        })
        .from(tenants)
        .where(and(eq(tenants.isActive, true), ne(tenants.digestFrequency, 'off')));

      let totalSent = 0;
      for (const t of eligible) {
        if (range === 'weekly' && t.digestFrequency !== 'weekly') continue;
        if (range === 'daily' && t.digestFrequency !== 'daily') continue;
        try {
          const result = await this.sendForTenant(t.id, range);
          totalSent += result.sent;
        } catch (err) {
          this.logger.warn(
            `tenant=${t.id} ${range} digest failed: ${(err as Error).message}`,
          );
        }
      }
      if (totalSent > 0) {
        this.logger.log(`${range} digest sweep finished — ${totalSent} email(s) dispatched`);
      }
    } catch (err) {
      this.logger.warn(`${range} digest sweep crashed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

function recipientList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (v): v is string => typeof v === 'string' && /.@./.test(v) && v.length < 320,
  );
}
