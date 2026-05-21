import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DB_CLIENT = 'DB_CLIENT';
export type DbClient = NodePgDatabase<typeof schema>;

class DbLifecycle implements OnModuleDestroy {
  constructor(private readonly pool: Pool) {}
  async onModuleDestroy() {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DB_CLIENT,
      useFactory: (): { db: DbClient; pool: Pool } | DbClient => {
        const url = process.env.DATABASE_URL;
        if (!url) {
          // Allow boot without DB for dev / non-DB endpoints. Methods that
          // touch the DB will throw clearly on first use.
          // eslint-disable-next-line no-console
          console.warn('[db] DATABASE_URL not set — DB client is a no-op stub');
          return new Proxy({} as DbClient, {
            get() {
              throw new Error('DATABASE_URL not configured');
            },
          });
        }
        const pool = new Pool({ connectionString: url, max: 10 });
        return drizzle(pool, { schema });
      },
    },
    DbLifecycle,
  ],
  exports: [DB_CLIENT],
})
export class DbModule {}
