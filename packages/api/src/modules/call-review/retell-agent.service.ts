import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { tenants } from '../../db/schema';
import {
  resolveRetellTenantConfig,
  type RetellTenantConfig,
} from '../../common/utils/retell-tenant-config';

/**
 * Session 73 — write access to the Retell agent's DRAFT only.
 *
 * The approval gate this module implements exists because Retell splits the
 * lifecycle at exactly the right place:
 *
 *   PATCH /update-agent/{id}   → writes the latest DRAFT   (this service)
 *   POST  /publish-agent/{id}  → makes a draft live        (humans, in the UI)
 *
 * There is deliberately NO publish method here. An agent can stage a change and
 * a human decides whether it ever reaches a customer.
 *
 * ⚠️ That guarantee only holds when live calls are pinned to a published
 * version. Unpinned, Retell serves the latest draft to live calls, so writing
 * the draft IS publishing. Every mutating method here refuses to run while
 * unpinned.
 *
 * Session 74 — every method is tenant-scoped. The agent and the pinned version
 * are resolved from the caller's tenant (falling back to the deployment env),
 * so staging a script edit for one company cannot touch another company's
 * agent. Reading the tenant on each call rather than caching at construction is
 * deliberate: an operator repointing a tenant's agent takes effect immediately,
 * with no redeploy.
 */
@Injectable()
export class RetellAgentService {
  private readonly logger = new Logger(RetellAgentService.name);
  private readonly apiKey: string | null;
  private readonly baseUrl: string;

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {
    this.apiKey = process.env.RETELL_API_KEY?.trim() || null;
    this.baseUrl = (
      process.env.RETELL_API_BASE_URL?.trim() || 'https://api.retellai.com'
    ).replace(/\/$/, '');
  }

  /** True when the Retell account credential exists. Agent id is per tenant. */
  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /** The tenant's agent + pinned version, env-defaulted. */
  private async resolve(tenantId: string): Promise<RetellTenantConfig> {
    const row = (
      await this.db
        .select({ outboundVoiceConfig: tenants.outboundVoiceConfig })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
    )[0];
    return resolveRetellTenantConfig(
      row?.outboundVoiceConfig as Record<string, unknown> | null,
    );
  }

  private assertConfigured(cfg: RetellTenantConfig): asserts cfg is RetellTenantConfig & {
    agentId: string;
  } {
    if (!this.apiKey || !cfg.agentId) {
      throw new BadRequestException({
        status: 'error',
        code: 'RETELL_UNCONFIGURED',
        message:
          'Retell is not configured for this tenant — set RETELL_API_KEY and either ' +
          'RETELL_AGENT_ID (deployment default) or retell_outbound_agent_id on the tenant.',
      });
    }
  }

  private assertSafeToWrite(cfg: RetellTenantConfig): void {
    this.assertConfigured(cfg);
    if (!cfg.agentVersion) {
      throw new BadRequestException({
        status: 'error',
        code: 'RETELL_UNPINNED',
        message:
          'Refusing to write the Retell draft while this tenant\'s live calls are unpinned. ' +
          'Retell serves the latest draft to calls when override_agent_version is absent, ' +
          'so this edit would reach customers immediately with no review. ' +
          `Publish a version of agent ${cfg.agentId} in Retell, set it as this tenant's ` +
          'retell_agent_version (or RETELL_AGENT_VERSION when the tenant uses the default agent), then retry.',
      });
    }
  }

  private async call<T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadRequestException({
        status: 'error',
        code: 'RETELL_ERROR',
        message: `Retell ${init?.method ?? 'GET'} ${path} returned ${res.status}: ${text.slice(0, 300)}`,
      });
    }
    return (await res.json()) as T;
  }

  /**
   * Current agent state plus whether production is actually protected. Read
   * this before proposing any edit — `safeToEdit: false` means a draft write
   * would go straight to live calls.
   */
  async status(tenantId: string) {
    const cfg = await this.resolve(tenantId);
    if (!this.apiKey || !cfg.agentId) {
      return {
        configured: false,
        safeToEdit: false,
        agentId: cfg.agentId,
        pinnedVersion: cfg.agentVersion,
        configSource: cfg.source,
      };
    }
    const agent = await this.call<Record<string, any>>(`/get-agent/${cfg.agentId}`);
    const pinned = cfg.agentVersion;
    return {
      configured: true,
      agentId: cfg.agentId,
      agentName: agent.agent_name,
      draftVersion: agent.version,
      draftIsPublished: agent.is_published,
      pinnedVersion: pinned,
      safeToEdit: Boolean(pinned),
      liveCallsRun: pinned ? `version ${pinned}` : 'the latest DRAFT (unprotected)',
      // Which of these came from the tenant vs the deployment default. An
      // operator debugging "why did my change not land" needs this first.
      configSource: cfg.source,
      llmId: agent.response_engine?.llm_id ?? null,
      postCallFields: (agent.post_call_analysis_data ?? []).map((f: any) => ({
        name: f.name,
        type: f.type,
        choices: f.choices ?? null,
        description: f.description ?? null,
      })),
    };
  }

  /** The prompt lives on the LLM object, not the agent. */
  async getDraftPrompt(
    tenantId: string,
  ): Promise<{ llmId: string; generalPrompt: string; model: string }> {
    const cfg = await this.resolve(tenantId);
    this.assertConfigured(cfg);
    return this.getDraftPromptFor(cfg.agentId);
  }

  private async getDraftPromptFor(
    agentId: string,
  ): Promise<{ llmId: string; generalPrompt: string; model: string }> {
    const agent = await this.call<Record<string, any>>(`/get-agent/${agentId}`);
    const llmId = agent.response_engine?.llm_id;
    if (!llmId) {
      throw new BadRequestException({
        status: 'error',
        code: 'NOT_RETELL_LLM',
        message: 'This agent does not use a retell-llm response engine',
      });
    }
    const llm = await this.call<Record<string, any>>(`/get-retell-llm/${llmId}`);
    return {
      llmId,
      generalPrompt: llm.general_prompt ?? '',
      model: llm.model ?? 'unknown',
    };
  }

  /**
   * Replace the draft's general prompt. Staged only — a human still publishes.
   * Returns a before/after so the reviewer can diff without leaving the API.
   */
  async updateDraftPrompt(tenantId: string, newPrompt: string, actor: string | null) {
    const cfg = await this.resolve(tenantId);
    this.assertSafeToWrite(cfg);
    const { llmId, generalPrompt } = await this.getDraftPromptFor(cfg.agentId!);

    await this.call(`/update-retell-llm/${llmId}`, {
      method: 'PATCH',
      body: { general_prompt: newPrompt },
    });

    this.logger.log(
      `[retell] draft prompt updated by=${actor ?? 'unknown'} tenant=${tenantId} ` +
        `agent=${cfg.agentId} llm=${llmId} ` +
        `${generalPrompt.length}→${newPrompt.length} chars (NOT published)`,
    );

    return {
      status: 'staged' as const,
      agentId: cfg.agentId,
      llmId,
      before: generalPrompt,
      after: newPrompt,
      published: false,
      note:
        'Staged on the draft only. Review it in Retell and publish there to make it live.',
    };
  }

  /**
   * Patch post-call analysis fields on the draft — the extraction schema that
   * produces flip_outcome / offer_N_result. Wrong descriptions here corrupt
   * every downstream metric, so it is worth being able to fix them explicitly.
   */
  async updateDraftPostCallFields(
    tenantId: string,
    fields: Array<Record<string, unknown>>,
    actor: string | null,
  ) {
    const cfg = await this.resolve(tenantId);
    this.assertSafeToWrite(cfg);
    const agent = await this.call<Record<string, any>>(`/get-agent/${cfg.agentId}`);
    const before = agent.post_call_analysis_data ?? [];

    await this.call(`/update-agent/${cfg.agentId}`, {
      method: 'PATCH',
      body: { post_call_analysis_data: fields },
    });

    this.logger.log(
      `[retell] draft post-call fields updated by=${actor ?? 'unknown'} tenant=${tenantId} ` +
        `agent=${cfg.agentId} ${before.length}→${fields.length} fields (NOT published)`,
    );

    return {
      status: 'staged' as const,
      agentId: cfg.agentId,
      before,
      after: fields,
      published: false,
    };
  }

  /** Version history, so a reviewer can see what is published and what is not. */
  async versions(tenantId: string) {
    const cfg = await this.resolve(tenantId);
    this.assertConfigured(cfg);
    const list = await this.call<Array<Record<string, any>>>(
      `/get-agent-versions/${cfg.agentId}`,
    );
    return list.map((v) => ({
      version: v.version,
      isPublished: v.is_published,
      title: v.version_title ?? null,
      modifiedAt: v.last_modification_timestamp ?? null,
    }));
  }
}
