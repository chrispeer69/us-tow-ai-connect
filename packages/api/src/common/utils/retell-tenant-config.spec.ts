import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeAgentVersion, pickAbVersion, resolveRetellTenantConfig } from './retell-tenant-config';

describe('resolveRetellTenantConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.RETELL_AGENT_ID = 'agent-env';
    process.env.RETELL_AGENT_VERSION = '31';
    process.env.RETELL_FROM_NUMBER = '+18445550000';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('falls back to the deployment env when the tenant configures nothing', () => {
    const cfg = resolveRetellTenantConfig({});

    expect(cfg).toMatchObject({
      agentId: 'agent-env',
      agentVersion: '31',
      fromNumber: '+18445550000',
    });
    expect(cfg.source).toEqual({
      agentId: 'env',
      agentVersion: 'env',
      fromNumber: 'env',
    });
  });

  it('lets a tenant pin its own version while still using the default agent', () => {
    const cfg = resolveRetellTenantConfig({ retell_agent_version: '29' });

    expect(cfg.agentId).toBe('agent-env');
    expect(cfg.agentVersion).toBe('29');
    expect(cfg.source.agentVersion).toBe('tenant');
  });

  // The rule the whole file exists for. Version numbers are scoped to an agent,
  // so inheriting the env version onto a different agent would pin an unrelated
  // script — or a version that does not exist.
  it('does NOT inherit the env version for a tenant running its own agent', () => {
    const cfg = resolveRetellTenantConfig({ retell_outbound_agent_id: 'agent-tenant' });

    expect(cfg.agentId).toBe('agent-tenant');
    expect(cfg.agentVersion).toBeNull();
    expect(cfg.source.agentVersion).toBe('unset');
  });

  it('pairs a tenant agent with the tenant version', () => {
    const cfg = resolveRetellTenantConfig({
      retell_outbound_agent_id: 'agent-tenant',
      retell_agent_version: '4',
      retell_from_number: '+16145551212',
    });

    expect(cfg).toMatchObject({
      agentId: 'agent-tenant',
      agentVersion: '4',
      fromNumber: '+16145551212',
    });
    expect(cfg.source).toEqual({
      agentId: 'tenant',
      agentVersion: 'tenant',
      fromNumber: 'tenant',
    });
  });

  it('accepts a numeric version from jsonb and treats blanks as unset', () => {
    const cfg = resolveRetellTenantConfig({
      retell_outbound_agent_id: 'agent-tenant',
      retell_agent_version: 12 as unknown as string,
      retell_from_number: '   ',
    });

    expect(cfg.agentVersion).toBe('12');
    expect(cfg.fromNumber).toBe('+18445550000');
    expect(cfg.source.fromNumber).toBe('env');
  });

  it('reports unset rather than throwing when nothing is configured anywhere', () => {
    delete process.env.RETELL_AGENT_ID;
    delete process.env.RETELL_AGENT_VERSION;
    delete process.env.RETELL_FROM_NUMBER;

    const cfg = resolveRetellTenantConfig(null);

    expect(cfg).toMatchObject({ agentId: null, agentVersion: null, fromNumber: null });
    expect(cfg.source.agentId).toBe('unset');
  });
});

describe('encodeAgentVersion', () => {
  it('sends numeric versions as numbers and tags as strings', () => {
    expect(encodeAgentVersion('31')).toBe(31);
    expect(encodeAgentVersion('latest_published')).toBe('latest_published');
  });
});

describe('pickAbVersion', () => {
  const ids = Array.from({ length: 2000 }, (_, i) => `call-${i}-${(i * 7919) % 1000}`);

  it('is off unless a B version and a 1-99 share are both set', () => {
    expect(pickAbVersion({}, '57', 'x')).toEqual({ version: '57', arm: 'A' });
    expect(pickAbVersion({ retell_agent_version_b: 60 }, '57', 'x')).toEqual({ version: '57', arm: 'A' });
    expect(pickAbVersion({ retell_agent_version_b: 60, retell_ab_percent_b: 0 }, '57', 'x').arm).toBe('A');
    expect(pickAbVersion({ retell_agent_version_b: 60, retell_ab_percent_b: 100 }, '57', 'x').arm).toBe('A');
    expect(pickAbVersion({ retell_agent_version_b: 60, retell_ab_percent_b: 'abc' }, '57', 'x').arm).toBe('A');
  });

  it('never sends a B version when there is no A version to pair it with', () => {
    expect(pickAbVersion({ retell_agent_version_b: 60, retell_ab_percent_b: 50 }, null, 'x')).toEqual({ version: null, arm: 'A' });
  });

  it('is deterministic per call id, so a retry lands on the same arm', () => {
    const cfg = { retell_agent_version_b: '60', retell_ab_percent_b: 30 };
    for (const id of ids.slice(0, 50)) expect(pickAbVersion(cfg, '57', id)).toEqual(pickAbVersion(cfg, '57', id));
  });

  it('sends roughly the configured share to B', () => {
    const cfg = { retell_agent_version_b: 60, retell_ab_percent_b: 30 };
    const b = ids.filter((id) => pickAbVersion(cfg, '57', id).arm === 'B');
    expect(b.length / ids.length).toBeGreaterThan(0.25);
    expect(b.length / ids.length).toBeLessThan(0.35);
    expect(pickAbVersion(cfg, '57', b[0]).version).toBe('60');
  });
});
