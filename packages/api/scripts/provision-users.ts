/**
 * provision-users.ts — creates Command Center logins with a known password.
 *
 * The two self-service ways to get a credential onto an account both depend on
 * outbound messaging: the invite email (SendGrid) and the password-reset OTP
 * (Twilio). While those approvals are pending, this writes the bcrypt hash
 * directly into `users` and creates an ACTIVE `tenant_members` row, which is
 * exactly the state acceptInvite() would have left behind.
 *
 * Usage:
 *   DATABASE_URL=postgres://... TENANT_ID=<uuid> pnpm tsx scripts/provision-users.ts
 *
 * Re-runnable: an existing user's password is reset to the value below and
 * their membership is repaired rather than duplicated.
 */
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';

// ─── People to provision ────────────────────────────────────────────────────
// role ∈ OWNER | DISPATCHER | DRIVER | ACCOUNTING | VIEWER
const PEOPLE: Array<{ name: string; email: string; role: string; password: string }> = [
  // All lowercase, digits only, no symbols — nothing that a phone keyboard's
  // autocapitalise or a missed shift key can turn into a failed sign-in.
  { name: 'Nichole Deis', email: 'nicholedeis@gmail.com', role: 'DISPATCHER', password: 'nichole2026tow' },
  { name: 'Alyssa McCloud', email: 'alyssamccloud14@gmail.com', role: 'DISPATCHER', password: 'alyssa2026tow' },
];

async function run() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString)
      ? undefined
      : { rejectUnauthorized: false },
  });

  // ─── Resolve the target tenant ────────────────────────────────────────────
  let tenantId = process.env.TENANT_ID;
  const { rows: tenantRows } = await pool.query(
    'SELECT id, company_name FROM tenants ORDER BY created_at ASC',
  );
  if (!tenantId) {
    if (tenantRows.length !== 1) {
      console.error('Set TENANT_ID to one of:');
      for (const t of tenantRows) console.error(`  ${t.id}  ${t.company_name}`);
      await pool.end();
      process.exit(1);
    }
    tenantId = tenantRows[0].id;
  }
  const tenant = tenantRows.find((t: { id: string }) => t.id === tenantId);
  if (!tenant) {
    console.error(`TENANT_ID ${tenantId} not found.`);
    await pool.end();
    process.exit(1);
  }
  console.log(`Tenant: ${tenant.company_name} (${tenantId})\n`);

  const issued: Array<{ name: string; email: string; role: string; password: string }> = [];

  for (const person of PEOPLE) {
    const email = person.email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(person.password, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Upsert the platform identity. On conflict the password is reset, which
      // keeps this usable for "I lost it, send it again".
      const userResult = await client.query(
        `INSERT INTO users (email, password_hash, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               name          = COALESCE(users.name, EXCLUDED.name),
               updated_at    = now()
         RETURNING id`,
        [email, passwordHash, person.name],
      );
      const userId = userResult.rows[0].id;

      // Attach (or repair) the membership, already ACTIVE so no invite token is
      // ever needed.
      const existing = await client.query(
        `SELECT id FROM tenant_members
          WHERE tenant_id = $1 AND lower(email) = $2
          LIMIT 1`,
        [tenantId, email],
      );

      if (existing.rowCount && existing.rowCount > 0) {
        await client.query(
          `UPDATE tenant_members
              SET user_id = $1,
                  name = COALESCE(name, $2),
                  role = $3,
                  status = 'ACTIVE',
                  accepted_at = COALESCE(accepted_at, now()),
                  invite_token = NULL,
                  invite_token_expires_at = NULL
            WHERE id = $4`,
          [userId, person.name, person.role, existing.rows[0].id],
        );
        console.log(`updated  ${email}  (${person.role})`);
      } else {
        await client.query(
          `INSERT INTO tenant_members
             (tenant_id, user_id, email, name, role, status, accepted_at)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', now())`,
          [tenantId, userId, email, person.name, person.role],
        );
        console.log(`created  ${email}  (${person.role})`);
      }

      await client.query('COMMIT');
      issued.push({ ...person, email });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`FAILED   ${email}: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  console.log('\n─── Credentials (share securely) ───');
  for (const c of issued) {
    console.log(`\n${c.name}\n  email:    ${c.email}\n  password: ${c.password}\n  role:     ${c.role}`);
  }
  console.log();

  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
