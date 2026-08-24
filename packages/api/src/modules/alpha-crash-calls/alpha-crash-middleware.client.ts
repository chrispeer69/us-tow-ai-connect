import { Injectable, Logger } from '@nestjs/common';

/**
 * HTTP client for the `retell-middleware` service (github.com/chrispeer69/
 * retell-middleware, Railway project "Retell-Middleware") — the Alpha
 * Automotive crash-lead outbound caller. That service owns its own Postgres;
 * this client reads it through the service's HTTPS reporting API rather than
 * holding raw DB credentials for a database Command Center doesn't own.
 *
 * Same convention as retell-outbound.client.ts / thinkrr-outbound.client.ts:
 * plain fetch, secrets off process.env at construction, isConfigured() guard,
 * never throw — log and return null so the controller can 503 cleanly.
 */
export interface AlphaCallSummary {
  id: string;
  call_id: string;
  contact_id: string | null;
  agent_id: string | null;
  direction: string | null;
  created_at: string | null;
  customer_name: string | null;
  duration_ms: number | null;
  recording_url: string | null;
  call_status: string | null;
  disconnection_reason: string | null;
  call_outcome: string | null;
  call_summary: string | null;
  callback_requested: boolean | null;
  preferred_callback_time: string | null;
  in_voicemail: boolean | null;
  user_sentiment: string | null;
}

export interface AlphaCallDetail extends AlphaCallSummary {
  transcript: string | null;
  post_call_data: Record<string, unknown>;
}

export interface AlphaCallListResult {
  total: number;
  limit: number;
  offset: number;
  calls: AlphaCallSummary[];
}

export interface AlphaCallStats {
  total: number;
  voicemail: number;
  by_outcome: Record<string, number>;
}

@Injectable()
export class AlphaCrashMiddlewareClient {
  private readonly logger = new Logger(AlphaCrashMiddlewareClient.name);
  private readonly baseUrl: string | null;
  private readonly reportingKey: string | null;

  constructor() {
    const baseUrl = process.env.ALPHA_CRASH_MIDDLEWARE_URL?.trim() ?? '';
    const reportingKey = process.env.ALPHA_CRASH_MIDDLEWARE_KEY?.trim() ?? '';
    this.baseUrl = baseUrl ? baseUrl.replace(/\/$/, '') : null;
    this.reportingKey = reportingKey || null;

    if (!this.isConfigured()) {
      this.logger.warn(
        'ALPHA_CRASH_MIDDLEWARE_URL / ALPHA_CRASH_MIDDLEWARE_KEY not fully configured — /alpha/flips will 503',
      );
    }
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.reportingKey);
  }

  private async get<T>(path: string): Promise<T | null> {
    if (!this.baseUrl || !this.reportingKey) return null;
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: { 'X-Reporting-Secret': this.reportingKey },
      });
      if (!res.ok) {
        this.logger.warn(`retell-middleware GET ${path} → ${res.status}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      this.logger.warn(`retell-middleware GET ${path} failed: ${(err as Error).message}`);
      return null;
    }
  }

  async listCalls(query: {
    since?: string;
    until?: string;
    direction?: string;
    limit?: number;
    offset?: number;
  }): Promise<AlphaCallListResult | null> {
    const params = new URLSearchParams();
    if (query.since) params.set('since', query.since);
    if (query.until) params.set('until', query.until);
    if (query.direction) params.set('direction', query.direction);
    if (query.limit != null) params.set('limit', String(query.limit));
    if (query.offset != null) params.set('offset', String(query.offset));
    const qs = params.toString();
    return this.get<AlphaCallListResult>(`/v1/calls${qs ? `?${qs}` : ''}`);
  }

  async getCall(callId: string): Promise<AlphaCallDetail | null> {
    return this.get<AlphaCallDetail>(`/v1/calls/${encodeURIComponent(callId)}`);
  }

  async getStats(query: { since?: string; until?: string }): Promise<AlphaCallStats | null> {
    const params = new URLSearchParams();
    if (query.since) params.set('since', query.since);
    if (query.until) params.set('until', query.until);
    const qs = params.toString();
    return this.get<AlphaCallStats>(`/v1/calls/stats${qs ? `?${qs}` : ''}`);
  }
}
