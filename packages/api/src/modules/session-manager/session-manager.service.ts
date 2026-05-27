import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { tenants, tenantCredentials } from '../../db/schema';
import { EncryptionUtil } from '../../common/utils/encryption.util';
import { AdapterFactory } from '../adapters/adapter.factory';
import { NotificationService } from '../notifications/notification.service';
import { classifyFailure } from './classify-failure';

@Injectable()
export class SessionManagerService {
  private readonly logger = new Logger(SessionManagerService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly encryptionUtil: EncryptionUtil,
    private readonly adapterFactory: AdapterFactory,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Runs every 15 minutes. Refreshes any tenant session that is within 10
   * minutes of expiry, or missing entirely. On failure, marks the credential
   * row as FAILED and dispatches an alert email.
   */
  @Cron('0 */15 * * * *')
  async refreshExpiringSessions(): Promise<void> {
    if (!process.env.DATABASE_URL) {
      this.logger.debug('refreshExpiringSessions: DATABASE_URL not set, skipping');
      return;
    }

    this.logger.log('Starting session refresh cycle...');

    const activeTenants = await this.db.query.tenants.findMany({
      where: eq(tenants.isActive, true),
      with: { credentials: true },
    });

    for (const tenant of activeTenants) {
      const cred = tenant.credentials;
      if (!cred) continue;

      const sessionKey = `session:${tenant.targetSoftwareType.toLowerCase()}:${tenant.id}`;
      const ttl = await this.redis.ttl(sessionKey);

      // Refresh when ttl < 10 minutes OR key missing (ttl === -2)
      if (ttl > 600) continue;

      try {
        const decoded = this.encryptionUtil.decrypt(
          cred.usernameEncrypted,
          cred.passwordEncrypted,
          cred.encryptionIv,
          cred.authTag,
        );
        const adapter = this.adapterFactory.getAdapter(tenant.targetSoftwareType);
        await adapter.login(tenant.id, decoded);
        await this.db
          .update(tenantCredentials)
          .set({
            sessionStatus: 'ACTIVE',
            lastLoginSuccess: new Date(),
            updatedAt: new Date(),
            // Clear failure observability after a successful login so the
            // admin UI doesn't keep showing a stale reason.
            failureReason: null,
            failureKind: null,
            failedLoginCount: 0,
            lastFailureAt: null,
          })
          .where(eq(tenantCredentials.tenantId, tenant.id));
        this.logger.log(`Session refreshed for tenant ${tenant.id}`);
      } catch (error) {
        const message = (error as Error).message ?? 'unknown';
        const kind = classifyFailure(message);
        // Truncate at 2000 chars so an unbounded Playwright dump cannot
        // blow up the row size.
        const reason = message.slice(0, 2000);
        this.logger.error(
          `Session refresh FAILED for tenant ${tenant.id} (kind=${kind}): ${message}`,
        );
        await this.db
          .update(tenantCredentials)
          .set({
            sessionStatus: 'FAILED',
            updatedAt: new Date(),
            failureReason: reason,
            failureKind: kind,
            lastFailureAt: new Date(),
            failedLoginCount: sql`${tenantCredentials.failedLoginCount} + 1`,
          })
          .where(eq(tenantCredentials.tenantId, tenant.id));
        await this.notificationService.sendSessionAlert(
          tenant.ownerEmail,
          tenant.companyName,
          tenant.targetSoftwareType,
        );
      }
    }

    this.logger.log('Session refresh cycle complete.');
  }
}
