/**
 * Programmatic migration runner used both by the `db:migrate` script and by
 * the API container's startup sequence. Reads DATABASE_URL from env, applies
 * any pending SQL files under ./src/db/migrations.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { resolve } from 'path';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // eslint-disable-next-line no-console
    console.error('DATABASE_URL is required to run migrations');
    process.exit(2);
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: resolve(__dirname, 'migrations') });
  await pool.end();
  // eslint-disable-next-line no-console
  console.log('Migrations applied');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
