import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ANALYSIS_SCHEMA, type DailyAnalysis } from './call-review.types';

/**
 * Session 73 — thin Anthropic wrapper for the daily call analyst.
 *
 * Reads at construction:
 *   ANTHROPIC_API_KEY   — required for live analysis
 *   CALL_REVIEW_MODEL   — override the model (default claude-opus-5)
 *   CALL_REVIEW_EFFORT  — low | medium | high | xhigh | max (default high)
 *
 * Returns null + logs a warning when unconfigured, so a missing key degrades
 * the daily review to a no-op instead of failing the cron.
 */
@Injectable()
export class ClaudeClient {
  private readonly logger = new Logger(ClaudeClient.name);
  private readonly client: Anthropic | null;
  readonly model: string;
  private readonly effort: string;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    this.model = process.env.CALL_REVIEW_MODEL?.trim() || 'claude-opus-5';
    this.effort = process.env.CALL_REVIEW_EFFORT?.trim() || 'high';
    this.client = apiKey ? new Anthropic({ apiKey }) : null;

    if (!this.client) {
      this.logger.warn(
        'ANTHROPIC_API_KEY unset — the daily call review will record its funnel metrics but skip transcript analysis',
      );
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * One structured analysis pass over a day's sampled transcripts.
   *
   * Streams because the prompt carries dozens of transcripts and the response
   * can be long — a non-streaming request at this `max_tokens` risks an HTTP
   * timeout. `output_config.format` pins the response to ANALYSIS_SCHEMA so
   * there is nothing to parse defensively.
   */
  async analyze(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<{
    analysis: DailyAnalysis;
    inputTokens: number;
    outputTokens: number;
  } | null> {
    if (!this.client) return null;

    try {
      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: 32000,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: this.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
          format: {
            type: 'json_schema',
            schema: ANALYSIS_SCHEMA as unknown as Record<string, unknown>,
          },
        },
        system: [
          {
            type: 'text',
            text: systemPrompt,
            // The system prompt and the script text are identical every day;
            // only the transcripts change. Caching the prefix keeps the daily
            // run cheap.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userPrompt }],
      } as Parameters<Anthropic['messages']['stream']>[0]);

      const message = await stream.finalMessage();

      if (message.stop_reason === 'refusal') {
        this.logger.warn(
          `[call-review] model declined the request (${message.stop_details?.category ?? 'unknown'})`,
        );
        return null;
      }
      if (message.stop_reason === 'max_tokens') {
        this.logger.warn('[call-review] response hit max_tokens — analysis may be truncated');
      }

      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      if (!text.trim()) {
        this.logger.warn('[call-review] model returned no text content');
        return null;
      }

      return {
        analysis: JSON.parse(text) as DailyAnalysis,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      };
    } catch (err) {
      this.logger.error(
        `[call-review] analysis request failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      return null;
    }
  }
}
