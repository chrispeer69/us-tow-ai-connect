/**
 * Best-effort redaction of sensitive payload keys before they land in
 * audit_log. We don't want a "tenant.update" row to put a freshly
 * encrypted Towbook password on disk in plaintext.
 *
 * Strategy: walk the object, replace any value whose key matches the
 * sensitive list with `'[REDACTED]'`. Doesn't recurse into Buffers or
 * Maps (we don't store those). Strings/numbers/arrays/plain objects only.
 */

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordEncrypted',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'api_key',
  'tenantApiKey',
  'plaintext',
  'plaintextKey',
  'secret',
  'authToken',
  'twilioAuthToken',
  'sendgridApiKey',
  'encryptionKey',
  'authorization',
  'cookie',
  'set-cookie',
]);

const MAX_DEPTH = 8;

export function sanitizeForAudit<T>(value: T, depth = 0): T {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return ('[TRUNCATED]' as unknown) as T;
  if (Array.isArray(value)) {
    return (value.map((v) => sanitizeForAudit(v, depth + 1)) as unknown) as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        out[key] = '[REDACTED]';
        continue;
      }
      out[key] = sanitizeForAudit(val, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(lower)) return true;
  // Substring match for common patterns ("ssn", "creditCard", "x-api-key").
  if (lower.includes('password')) return true;
  if (lower.includes('secret')) return true;
  if (lower.endsWith('token') && lower !== 'csrftoken') return true;
  if (lower.includes('apikey') || lower.includes('api_key')) return true;
  if (lower.includes('ssn')) return true;
  return false;
}
