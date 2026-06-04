import { Pool } from 'pg';
async function run() {
  const pool = new Pool({ connectionString: 'postgresql://ustow:ustow_dev@localhost:5435/ustow' });
  await pool.query('DELETE FROM users');
  console.log('users truncated');
  await pool.end();
}
run();
