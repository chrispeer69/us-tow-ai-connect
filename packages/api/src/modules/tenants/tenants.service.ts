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
    return { ...tenant, apiKeyHash: issued.keyHash };
  }

  async findActive() {
    return await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.isActive, true));
  }
}