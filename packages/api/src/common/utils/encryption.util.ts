import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * AES-256-GCM credential encryption.
 *
 * Decision (deviation from BUILD_SESSIONS.md): the spec sketch suggests
 * reusing the same IV + authTag across both the username and password
 * ciphertexts. That is cryptographically invalid — GCM auth tags are
 * derived per-ciphertext, so reusing one tag across two different
 * plaintexts will fail authentication on decrypt. We therefore generate
 * a fresh 12-byte IV per ciphertext and store IV/authTag pairs for each
 * field (see tenantCredentials schema). Documented in ASSUMPTIONS.md.
 *
 * Dev fallback: if ENCRYPTION_KEY is unset, derive a fixed dev key from
 * a known constant so local development works out-of-the-box. Production
 * MUST set ENCRYPTION_KEY to a 32-byte (64 hex char) value.
 */
@Injectable()
export class EncryptionUtil {
  private readonly logger = new Logger(EncryptionUtil.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor() {
    const raw = process.env.ENCRYPTION_KEY;
    if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) {
      this.key = Buffer.from(raw, 'hex');
    } else {
      if (!raw) {
        this.logger.warn(
          'ENCRYPTION_KEY not set — using dev-only derived key. DO NOT use in production.',
        );
      } else {
        this.logger.warn('ENCRYPTION_KEY not a 64-hex string — using dev-only derived key.');
      }
      this.key = createHash('sha256').update('ustow-dev-key-do-not-use-in-prod').digest();
    }
  }

  encrypt(plaintext: string): { encrypted: string; iv: string; authTag: string } {
    const iv = randomBytes(12);
    const cipher = createCipheriv(this.algorithm, this.key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: cipher.getAuthTag().toString('hex'),
    };
  }

  decryptValue(encrypted: string, iv: string, authTag: string): string {
    const decipher = createDecipheriv(this.algorithm, this.key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    let out = decipher.update(encrypted, 'hex', 'utf8');
    out += decipher.final('utf8');
    return out;
  }

  /**
   * Convenience helper used by SessionManagerService. Accepts the per-field
   * IV/authTag pairs encoded as `<u-iv>:<p-iv>` and `<u-tag>:<p-tag>` in the
   * single schema columns documented in ASSUMPTIONS.md.
   */
  decrypt(
    encryptedUsername: string,
    encryptedPassword: string,
    ivPair: string,
    authTagPair: string,
  ): { username: string; password: string } {
    const [uIv, pIv] = ivPair.split(':');
    const [uTag, pTag] = authTagPair.split(':');
    const username = this.decryptValue(encryptedUsername, uIv, uTag);
    const password = this.decryptValue(encryptedPassword, pIv, pTag);
    return { username, password };
  }

  encryptCredentials(
    username: string,
    password: string,
  ): {
    usernameEncrypted: string;
    passwordEncrypted: string;
    iv: string;
    authTag: string;
  } {
    const u = this.encrypt(username);
    const p = this.encrypt(password);
    return {
      usernameEncrypted: u.encrypted,
      passwordEncrypted: p.encrypted,
      iv: `${u.iv}:${p.iv}`,
      authTag: `${u.authTag}:${p.authTag}`,
    };
  }
}
