import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutboundVoiceService } from './outbound-voice.service';
import { ThinkrrOutboundClient } from './thinkrr-outbound.client';
import { RetellOutboundClient } from './retell-outbound.client';

/**
 * 2026-10-10 slim/Gemini A/B — a call queued on the slim_gemini arm is placed
 * on the slim agent; every other call keeps the tenant's agent and version.
 */
const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ENV = ['AB_SLIM_GEMINI_AGENT_ID', 'AB_SLIM_GEMINI_AGENT_VERSION', 'RETELL_AGENT_VERSION', 'RETELL_AGENT_ID'];

function makeSvc() {
  const chain: any = { set: () => chain, where: () => chain, returning: async () => [{ id: 'c1' }] };
  const db = { update: vi.fn(() => chain) };
  const provider = { providerName: 'retell', placeCall: vi.fn(async () => null), cancelCall: vi.fn(async () => false) } as any;
  const svc = new OutboundVoiceService(
    db as never,
    new ThinkrrOutboundClient(),
    new RetellOutboundClient(),
    provider,
    { sendSms: vi.fn() } as never,
    { sendFlipWin: vi.fn(), sendToTenantAdmins: vi.fn() } as never,
  );
  (svc as any).notifyManagersOfAttentionNeeded = vi.fn(async () => undefined);
  return { svc, provider };
}

const tenant = { id: TENANT_ID, outboundVoiceConfig: { retell_agent_version: 61 } } as any;
const call = (vars: Record<string, unknown>) =>
  ({
    id: 'call-1',
    tenantId: TENANT_ID,
    toPhone: '+16145550100',
    toName: 'Kelli',
    scriptTemplate: 'custom',
    scriptVariables: { body: 'script', ...vars },
    attempts: 0,
    maxAttempts: 1,
  }) as any;

describe('outbound A/B — agent routing at dial time', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV) saved[k] = process.env[k];
    process.env.RETELL_AGENT_ID = 'agent_live_emily';
    process.env.RETELL_AGENT_VERSION = '61';
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('places a slim_gemini call on the slim agent and version', async () => {
    process.env.AB_SLIM_GEMINI_AGENT_ID = 'agent_slim_gemini';
    process.env.AB_SLIM_GEMINI_AGENT_VERSION = '1';
    const { svc, provider } = makeSvc();
    await (svc as any).dispatchOne(call({ abArm: 'slim_gemini' }), tenant);
    expect(provider.placeCall).toHaveBeenCalledTimes(1);
    const p = provider.placeCall.mock.calls[0][0];
    expect(p.agentId).toBe('agent_slim_gemini');
    expect(p.agentVersion).toBe('1');
  });

  it('leaves legacy-arm and pre-A/B calls on the tenant agent', async () => {
    process.env.AB_SLIM_GEMINI_AGENT_ID = 'agent_slim_gemini';
    for (const vars of [{ abArm: 'legacy' }, {}]) {
      const { svc, provider } = makeSvc();
      await (svc as any).dispatchOne(call(vars), tenant);
      const p = provider.placeCall.mock.calls[0][0];
      expect(p.agentId).not.toBe('agent_slim_gemini');
    }
  });

  it('still places a slim_gemini call when the slim agent is unconfigured', async () => {
    delete process.env.AB_SLIM_GEMINI_AGENT_ID;
    const { svc, provider } = makeSvc();
    await (svc as any).dispatchOne(call({ abArm: 'slim_gemini' }), tenant);
    expect(provider.placeCall).toHaveBeenCalledTimes(1);
    expect(provider.placeCall.mock.calls[0][0].agentId).not.toBe('agent_slim_gemini');
  });
});
