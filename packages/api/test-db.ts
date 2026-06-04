import { Client } from 'pg';
import 'dotenv/config';

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  
  try {
    await client.query(`
      ALTER TABLE tenant_members ADD COLUMN IF NOT EXISTS invited_by varchar(255);
      ALTER TABLE tenant_members ADD COLUMN IF NOT EXISTS accepted_at timestamp with time zone;
    `);
    
    // Add unique constraint to users if missing
    await client.query(`
      ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
    `);
    
    console.log('Fixed missing schema successfully!');
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await client.end();
  }
}
run();
