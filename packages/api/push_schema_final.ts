import { execSync } from 'child_process';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: 'postgresql://ustow:ustow_dev@localhost:5435/ustow' });
  
  console.log('Dropping schemas to get a clean slate...');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE;');
  await pool.query('CREATE SCHEMA public;');
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE;');
  await pool.end();

  console.log('Running drizzle-kit push...');
  execSync('npx drizzle-kit push', { stdio: 'inherit' });

  console.log('Running seeder...');
  execSync('pnpm run db:seed', { stdio: 'inherit' });
  
  console.log('Database synced with schema.ts and seeded!');
}

main().catch(console.error);
