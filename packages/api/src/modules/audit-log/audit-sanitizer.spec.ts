import { describe, expect, it } from 'vitest';
import { sanitizeForAudit } from './audit-sanitizer';

describe('sanitizeForAudit', () => {
  it('redacts top-level password / token / api_key / secret keys', () => {
    expect(sanitizeForAudit({ password: 'hunter2' })).toEqual({ password: '[REDACTED]' });
    expect(sanitizeForAudit({ token: 'jwt.abc.def' })).toEqual({ token: '[REDACTED]' });
    expect(sanitizeForAudit({ api_key: 'usk_aaaaaaaaaaaa' })).toEqual({
      api_key: '[REDACTED]',
    });
    expect(sanitizeForAudit({ secret: 's' })).toEqual({ secret: '[REDACTED]' });
  });

  it('matches case-insensitive variants and substrings', () => {
    expect(sanitizeForAudit({ AccessToken: 'x' })).toEqual({ AccessToken: '[REDACTED]' });
    expect(sanitizeForAudit({ userPassword: 'pw' })).toEqual({ userPassword: '[REDACTED]' });
    expect(sanitizeForAudit({ ssn: '123' })).toEqual({ ssn: '[REDACTED]' });
  });

  it('leaves non-sensitive keys alone', () => {
    expect(sanitizeForAudit({ name: 'Alice', age: 42 })).toEqual({ name: 'Alice', age: 42 });
  });

  it('recurses into nested objects and arrays', () => {
    const input = {
      user: {
        name: 'Bob',
        credentials: {
          password: 'pw',
          apiKey: 'usk_x',
        },
      },
      events: [
        { kind: 'login', token: 'secret-jwt' },
        { kind: 'logout' },
      ],
    };
    expect(sanitizeForAudit(input)).toEqual({
      user: {
        name: 'Bob',
        credentials: {
          password: '[REDACTED]',
          apiKey: '[REDACTED]',
        },
      },
      events: [
        { kind: 'login', token: '[REDACTED]' },
        { kind: 'logout' },
      ],
    });
  });

  it('truncates payloads deeper than the configured cap', () => {
    let nested: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 20; i++) nested = { wrap: nested };
    const result = sanitizeForAudit(nested) as Record<string, unknown>;
    let depth = 0;
    let cursor: unknown = result;
    while (cursor && typeof cursor === 'object' && 'wrap' in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>).wrap;
      depth++;
      if (depth > 30) break;
    }
    expect(typeof cursor === 'string' && cursor === '[TRUNCATED]').toBe(true);
  });

  it('treats csrfToken specifically as non-sensitive (only "*token" suffix is sensitive)', () => {
    expect(sanitizeForAudit({ csrfToken: 'abc' })).toEqual({ csrfToken: 'abc' });
  });
});
