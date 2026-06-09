import { Global, Module, OnModuleDestroy, Inject } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DB_CLIENT = 'DB_CLIENT';
export type DbClient = NodePgDatabase<typeof schema>;

class DbLifecycle implements OnModuleDestroy {
  constructor(@Inject('DB_POOL') private readonly pool: Pool) {}
  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: 'DB_POOL',
      useFactory: (): Pool => {
        const url = process.env.DATABASE_URL;
        if (!url) {
          console.warn('[db] DATABASE_URL not set — DB pool is null');
          return null as any;
        }
        return new Pool({ connectionString: url, max: 10 });
      },
    },
    {
      provide: DB_CLIENT,
      useFactory: (pool: Pool): DbClient => {
        if (!pool) {
          return new Proxy({} as DbClient, {
            get() {
              throw new Error('DATABASE_URL not configured');
            },
          });
        }
        return drizzle(pool, { schema });
      },
      inject: ['DB_POOL'],
    },
    DbLifecycle,
  ],
  exports: [DB_CLIENT],
})
export class DbModule {}
