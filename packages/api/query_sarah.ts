import { Pool } from 'pg';
import 'dotenv/config';

async function run() {
  const pool = new Pool({ connectionString: 'postgresql://ustow:ustow_dev@localhost:5435/ustow' });
  try {
    const res = await pool.query('SELECT tenant_id, greeting_message, knowledge_pack FROM ai_agent_configs');
    for (const row of res.rows) {
      const msg = row.greeting_message || '';
      const pack = JSON.stringify(row.knowledge_pack || {});
      if (msg.toLowerCase().includes('sarah') || pack.toLowerCase().includes('sarah')) {
        console.log(`Found Sarah in tenant ${row.tenant_id}`);
        console.log('Greeting:', msg);
        console.log('Pack:', pack);
      }
    }
    console.log('Query done.');
  } catch(e) {
    console.error(e);
  }
  await pool.end();
}
run();
