import { BadRequestException, Injectable, Logger } from '@nestjs/common';

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
 * version via RETELL_AGENT_VERSION. Unpinned, Retell serves the latest draft to
 * live calls, so writing the draft IS publishing. Every mutating method here
 * refuses to run while unpinned.
 */
@Injectable()
export class RetellAgentService {
  private readonly logger = new Logger(RetellAgentService.name);
  private readonly apiKey: string | null;
  private readonly agentId: string | null;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = process.env.RETELL_API_KEY?.trim() || null;
    this.agentId = process.env.RETELL_AGENT_ID?.trim() || null;
    this.baseUrl = (
      process.env.RETELL_API_BASE_URL?.trim() || 'https://api.retellai.com'
    ).replace(/\/$/, '');
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.agentId);
  }

  /** Live traffic is pinned only when this env var is set. */
  private pinnedVersion(): string | null {
    return process.env.RETELL_AGENT_VERSION?.trim() || null;
  }

  private assertSafeToWrite(): void {
    if (!this.isConfigured()) {
      throw new BadRequestException({
        status: 'error',
        code: 'RETELL_UNCONFIGURED',
        message: 'RETELL_API_KEY / RETELL_AGENT_ID are not configured',
      });
    }
    if (!this.pinnedVersion()) {
      throw new BadRequestException({
        status: 'error',
        code: 'RETELL_UNPINNED',
        message:
          'Refusing to write the Retell draft while live calls are unpinned. ' +
          'Retell serves the latest draft to calls when override_agent_version is absent, ' +
          'so this edit would reach customers immediately with no review. ' +
          'Publish a version in Retell, set RETELL_AGENT_VERSION to it, then retry.',
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
  async status() {
    if (!this.isConfigured()) {
      return { configured: false, safeToEdit: false, pinnedVersion: null };
    }
    const agent = await this.call<Record<string, any>>(`/get-agent/${this.agentId}`);
    const pinned = this.pinnedVersion();
    return {
      configured: true,
      agentId: this.agentId,
      agentName: agent.agent_name,
      draftVersion: agent.version,
      draftIsPublished: agent.is_published,
      pinnedVersion: pinned,
      safeToEdit: Boolean(pinned),
      liveCallsRun: pinned ? `version ${pinned}` : 'the latest DRAFT (unprotected)',
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
  async getDraftPrompt(): Promise<{ llmId: string; generalPrompt: string; model: string }> {
    const agent = await this.call<Record<string, any>>(`/get-agent/${this.agentId}`);
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
  async updateDraftPrompt(newPrompt: string, actor: string | null) {
    this.assertSafeToWrite();
    const { llmId, generalPrompt } = await this.getDraftPrompt();

    await this.call(`/update-retell-llm/${llmId}`, {
      method: 'PATCH',
      body: { general_prompt: newPrompt },
    });

    this.logger.log(
      `[retell] draft prompt updated by=${actor ?? 'unknown'} llm=${llmId} ` +
        `${generalPrompt.length}→${newPrompt.length} chars (NOT published)`,
    );

    return {
      status: 'staged' as const,
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
    fields: Array<Record<string, unknown>>,
    actor: string | null,
  ) {
    this.assertSafeToWrite();
    const agent = await this.call<Record<string, any>>(`/get-agent/${this.agentId}`);
    const before = agent.post_call_analysis_data ?? [];

    await this.call(`/update-agent/${this.agentId}`, {
      method: 'PATCH',
      body: { post_call_analysis_data: fields },
    });

    this.logger.log(
      `[retell] draft post-call fields updated by=${actor ?? 'unknown'} ` +
        `${before.length}→${fields.length} fields (NOT published)`,
    );

    return { status: 'staged' as const, before, after: fields, published: false };
  }

  /** Version history, so a reviewer can see what is published and what is not. */
  async versions() {
    const list = await this.call<Array<Record<string, any>>>(
      `/get-agent-versions/${this.agentId}`,
    );
    return list.map((v) => ({
      version: v.version,
      isPublished: v.is_published,
      title: v.version_title ?? null,
      modifiedAt: v.last_modification_timestamp ?? null,
    }));
  }
}
