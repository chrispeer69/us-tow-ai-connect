const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://ustow:ustow_dev@localhost:5435/ustow' });
pool.query('SELECT id, "company_name", "outbound_voice_enabled", "outbound_voice_config" FROM tenants').then(res => {
  console.log(res.rows);
  process.exit(0);
});
