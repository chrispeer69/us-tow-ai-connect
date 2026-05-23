import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditLogService } from './audit-log.service';

/**
 * Daily sweep — prunes audit_log rows older than each tenant's
 * `audit_retention_days` setting (default 365, configurable on the tenants
 * row). Runs at 03:00 server-local; misses are fine — the cron is idempotent
 * and a missed day just means tomorrow's run deletes two days of expired
 * rows instead of one.
 */
@Injectable()
export class AuditLogRetentionService {
  private readonly logger = new Logger(AuditLogRetentionService.name);
  private running = false;

  constructor(private readonly auditLog: AuditLogService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'audit-log-retention' })
  async sweep() {
    if (this.running) return;
    this.running = true;
    let totalDeleted = 0;
    try {
      const tenants = await this.auditLog.listAllTenantsForRetention();
      for (const t of tenants) {
        const days = Math.max(1, t.days ?? 365);
        try {
          const deleted = await this.auditLog.pruneOlderThan(t.id, days);
          totalDeleted += deleted;
          if (deleted > 0) {
            this.logger.log(`tenant=${t.id} pruned=${deleted} olderThanDays=${days}`);
          }
        } catch (err) {
          this.logger.warn(
            `tenant=${t.id} prune failed: ${(err as Error).message}`,
          );
        }
      }
      if (totalDeleted > 0) {
        this.logger.log(`retention sweep finished: ${totalDeleted} rows removed`);
      }
    } catch (err) {
      this.logger.warn(`retention sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
