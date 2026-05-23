import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { tenantApiKeys, tenants } from '../../db/schema';

@Injectable()
export class TenantsService {
  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  async getById(id: string) {
    const rows = await this.db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * Resolve the tenant for an incoming API key prefix. Looks at both
   *  1. the legacy single-key column on `tenants`, and
   *  2. the per-tenant key table populated by /v1/admin/api-keys.
   *
   * Returns the tenant row plus the matching key hash so the guard can
   * bcrypt-compare against the right value.
   */
  async findByApiKeyPrefix(prefix: string) {
    const direct = (
      await this.db
        .select()
        .from(tenants)
        .where(eq(tenants.apiKeyPrefix, prefix))
        .limit(1)
    )[0];
    if (direct && direct.isActive) {
      return direct;
    }

    const issued = (
      await this.db
        .select({
          tenantId: tenantApiKeys.tenantId,
          keyHash: tenantApiKeys.keyHash,
        })
        .from(tenantApiKeys)
        .where(
          and(eq(tenantApiKeys.keyPrefix, prefix), isNull(tenantApiKeys.revokedAt)),
        )
        .limit(1)
    )[0];
    if (!issued) return null;

    const tenant = (
      await this.db
        .select()
        .from(tenants)
        .where(eq(tenants.id, issued.tenantId))
        .limit(1)
    )[0];
    if (!tenant || !tenant.isActive) return null;
    // Override the tenant.apiKeyHash that the guard bcrypt-compares against,
    // so the same guard works for legacy + per-tenant keys without a second
    // code path.
    return { ...tenant, apiKeyHash: issued.keyHash };
  }
}
