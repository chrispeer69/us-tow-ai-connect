import { Pool } from 'pg';
const pool = new Pool({ connectionString: 'postgresql://ustow:ustow_dev@localhost:5435/ustow' });
pool.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at ASC;").then(res => {
  console.log(res.rows.map(r => r.id + ': ' + r.hash).join('\n'));
  process.exit();
}).catch(console.error);
