const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://ustow:ustow_dev@localhost:5435/ustow' });

pool.query('UPDATE tenants SET outbound_voice_enabled = true').then(res => {
  console.log(`Updated ${res.rowCount} tenants to have outbound_voice_enabled = true`);
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
