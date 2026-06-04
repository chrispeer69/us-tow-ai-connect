import { Pool } from 'pg';
const pool = new Pool({ connectionString: 'postgresql://ustow:ustow_dev@localhost:5435/ustow' });
pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'tenants';").then(res => {
  console.log(res.rows.map(r => r.column_name).join(', '));
  process.exit();
});
