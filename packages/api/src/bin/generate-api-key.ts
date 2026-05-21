#!/usr/bin/env node
/**
 * Provisions or rotates an API key for a tenant. Usage:
 *   tsx src/bin/generate-api-key.ts <tenantId> [companyName] [ownerEmail]
 * Prints the plaintext key once to stdout and stores the bcrypt hash in the
 * tenants table. Requires DATABASE_URL.
 */
import 'reflect-metadata';
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { tenants } from '../db/schema';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function genApiKey(): { full: string; prefix: string } {
  const bytes = randomBytes(24);
  let body = '';
  for (let i = 0; i < bytes.length; i++) body += ALPHABET[bytes[i] % ALPHABET.length];
  const full = `usk_${body}`;
  return { full, prefix: full.slice(0, 12) };
}

async function main() {
  const tenantId = process.argv[2];
  const companyName = process.argv[3] ?? 'Default Tenant';
  const ownerEmail = process.argv[4] ?? 'owner@example.com';
  if (!tenantId) {
    // eslint-disable-next-line no-console
    console.error('Usage: tsx src/bin/generate-api-key.ts <tenantId> [companyName] [ownerEmail]');
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    // eslint-disable-next-line no-console
    console.error('DATABASE_URL is required');
    process.exit(2);
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  const { full, prefix } = genApiKey();
  const hash = await bcrypt.hash(full, 10);
  const existing = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (existing[0]) {
    await db
      .update(tenants)
      .set({ apiKeyHash: hash, apiKeyPrefix: prefix, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));
  } else {
    await db.insert(tenants).values({
      id: tenantId,
      companyName,
      ownerEmail,
      targetSoftwareType: 'TOWBOOK',
      apiKeyHash: hash,
      apiKeyPrefix: prefix,
    });
  }
  await pool.end();

  // eslint-disable-next-line no-console
  console.log('API key for tenant', tenantId, '(store this — it will not be shown again):');
  // eslint-disable-next-line no-console
  console.log(full);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
