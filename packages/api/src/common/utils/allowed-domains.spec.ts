import { describe, expect, it } from 'vitest';
import {
  buildConnectSrcDirective,
  buildOriginMatcher,
  parentCookieDomain,
  resolveAllowedOrigins,
} from './allowed-domains';

describe('resolveAllowedOrigins', () => {
  it('falls back to dev + railway defaults when nothing is configured', () => {
    const origins = resolveAllowedOrigins({});
    expect(origins).toContain('http://localhost:3000');
    expect(origins).toContain('http://localhost:3001');
    expect(origins).toContain('https://*.up.railway.app');
  });

  it('uses ALLOWED_DOMAINS when set, dropping the dev defaults', () => {
    const origins = resolveAllowedOrigins({
      ALLOWED_DOMAINS: 'https://app.ustow-aiconnect.com, https://api.ustow-aiconnect.com',
    });
    expect(origins).toEqual([
      'https://app.ustow-aiconnect.com',
      'https://api.ustow-aiconnect.com',
    ]);
  });

  it('merges legacy WEB_PUBLIC_URL + CORS_EXTRA_ORIGINS for back-compat', () => {
    const origins = resolveAllowedOrigins({
      ALLOWED_DOMAINS: 'https://app.ustow-aiconnect.com',
      WEB_PUBLIC_URL: 'https://legacy.example.com',
      CORS_EXTRA_ORIGINS: 'https://staging.example.com',
    });
    expect(origins).toContain('https://app.ustow-aiconnect.com');
    expect(origins).toContain('https://legacy.example.com');
    expect(origins).toContain('https://staging.example.com');
    expect(new Set(origins).size).toBe(origins.length); // no dupes
  });
});

describe('buildOriginMatcher', () => {
  const match = buildOriginMatcher([
    'https://app.ustow-aiconnect.com',
    'https://*.up.railway.app',
  ]);

  it('matches exact origins', () => {
    expect(match('https://app.ustow-aiconnect.com')).toBe(true);
  });

  it('matches a single-label wildcard subdomain', () => {
    expect(match('https://web-production-1a2b.up.railway.app')).toBe(true);
  });

  it('rejects the bare wildcard apex and multi-label hosts', () => {
    expect(match('https://up.railway.app')).toBe(false);
    expect(match('https://a.b.up.railway.app')).toBe(false);
  });

  it('is scheme-sensitive', () => {
    expect(match('http://web-production.up.railway.app')).toBe(false);
    expect(match('https://evil.com')).toBe(false);
  });
});

describe('buildConnectSrcDirective', () => {
  it('prepends self and joins the allow-list', () => {
    expect(buildConnectSrcDirective(['https://api.ustow-aiconnect.com'])).toBe(
      "connect-src 'self' https://api.ustow-aiconnect.com",
    );
  });

  it("falls back to 'self' on an empty list", () => {
    expect(buildConnectSrcDirective([])).toBe("connect-src 'self' 'self'");
  });
});

describe('parentCookieDomain', () => {
  it('returns the dotted apex for a subdomain origin', () => {
    expect(parentCookieDomain('https://app.ustow-aiconnect.com')).toBe('.ustow-aiconnect.com');
  });

  it('returns null for localhost, IPs, and bare apexes', () => {
    expect(parentCookieDomain('http://localhost:3000')).toBeNull();
    expect(parentCookieDomain('http://127.0.0.1:3001')).toBeNull();
    expect(parentCookieDomain('https://ustow-aiconnect.com')).toBeNull();
  });

  it('returns null on malformed input', () => {
    expect(parentCookieDomain('not a url')).toBeNull();
  });
});
