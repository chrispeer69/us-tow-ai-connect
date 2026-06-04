import { Pool } from 'pg';

async function run() {
  const pool = new Pool({ connectionString: 'postgresql://ustow:ustow_dev@localhost:5435/ustow' });
  const res = await pool.query("SELECT id, status, source, caller_name, created_at, source_job_id, updated_at FROM unified_jobs WHERE status IN ('new', 'assigned', 'en_route', 'on_scene', 'in_tow')");
  console.log(JSON.stringify(res.rows, null, 2));
  await pool.end();
}
run();
