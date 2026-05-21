import 'dotenv/config';
import type { Config } from 'drizzle-kit';

const url = process.env.DATABASE_URL;
if (!url) {
  // drizzle-kit requires a url at generate time too; fall back to a localhost
  // default so `pnpm db:generate` works in a fresh checkout. Migrations will
  // fail loudly without a real db.
  // eslint-disable-next-line no-console
  console.warn('[drizzle.config] DATABASE_URL not set — using localhost default');
}

const config: Config = {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: url ?? 'postgresql://postgres:postgres@localhost:5432/us_tow_ai_connect',
  },
  strict: true,
  verbose: true,
};

export default config;
