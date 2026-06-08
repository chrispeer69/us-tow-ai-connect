import postgres from 'postgres';
async function run() {
  const sql = postgres('postgresql://ustow:ustow_dev@localhost:5435/ustow');
  await sql`UPDATE tenants SET outbound_voice_config = outbound_voice_config - 'rep_name', flip_engine_config = flip_engine_config - 'rep_name'`;
  console.log('Removed rep_name from configs in db');
  await sql.end();
  process.exit(0);
}
run();
