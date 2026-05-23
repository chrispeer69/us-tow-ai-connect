/**
 * Programmatic migration runner used both by the `db:migrate` script and by
 * the API container's startup sequence. Reads DATABASE_URL from env, applies
 * any pending SQL files under ./src/db/migrations.
 *
 * Designed to work in three execution modes:
 *   1. local dev (tsx)        — __dirname is src/db, migrations are siblings
 *   2. production (compiled)  — __dirname is dist/db, migrations live in
 *      src/db/migrations under the container, copied separately by the
 *      Dockerfile
 *   3. CI / one-off scripts   — invoked from the monorepo root
 *
 * Drizzle's migrator records applied filenames in `__drizzle_migrations` so
 * re-running is a no-op (idempotent — safe to run every deploy).
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function resolveMigrationsFolder(): string {
  const candidates = [
    // Dev: tsx-executed src/db/migrate.ts
    resolve(__dirname, 'migrations'),
    // Compiled: dist/db/migrate.js — Dockerfile keeps src/db/migrations alongside dist
    resolve(__dirname, '../../src/db/migrations'),
    // Invoked from repo root
    resolve(process.cwd(), 'packages/api/src/db/migrations'),
    // Invoked from packages/api
    resolve(process.cwd(), 'src/db/migrations'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Could not locate migrations folder. Tried:\n  - ${candidates.join('\n  - ')}`,
  );
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // eslint-disable-next-line no-console
    console.error('DATABASE_URL is required to run migrations');
    process.exit(2);
  }
  const migrationsFolder = resolveMigrationsFolder();
  // eslint-disable-next-line no-console
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder });
  await pool.end();
  // eslint-disable-next-line no-console
  console.log('[migrate] complete');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[migrate] failed', err);
  process.exit(1);
});
