/**
 * rotate-encryption-key.ts — ENCRYPTION_KEY rotation for tenant_credentials.
 *
 * Rotating ENCRYPTION_KEY is NOT a simple Railway variable swap: every row in
 * `tenant_credentials` stores AES-256-GCM ciphertext bound to the *current*
 * key. Change the key without re-encrypting and every adapter login breaks
 * (GCM auth-tag verification fails on decrypt). This script performs the
 * re-encryption: decrypt each row with the OLD key, re-encrypt with the NEW
 * key, and write the new ciphertext + IV/authTag pairs back.
 *
 * It mirrors packages/api/src/common/utils/encryption.util.ts exactly:
 *   - algorithm: aes-256-gcm
 *   - 12-byte IV generated fresh per field
 *   - username + password stored in separate columns
 *   - encryption_iv  = "<usernameIv>:<passwordIv>"   (hex, colon-joined)
 *   - auth_tag       = "<usernameTag>:<passwordTag>"  (hex, colon-joined)
 *
 * SAFETY
 *   - Dry-run is the DEFAULT. Nothing is written unless --apply is passed.
 *   - Every row is decrypted+re-encrypted+verified IN MEMORY first; a row that
 *     fails to decrypt with the OLD key (or fails round-trip verification with
 *     the NEW key) aborts the whole run before any write when --apply is set.
 *   - With --apply, all writes run inside a single transaction. Any error rolls
 *     the whole batch back — you never end up with a half-rotated table.
 *
 * USAGE
 *   # Dry run (no writes) — shows how many rows would rotate:
 *   OLD_ENCRYPTION_KEY=<64-hex> NEW_ENCRYPTION_KEY=<64-hex> \
 *     pnpm --filter @ustow/api exec tsx ../../scripts/security/rotate-encryption-key.ts
 *
 *   # Commit the rotation:
 *   OLD_ENCRYPTION_KEY=<64-hex> NEW_ENCRYPTION_KEY=<64-hex> \
 *     pnpm --filter @ustow/api exec tsx ../../scripts/security/rotate-encryption-key.ts --apply
 *
 *   DATABASE_URL is read from the environment (or packages/api/.env via dotenv).
 *
 * The OLD key is whatever ENCRYPTION_KEY is set to in Railway right now; the NEW
 * key is the value you will set it to AFTER this script reports success. See
 * docs/security/ROTATION_PLAYBOOK.md §ENCRYPTION_KEY for the full operator runbook.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Client } from 'pg';

const ALGO = 'aes-256-gcm';

function parseKey(label: string, raw: string | undefined): Buffer {
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      `${label} must be a 64-character hex string (32 bytes). Generate with: openssl rand -hex 32`,
    );
  }
  return Buffer.from(raw, 'hex');
}

function decryptField(key: Buffer, encrypted: string, ivHex: string, tagHex: string): string {
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let out = decipher.update(encrypted, 'hex', 'utf8');
  out += decipher.final('utf8');
  return out;
}

function encryptField(key: Buffer, plaintext: string): { encrypted: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { encrypted, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
}

interface CredRow {
  id: string;
  tenant_id: string;
  username_encrypted: string;
  password_encrypted: string;
  encryption_iv: string;
  auth_tag: string;
}

interface Rotated {
  id: string;
  username_encrypted: string;
  password_encrypted: string;
  encryption_iv: string;
  auth_tag: string;
}

function rotateRow(oldKey: Buffer, newKey: Buffer, row: CredRow): Rotated {
  const [uIv, pIv] = row.encryption_iv.split(':');
  const [uTag, pTag] = row.auth_tag.split(':');
  if (!uIv || !pIv || !uTag || !pTag) {
    throw new Error(`row ${row.id}: malformed iv/authTag pair (expected "<u>:<p>")`);
  }

  // Decrypt with OLD key.
  const username = decryptField(oldKey, row.username_encrypted, uIv, uTag);
  const password = decryptField(oldKey, row.password_encrypted, pIv, pTag);

  // Re-encrypt with NEW key.
  const u = encryptField(newKey, username);
  const p = encryptField(newKey, password);

  const rotated: Rotated = {
    id: row.id,
    username_encrypted: u.encrypted,
    password_encrypted: p.encrypted,
    encryption_iv: `${u.iv}:${p.iv}`,
    auth_tag: `${u.tag}:${p.tag}`,
  };

  // Verify round-trip with NEW key before we trust it.
  const vu = decryptField(newKey, rotated.username_encrypted, u.iv, u.tag);
  const vp = decryptField(newKey, rotated.password_encrypted, p.iv, p.tag);
  if (vu !== username || vp !== password) {
    throw new Error(`row ${row.id}: re-encryption round-trip verification failed`);
  }

  return rotated;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const oldKey = parseKey('OLD_ENCRYPTION_KEY', process.env.OLD_ENCRYPTION_KEY);
  const newKey = parseKey('NEW_ENCRYPTION_KEY', process.env.NEW_ENCRYPTION_KEY);

  if (Buffer.compare(oldKey, newKey) === 0) {
    throw new Error('OLD_ENCRYPTION_KEY and NEW_ENCRYPTION_KEY are identical — nothing to rotate.');
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set.');
  }

  const mode = apply ? 'APPLY (writes committed)' : 'DRY RUN (no writes)';
  console.log(`\n=== ENCRYPTION_KEY rotation — ${mode} ===\n`);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const { rows } = await client.query<CredRow>(
      `SELECT id, tenant_id, username_encrypted, password_encrypted, encryption_iv, auth_tag
         FROM tenant_credentials
         ORDER BY tenant_id`,
    );
    console.log(`Found ${rows.length} tenant_credentials row(s).`);

    // Phase 1: decrypt + re-encrypt + verify EVERY row in memory first.
    const rotated: Rotated[] = [];
    const failures: string[] = [];
    for (const row of rows) {
      try {
        rotated.push(rotateRow(oldKey, newKey, row));
        console.log(`  ✓ tenant ${row.tenant_id} (row ${row.id}) — decrypt OK, re-encrypt OK`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`tenant ${row.tenant_id} (row ${row.id}): ${msg}`);
        console.error(`  ✗ tenant ${row.tenant_id} (row ${row.id}) — ${msg}`);
      }
    }

    if (failures.length > 0) {
      console.error(
        `\nABORT: ${failures.length} row(s) failed to rotate. ` +
          `No writes performed. Check that OLD_ENCRYPTION_KEY matches the key the data was encrypted with.`,
      );
      process.exitCode = 1;
      return;
    }

    if (!apply) {
      console.log(
        `\nDRY RUN complete. ${rotated.length} row(s) would be re-encrypted. ` +
          `Re-run with --apply to commit.\n`,
      );
      return;
    }

    // Phase 2: write everything in one transaction.
    await client.query('BEGIN');
    try {
      for (const r of rotated) {
        await client.query(
          `UPDATE tenant_credentials
              SET username_encrypted = $1,
                  password_encrypted = $2,
                  encryption_iv = $3,
                  auth_tag = $4,
                  updated_at = now()
            WHERE id = $5`,
          [r.username_encrypted, r.password_encrypted, r.encryption_iv, r.auth_tag, r.id],
        );
      }
      await client.query('COMMIT');
      console.log(`\nAPPLIED: ${rotated.length} row(s) re-encrypted with the new key.`);
      console.log(
        'Next: set ENCRYPTION_KEY in Railway to the NEW value and redeploy. ' +
          'See docs/security/ROTATION_PLAYBOOK.md §ENCRYPTION_KEY.\n',
      );
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('\nFATAL:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
