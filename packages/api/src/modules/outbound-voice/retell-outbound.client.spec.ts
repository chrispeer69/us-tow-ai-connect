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

  // Version pinning. Retell resolves a call with no override_agent_version to
  // the agent's LATEST version — the working draft — so an unpinned deployment
  // ships every dashboard edit straight to customers.
  it('omits override_agent_version when RETELL_AGENT_VERSION is unset', async () => {
    delete process.env.RETELL_AGENT_VERSION;
    const client = new RetellOutboundClient();

    await client.placeCall({
      tenantId: 'tenant-1',
      callId: 'call-1',
      toPhone: '+16145551234',
      toName: 'Chris',
      scriptTemplate: 'custom',
      scriptBody: 'Hi Chris',
      scriptVariables: { body: 'Hi Chris' },
    });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body).not.toHaveProperty('override_agent_version');
    expect(client.pinnedVersion()).toBeNull();
  });

  it('pins a numeric RETELL_AGENT_VERSION as a number', async () => {
    process.env.RETELL_AGENT_VERSION = '27';
    const client = new RetellOutboundClient();

    await client.placeCall({
      tenantId: 'tenant-1',
      callId: 'call-1',
      toPhone: '+16145551234',
      toName: 'Chris',
      scriptTemplate: 'custom',
      scriptBody: 'Hi Chris',
      scriptVariables: { body: 'Hi Chris' },
    });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body.override_agent_version).toBe(27);
  });

  it('passes a non-numeric RETELL_AGENT_VERSION through as a tag string', async () => {
    process.env.RETELL_AGENT_VERSION = 'latest_published';
    const client = new RetellOutboundClient();

    await client.placeCall({
      tenantId: 'tenant-1',
      callId: 'call-1',
      toPhone: '+16145551234',
      toName: 'Chris',
      scriptTemplate: 'custom',
      scriptBody: 'Hi Chris',
      scriptVariables: { body: 'Hi Chris' },
    });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body.override_agent_version).toBe('latest_published');
  });

  // Per-tenant Retell config (Session 74). The service resolves agent/version/
  // caller-ID from the tenant and passes them per call; env stays the fallback.
  it('uses the per-call agent, version and caller-ID over the env defaults', async () => {
    process.env.RETELL_AGENT_VERSION = '31';
    const client = new RetellOutboundClient();

    await client.placeCall({
      tenantId: 'tenant-2',
      callId: 'call-2',
      toPhone: '+16145551234',
      toName: 'Chris',
      scriptTemplate: 'custom',
      scriptBody: 'Hi Chris',
      scriptVariables: { body: 'Hi Chris' },
      agentId: 'agent-tenant-2',
      agentVersion: '4',
      fromNumber: '+16145550000',
    });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body.override_agent_id).toBe('agent-tenant-2');
    expect(body.override_agent_version).toBe(4);
    expect(body.from_number).toBe('+16145550000');
  });

  // A version number is scoped to its agent, so the env version must never be
  // applied to a tenant that brought its own agent — it would pin an unrelated
  // script, or a version that does not exist on that agent.
  it('never pairs the env version with a per-call agent id', async () => {
    process.env.RETELL_AGENT_VERSION = '31';
    const client = new RetellOutboundClient();

    await client.placeCall({
      tenantId: 'tenant-2',
      callId: 'call-2',
      toPhone: '+16145551234',
      toName: 'Chris',
      scriptTemplate: 'custom',
      scriptBody: 'Hi Chris',
      scriptVariables: { body: 'Hi Chris' },
      agentId: 'agent-tenant-2',
    });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body.override_agent_id).toBe('agent-tenant-2');
    expect(body).not.toHaveProperty('override_agent_version');
  });

  it('still applies the env version when the tenant uses the default agent', async () => {
    process.env.RETELL_AGENT_VERSION = '31';
    const client = new RetellOutboundClient();

    await client.placeCall({
      tenantId: 'tenant-1',
      callId: 'call-1',
      toPhone: '+16145551234',
      toName: 'Chris',
      scriptTemplate: 'custom',
      scriptBody: 'Hi Chris',
      scriptVariables: { body: 'Hi Chris' },
      agentId: undefined,
    });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body.override_agent_id).toBe('agent-1');
    expect(body.override_agent_version).toBe(31);
  });

  it('places a call for a fully self-configured tenant even with no env agent', async () => {
    delete process.env.RETELL_AGENT_ID;
    delete process.env.RETELL_FROM_NUMBER;
    const client = new RetellOutboundClient();

    expect(client.isConfigured()).toBe(false);

    const result = await client.placeCall({
      tenantId: 'tenant-2',
      callId: 'call-2',
      toPhone: '+16145551234',
      toName: 'Chris',
      scriptTemplate: 'custom',
      scriptBody: 'Hi Chris',
      scriptVariables: { body: 'Hi Chris' },
      agentId: 'agent-tenant-2',
      agentVersion: '4',
      fromNumber: '+16145550000',
    });

    expect(result).toEqual({ providerCallId: 'retell-call-1' });
  });

  it('skips the call when neither the tenant nor the env supplies a caller-ID', async () => {
    delete process.env.RETELL_FROM_NUMBER;
    const client = new RetellOutboundClient();

    const result = await client.placeCall({
      tenantId: 'tenant-2',
      callId: 'call-2',
      toPhone: '+16145551234',
      toName: 'Chris',
      scriptTemplate: 'custom',
      scriptBody: 'Hi Chris',
      scriptVariables: { body: 'Hi Chris' },
      agentId: 'agent-tenant-2',
      agentVersion: '4',
    });

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
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
