import { Client } from 'pg';
import 'dotenv/config';

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM tenants WHERE owner_email IN ('test_drizzle@example.com', 'test2@example.com');`);
    await client.query(`DELETE FROM users WHERE email IN ('test_drizzle@example.com', 'test2@example.com');`);
    console.log('Cleaned up test data!');
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await client.end();
  }
}
run();
