import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetellOutboundClient } from './retell-outbound.client';

describe('RetellOutboundClient', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.RETELL_API_KEY = 'retell-key';
    process.env.RETELL_AGENT_ID = 'agent-1';
    process.env.RETELL_FROM_NUMBER = '+15550000000';
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ call_id: 'retell-call-1' }),
    })) as never;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends user_name as a compatibility alias for Retell prompts', async () => {
    const client = new RetellOutboundClient();

    await client.placeCall({
      tenantId: 'tenant-1',
      callId: 'call-1',
      toPhone: '6145551234',
      toName: 'Chris',
      scriptTemplate: 'custom',
      scriptBody: 'Hi Chris',
      scriptVariables: {
        body: 'Hi Chris',
      },
    });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body.retell_llm_dynamic_variables.customer_name).toBe('Chris');
    expect(body.retell_llm_dynamic_variables.user_name).toBe('Chris');
  });

  it('routes to the tenant test override number when tenant test mode is enabled', async () => {
    const client = new RetellOutboundClient();

    await client.placeCall({
      tenantId: 'tenant-1',
      callId: 'call-1',
      toPhone: '+16145551234',
      toName: 'Chris',
      scriptTemplate: 'custom',
      scriptBody: 'Hi Chris',
      scriptVariables: { body: 'Hi Chris' },
      testModeEnabled: true,
      testOverrideNumber: '(614) 555-9999',
    });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body.to_number).toBe('+16145559999');
  });

  it('refuses tenant test mode calls when no tenant test number is set', async () => {
    const client = new RetellOutboundClient();

    const result = await client.placeCall({
      tenantId: 'tenant-1',
      callId: 'call-1',
      toPhone: '+16145551234',
      toName: 'Chris',
      scriptTemplate: 'custom',
      scriptBody: 'Hi Chris',
      scriptVariables: { body: 'Hi Chris' },
      testModeEnabled: true,
      testOverrideNumber: '',
    });

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
