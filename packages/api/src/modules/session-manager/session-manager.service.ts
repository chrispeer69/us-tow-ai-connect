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

/**
 * Overall ceiling for a single tenant's session refresh (decrypt + adapter
 * login). A hung Playwright await (e.g. a selector that never appears, or a
 * launch/navigation that stalls) must NEVER block the refresh indefinitely —
 * an unbounded await here is what previously froze the JobPollerCron (its
 * in-flight lock could never be released). Read at call time so it stays
 * overridable in tests. Default 45s. Exported so the poller can derive its
 * own watchdog ceiling from the same value.
 */
export function getSessionRefreshTimeoutMs(): number {
  const raw = Number(process.env.SESSION_REFRESH_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 45_000;
}

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
      for (const cred of tenant.credentials) {
        if (cred.sessionStatus === 'PAUSED') continue;

        const sessionKey = `session:${cred.softwareType.toLowerCase()}:${tenant.id}`;
        const ttl = await this.redis.ttl(sessionKey);

        // Refresh when ttl < 10 minutes OR key missing (ttl === -2)
        if (ttl > 600) continue;

        const timeoutMs = getSessionRefreshTimeoutMs();
        const startedAt = Date.now();
        this.logger.log(
          `Session refresh START for tenant ${tenant.id} (${cred.softwareType}) (timeout ${timeoutMs}ms)`,
        );
        try {
          const decoded = this.encryptionUtil.decrypt(
            cred.usernameEncrypted,
            cred.passwordEncrypted,
            cred.encryptionIv,
            cred.authTag,
          );
          const adapter = this.adapterFactory.getAdapter(cred.softwareType);
          // Overall timeout guard. adapter.login() opens its own Playwright
          // browser and closes it in a finally{} on every path, but an await
          // inside it can stall forever; Promise.race lets us stop WAITING so
          // this loop (and the poll cycle that may have triggered it) can never
          // hang. On timeout we throw a TIMEOUT-classified error and fall into
          // the failure path below, which marks the session invalid.
          await this.withTimeout(
            adapter.login(tenant.id, decoded),
            timeoutMs,
            `Session refresh for tenant ${tenant.id} (${cred.softwareType})`,
          );
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
            .where(eq(tenantCredentials.id, cred.id));
          this.logger.log(
            `Session refresh SUCCESS for tenant ${tenant.id} (${cred.softwareType}) in ${Date.now() - startedAt}ms`,
          );
        } catch (error) {
          const message = (error as Error).message ?? 'unknown';
          const kind = classifyFailure(message);
          // Truncate at 2000 chars so an unbounded Playwright dump cannot
          // blow up the row size.
          const reason = message.slice(0, 2000);
          this.logger.error(
            `Session refresh FAILED for tenant ${tenant.id} (${cred.softwareType}) (kind=${kind}) after ${Date.now() - startedAt}ms: ${message}`,
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
            .where(eq(tenantCredentials.id, cred.id));
          await this.notificationService.sendSessionAlert(
            tenant.ownerEmail,
            tenant.companyName,
            cred.softwareType,
          );
        }
      }
    }

    this.logger.log('Session refresh cycle complete.');
  }

  /**
   * Resolve/reject with `work`, but reject with a clear, TIMEOUT-classifiable
   * error if it has not settled within `ms`. The timer is always cleared so a
   * fast-resolving `work` does not keep the event loop alive. Note: on timeout
   * the underlying `work` promise keeps running in the background until its own
   * internal awaits settle — the adapter closes its browser in a finally{} on
   * every path, so abandoning the wait does not leak a browser indefinitely.
   */
  private async withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
