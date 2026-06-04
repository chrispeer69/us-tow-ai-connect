import { Pool } from 'pg';
async function run() {
  const pool = new Pool({ connectionString: 'postgresql://ustow:ustow_dev@localhost:5435/ustow' });
  try {
    await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_id UUID;');
    await pool.query('ALTER TABLE tenant_members ADD COLUMN IF NOT EXISTS user_id UUID;');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);');
    await pool.query('ALTER TABLE users ADD CONSTRAINT users_google_id_unique UNIQUE (google_id);');
    console.log('ALTER TABLES successful!');
  } catch(e) {
    console.error(e);
  }
  await pool.end();
}
run();
