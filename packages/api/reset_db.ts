import { Pool } from 'pg';
import { execSync } from 'child_process';

const pool = new Pool({ connectionString: 'postgresql://ustow:ustow_dev@localhost:5435/ustow' });

async function reset() {
  console.log('Dropping schema public...');
  await pool.query('DROP SCHEMA public CASCADE;');
  await pool.query('CREATE SCHEMA public;');
  
  console.log('Running drizzle-kit push...');
  // Force it by answering yes to prompts using child_process
  execSync('pnpm dlx drizzle-kit push < /dev/null', { stdio: 'inherit' });
  
  console.log('Running seed script...');
  execSync('pnpm run db:seed:tenant-zero', { stdio: 'inherit' });
  
  console.log('Done!');
  process.exit(0);
}

reset().catch(console.error);
