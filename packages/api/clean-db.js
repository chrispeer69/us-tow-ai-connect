const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://ustow:ustow_dev@localhost:5435/ustow' });
async function run() {
  await pool.query(`UPDATE tenants SET outbound_voice_config = outbound_voice_config - 'rep_name', flip_engine_config = flip_engine_config - 'rep_name'`);
  console.log('Removed rep_name from configs in db');
  process.exit(0);
}
run();
