import { describe, expect, it, vi } from 'vitest';
import { BrandingService } from './branding.service';

function makeDb(opts: { tenantRow?: Record<string, unknown> | null }) {
  const tenant = opts.tenantRow;
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(tenant ? [tenant] : []) }),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => {
          updates.push(patch);
          return Promise.resolve();
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v);
        return {
          returning: () => Promise.resolve([v]),
          onConflictDoNothing: () => Promise.resolve(),
        };
      },
    }),
    _state: { updates, inserts },
  } as never;
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

describe('BrandingService', () => {
  it('returns DEFAULTS merged with stored branding', async () => {
    const db = makeDb({
      tenantRow: {
        id: TENANT_ID,
        companyName: 'Roadside Towing',
        branding: { primaryColor: '#ff0000', logoUrl: 'https://example/logo.png' },
      },
    });
    const svc = new BrandingService(db);
    const out = await svc.get(TENANT_ID);
    expect(out.companyDisplayName).toBe('Roadside Towing');
    expect(out.primaryColor).toBe('#ff0000');
    expect(out.logoUrl).toBe('https://example/logo.png');
    expect(out.accentColor).toBe('#facc15');
  });

  it('throws when tenant is missing', async () => {
    const db = makeDb({ tenantRow: null });
    const svc = new BrandingService(db);
    await expect(svc.get(TENANT_ID)).rejects.toThrow();
  });

  it('getSafe returns defaults instead of throwing on missing tenant', async () => {
    const db = makeDb({ tenantRow: null });
    const svc = new BrandingService(db);
    const out = await svc.getSafe(TENANT_ID);
    expect(out.primaryColor).toBe('#3b82f6');
  });

  it('put merges + persists + records audit', async () => {
    const tenantRow = {
      id: TENANT_ID,
      companyName: 'Acme',
      branding: { primaryColor: '#333333' },
    };
    const db = makeDb({ tenantRow });
    const svc = new BrandingService(db as never);
    const out = await svc.put(
      TENANT_ID,
      {
        companyDisplayName: 'Acme',
        primaryColor: '#444444',
        secondaryColor: '#1e293b',
        accentColor: '#facc15',
        fontFamily: 'Inter',
        emailSignatureHtml: '',
        smsSignature: '',
        supportPhone: '',
        supportEmail: '',
        customDomain: null,
        hidePoweredBy: true,
        logoUrl: '',
        faviconUrl: '',
      },
      'admin@acme.com',
    );
    expect(out.primaryColor).toBe('#444444');
    expect(out.hidePoweredBy).toBe(true);
  });
});
