import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GhlAccountSyncService } from './ghl-account-sync.service';

describe('GhlAccountSyncService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.GHL_ACCOUNT_SYNC_ENABLED = 'true';
    process.env.GHL_ACCOUNT_SYNC_LOCATION_ID = 'location:test-location';
    process.env.GHL_ACCOUNT_SYNC_PRIVATE_INTEGRATION_TOKEN = 'test-token';
    delete process.env.GHL_ACCOUNT_SYNC_TAG;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.GHL_ACCOUNT_SYNC_ENABLED;
    delete process.env.GHL_ACCOUNT_SYNC_LOCATION_ID;
    delete process.env.GHL_ACCOUNT_SYNC_PRIVATE_INTEGRATION_TOKEN;
    delete process.env.GHL_ACCOUNT_SYNC_TAG;
    vi.restoreAllMocks();
  });

  it('upserts the contact and adds the registration tag without replacing tags', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ contact: { id: 'contact-1' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tags: ['existing', 'ustow-ai-connect-registered'] }), { status: 201 }));
    global.fetch = fetchMock as typeof fetch;

    const synced = await new GhlAccountSyncService().syncAccount({
      email: ' Owner@Example.com ',
      phone: ' +16145550100 ',
      firstName: 'Chris',
      lastName: 'Peer',
      companyName: 'Example Towing',
      source: 'US Tow AI-Connect / Onboarding',
    });

    expect(synced).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://services.leadconnectorhq.com/contacts/upsert');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      locationId: 'test-location',
      email: 'owner@example.com',
      phone: '+16145550100',
      createNewIfDuplicateAllowed: false,
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      tags: ['ustow-ai-connect-registered'],
    });
  });

  it('does nothing while the integration switch is disabled', async () => {
    process.env.GHL_ACCOUNT_SYNC_ENABLED = 'false';
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;

    await expect(
      new GhlAccountSyncService().syncAccount({
        email: 'owner@example.com',
        source: 'US Tow AI-Connect / Email Signup',
      }),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports safe configuration status without exposing the token', () => {
    const status = new GhlAccountSyncService().getStatus();

    expect(status).toEqual({
      enabled: true,
      locationConfigured: true,
      tokenConfigured: true,
      locationId: 'test-location',
      tag: 'ustow-ai-connect-registered',
    });
    expect(JSON.stringify(status)).not.toContain('test-token');
  });

  it('returns the GHL response error for a manual resync diagnostic', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('token lacks contacts.write', { status: 401 })) as typeof fetch;

    await expect(
      new GhlAccountSyncService().syncAccountWithResult({
        email: 'owner@example.com',
        source: 'US Tow AI-Connect / Manual Resync',
      }),
    ).resolves.toEqual({
      success: false,
      skipped: false,
      error: 'contact upsert returned 401: token lacks contacts.write',
    });
  });

  it('does not reject account creation when GHL is unavailable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network unavailable')) as typeof fetch;

    await expect(
      new GhlAccountSyncService().syncAccount({
        email: 'owner@example.com',
        source: 'US Tow AI-Connect / Email Signup',
      }),
    ).resolves.toBe(false);
  });
});
