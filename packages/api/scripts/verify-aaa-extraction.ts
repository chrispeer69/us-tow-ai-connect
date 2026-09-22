/**
 * Read-only live verification for the AAA portal adapter.
 *
 * This script logs in with the already-encrypted tenant credential, runs the
 * normal scraper, and prints a privacy-limited field-presence report for one
 * Call ID. It never clicks a portal action or writes to Postgres. Redis writes
 * are limited to the same short-lived session/cache keys used by the poller.
 *
 * Run from packages/api:
 *   pnpm exec tsx scripts/verify-aaa-extraction.ts <call-id>
 */
import 'dotenv/config';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { EncryptionUtil } from '../src/common/utils/encryption.util';
import { AaaPortalAdapter } from '../src/modules/adapters/aaa-portal/aaa-portal.adapter';

async function main(): Promise<void> {
  const callId = process.argv[2]?.trim();
  if (!callId || !/^\d+$/.test(callId)) {
    throw new Error('Provide the numeric AAA Call ID as the only argument.');
  }

  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!databaseUrl || !redisUrl) {
    throw new Error('DATABASE_URL and REDIS_URL must be configured.');
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });

  try {
  const result = await pool.query<{
    tenant_id: string;
    username_encrypted: string;
    password_encrypted: string;
    encryption_iv: string;
    auth_tag: string;
  }>(`
    select tenant_id, username_encrypted, password_encrypted, encryption_iv, auth_tag
    from tenant_credentials
    where upper(software_type) in ('AAA_PORTAL', 'AAA_SALESFORCE', 'AAA')
    order by updated_at desc
    limit 1
  `);
  const row = result.rows[0];
  const tenantId = row?.tenant_id ?? 'aaa-read-only-verification';
  const credentials = row
    ? new EncryptionUtil().decrypt(
        row.username_encrypted,
        row.password_encrypted,
        row.encryption_iv,
        row.auth_tag,
      )
    : {
        username: process.env.AAA_USERNAME ?? '',
        password: process.env.AAA_PASSWORD ?? '',
      };
  if (!credentials.username || !credentials.password) {
    throw new Error('No saved AAA credential or AAA_USERNAME/AAA_PASSWORD environment values found.');
  }
  const adapter = new AaaPortalAdapter(redis);
  await adapter.login(tenantId, credentials);

  // Permit an already-cleared call to pass the adapter's historical safety
  // guard for this explicit verification only. The adapter removes this key
  // after it reads the terminal record.
  await redis.set(`aaa:observed-active:${tenantId}:${callId}`, 'verification', 'EX', 600);
  const jobs = await adapter.scrapeAllActiveJobs(tenantId);
  const job = jobs.find((candidate) => String(candidate.jobId) === callId);
  if (!job) {
    console.log(JSON.stringify({ callId, found: false }, null, 2));
  } else {
    console.log(
      JSON.stringify(
        {
          callId,
          found: true,
          status: job.status,
          serviceType: job.serviceType || null,
          vehicle: job.vehicle || null,
          customerNamePresent: Boolean(job.customerName),
          customerPhonePresent: Boolean(job.customerPhone),
          pickupPresent: Boolean(job.pickup),
          destinationPresent: Boolean(job.destination),
          latitudePresent: Boolean(job.latitude),
          longitudePresent: Boolean(job.longitude),
        },
        null,
        2,
      ),
    );
  }
  } finally {
    await Promise.allSettled([pool.end(), redis.quit()]);
  }
}

main().catch((error) => {
  console.error(`[verify-aaa-extraction] ${(error as Error).message}`);
  process.exitCode = 1;
});
