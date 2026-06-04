import { Pool } from 'pg';
import { execSync } from 'child_process';

const pool = new Pool({ connectionString: 'postgresql://ustow:ustow_dev@localhost:5435/ustow' });

async function reset() {
  console.log('Dropping schemas...');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE;');
  await pool.query('CREATE SCHEMA public;');
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE;');
  
  console.log('Running drizzle-kit migrate...');
  execSync('pnpm run db:migrate', { stdio: 'inherit' });
  
  console.log('Running seed script...');
  execSync('pnpm run db:seed:tenant-zero', { stdio: 'inherit' });
  
  console.log('Done!');
  process.exit(0);
}

reset().catch(console.error);
