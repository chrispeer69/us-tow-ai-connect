import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetellAgentService } from './retell-agent.service';

/**
 * Session 74 — these cover the tenant-scoping guarantee: an edit staged by one
 * company must reach that company's agent and no other, and must still refuse
 * to run while that company's live calls are unpinned.
 */
describe('RetellAgentService (per-tenant)', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  /** Minimal drizzle select().from().where().limit() chain. */
  const dbReturning = (config: Record<string, unknown> | null) =>
    ({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => (config === null ? [] : [{ outboundVoiceConfig: config }]),
          }),
        }),
      }),
    }) as never;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.RETELL_API_KEY = 'retell-key';
    process.env.RETELL_AGENT_ID = 'agent-env';
    process.env.RETELL_AGENT_VERSION = '31';
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        agent_name: 'Emily',
        version: 32,
        is_published: false,
        response_engine: { llm_id: 'llm-1' },
        general_prompt: 'hello',
        post_call_analysis_data: [],
      }),
    })) as never;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reads the tenant agent, not the deployment default', async () => {
    const svc = new RetellAgentService(
      dbReturning({ retell_outbound_agent_id: 'agent-tenant', retell_agent_version: '4' }),
    );

    const status = await svc.status('tenant-2');

    expect(status.agentId).toBe('agent-tenant');
    expect(status.pinnedVersion).toBe('4');
    expect(status.safeToEdit).toBe(true);
    expect(String(vi.mocked(global.fetch).mock.calls[0][0])).toContain('/get-agent/agent-tenant');
  });

  it('falls back to the env agent for a tenant that overrides nothing', async () => {
    const svc = new RetellAgentService(dbReturning({}));

    const status = await svc.status('tenant-1');

    expect(status.agentId).toBe('agent-env');
    expect(status.pinnedVersion).toBe('31');
    expect(status.configSource).toMatchObject({ agentId: 'env', agentVersion: 'env' });
  });

  // The env version belongs to the env agent, so a tenant on its own agent is
  // unpinned until it pins its own — and an unpinned draft write IS a publish.
  it('refuses a draft write for a tenant on its own agent with no version pinned', async () => {
    const svc = new RetellAgentService(
      dbReturning({ retell_outbound_agent_id: 'agent-tenant' }),
    );

    const status = await svc.status('tenant-2');
    expect(status.safeToEdit).toBe(false);

    await expect(
      svc.updateDraftPrompt('tenant-2', 'a new prompt', 'chris'),
    ).rejects.toMatchObject({ response: { code: 'RETELL_UNPINNED' } });
  });

  it('writes the draft against the tenant agent when it is pinned', async () => {
    const svc = new RetellAgentService(
      dbReturning({ retell_outbound_agent_id: 'agent-tenant', retell_agent_version: '4' }),
    );

    const result = await svc.updateDraftPostCallFields('tenant-2', [{ name: 'x' }], 'chris');

    expect(result.published).toBe(false);
    const patched = vi
      .mocked(global.fetch)
      .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    expect(String(patched?.[0])).toContain('/update-agent/agent-tenant');
  });

  it('reports unconfigured when neither the tenant nor the env names an agent', async () => {
    delete process.env.RETELL_AGENT_ID;
    const svc = new RetellAgentService(dbReturning({}));

    const status = await svc.status('tenant-3');

    expect(status).toMatchObject({ configured: false, safeToEdit: false, agentId: null });
    expect(global.fetch).not.toHaveBeenCalled();
    await expect(svc.versions('tenant-3')).rejects.toMatchObject({
      response: { code: 'RETELL_UNCONFIGURED' },
    });
  });
});
