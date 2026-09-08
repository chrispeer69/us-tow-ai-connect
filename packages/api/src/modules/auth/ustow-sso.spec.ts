import { describe, it, expect } from 'vitest';
import { hasSsoApp, parseSsoClaims } from './ustow-sso.service';
import { mapSsoRole, slugify } from './auth.service';

/**
 * SSO: the pure pieces of "Sign in with US Tow" — claim normalisation, the
 * `apps` authorisation gate, the SSO-role -> tenant-role mapping, and the
 * company-name slug used to match an SSO org to a tenant.
 */

describe('parseSsoClaims', () => {
  it('normalises email, org slug and roles to lowercase and lists to arrays', () => {
    const claims = parseSsoClaims({
      sub: 'u_1',
      email: ' Owner@Example.COM ',
      email_verified: true,
      name: 'Pat Owner',
      phone_number: '+16145551212',
      org_id: 'o_1',
      org_slug: 'Roadside-Towing',
      org_name: 'Roadside Towing',
      roles: ['Owner', 'dispatcher'],
      apps: ['ustowaiconnect', 'dispatch'],
      platform_admin: false,
      sid: 's_1',
    });
    expect(claims.email).toBe('owner@example.com');
    expect(claims.orgSlug).toBe('roadside-towing');
    expect(claims.roles).toEqual(['owner', 'dispatcher']);
    expect(claims.apps).toEqual(['ustowaiconnect', 'dispatch']);
    expect(claims.phone).toBe('+16145551212');
    expect(claims.sid).toBe('s_1');
  });

  it('tolerates missing optional claims', () => {
    const claims = parseSsoClaims({ sub: 'u_2', email: 'x@y.z' });
    expect(claims.roles).toEqual([]);
    expect(claims.apps).toEqual([]);
    expect(claims.orgSlug).toBeUndefined();
    expect(claims.phone).toBeNull();
    expect(claims.platformAdmin).toBe(false);
  });
});

describe('hasSsoApp', () => {
  it('only admits people whose dashboard lists this client', () => {
    expect(hasSsoApp({ apps: ['ustowaiconnect'] }, 'ustowaiconnect')).toBe(true);
    expect(hasSsoApp({ apps: ['dispatch'] }, 'ustowaiconnect')).toBe(false);
    expect(hasSsoApp({ apps: [] }, 'ustowaiconnect')).toBe(false);
  });
});

describe('mapSsoRole', () => {
  it('maps owner/admin to OWNER and the rest to their tenant role', () => {
    expect(mapSsoRole(['admin'])).toBe('OWNER');
    expect(mapSsoRole(['owner'])).toBe('OWNER');
    expect(mapSsoRole(['dispatcher'])).toBe('DISPATCHER');
    expect(mapSsoRole(['driver'])).toBe('DRIVER');
    expect(mapSsoRole(['billing'])).toBe('ACCOUNTING');
  });

  it('picks the highest role and falls back to VIEWER', () => {
    expect(mapSsoRole(['driver', 'admin'])).toBe('OWNER');
    expect(mapSsoRole(['mechanic'])).toBe('VIEWER');
    expect(mapSsoRole([])).toBe('VIEWER');
  });
});

describe('slugify', () => {
  it('produces the org_slug shape from a company name', () => {
    expect(slugify('Roadside Towing, LLC')).toBe('roadside-towing-llc');
    expect(slugify('  US Tow Alliance ')).toBe('us-tow-alliance');
    expect(slugify('Émile & Sons')).toBe('emile-sons');
  });
});
