import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { tenants } from '../../db/schema';

@Injectable()
export class TenantsService {
  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  async getById(id: string) {
    const rows = await this.db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findByApiKeyPrefix(prefix: string) {
    const rows = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.apiKeyPrefix, prefix))
      .limit(1);
    const row = rows[0];
    if (!row || !row.isActive) return null;
    return row;
  }
}
