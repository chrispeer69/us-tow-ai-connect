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
});
