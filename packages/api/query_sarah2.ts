import { Pool } from 'pg';
import 'dotenv/config';

async function run() {
  const pool = new Pool({ connectionString: 'postgresql://ustow:ustow_dev@localhost:5435/ustow' });
  try {
    const res = await pool.query('SELECT id, outbound_voice_config FROM tenants');
    for (const row of res.rows) {
      const configStr = JSON.stringify(row.outbound_voice_config || {});
      if (configStr.toLowerCase().includes('sarah')) {
        console.log(`Found Sarah in outboundVoiceConfig for tenant ${row.id}`);
        console.log(configStr);
      }
    }
    console.log('Query done.');
  } catch(e) {
    console.error(e);
  }
  await pool.end();
}
run();
