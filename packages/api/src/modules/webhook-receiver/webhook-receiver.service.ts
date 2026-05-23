import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { callInteractions, interactionLogs, tenants } from '../../db/schema';
import type { ActiveJob } from '../adapters/adapter.interface';

export interface ThinkrrCallPayload {
  call_id?: string;
  id?: string;
  agent_id?: string;
  phone_number?: string;
  from_number?: string;
  caller_phone?: string;
  to_number?: string;
  called_number?: string;
  agent_phone?: string;
  duration?: number;
  duration_sec?: number;
  status?: string;
  transcript?: string;
  summary?: string;
  structured_data?: Record<string, unknown>;
  recording_url?: string;
  sentiment?: string;
  agent_name?: string;
  timestamp?: string;
  started_at?: string;
  ended_at?: string;
  tenant_id?: string;
}

type CallCategory =
  | 'ETA_LOOKUP'
  | 'NEW_TOW_REQUEST'
  | 'TRANSFER_TO_HUMAN'
  | 'IMPOUND_INQUIRY'
  | 'PRICING_QUOTE'
  | 'COMPLAINT'
  | 'GENERAL_INQUIRY';

@Injectable()
export class WebhookReceiverService {
  private readonly logger = new Logger(WebhookReceiverService.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async processCallWebhook(
    payload: ThinkrrCallPayload,
  ): Promise<{ accepted: boolean; reason?: string; matchedJobId?: string | null }> {
    if (!process.env.DATABASE_URL) {
      this.logger.warn('DATABASE_URL not set — webhook discarded (no persistence available)');
      return { accepted: false, reason: 'database not configured' };
    }

    const tenant = await this.resolveTenant(payload);
    if (!tenant) {
      this.logger.warn(
        `Webhook received for unknown tenant. to=${payload.to_number ?? payload.called_number ?? payload.agent_phone} agent_id=${payload.agent_id}`,
      );
      return { accepted: false, reason: 'tenant not found' };
    }

    const callId = payload.call_id ?? payload.id ?? `unk-${Date.now()}`;
    const callerPhone = normalizePhoneDigits(
      payload.caller_phone ?? payload.phone_number ?? payload.from_number ?? '',
    );
    const calledNumber = normalizePhoneDigits(
      payload.called_number ?? payload.to_number ?? payload.agent_phone ?? '',
    );
    const duration = Number(payload.duration_sec ?? payload.duration ?? 0);
    const transcript = payload.transcript ?? null;
    const summary = payload.summary ?? null;
    const structuredData = payload.structured_data ?? null;

    const match = await this.matchJobByPhone(tenant.id, callerPhone);

    try {
      await this.db
        .insert(callInteractions)
        .values({
          tenantId: tenant.id,
          callId,
          callerPhone: callerPhone || null,
          calledNumber: calledNumber || null,
          durationSec: Number.isFinite(duration) ? duration : 0,
          transcript,
          summary,
          structuredData: structuredData as never,
          rawPayload: payload as never,
          matchedJobId: match?.jobId ?? null,
          matchedJobSource: match?.source ?? null,
          startedAt: parseDate(payload.started_at ?? payload.timestamp),
          endedAt: parseDate(payload.ended_at),
        })
        .onConflictDoNothing({ target: callInteractions.callId });
    } catch (err) {
      this.logger.warn(
        `call_interactions insert failed for ${callId}: ${(err as Error).message}`,
      );
    }

    // Legacy categorized log (kept for the existing /admin/calls dashboard).
    const category = this.categorizeCall(transcript ?? summary ?? '');
    const summarySource = summary ?? transcript ?? '';
    try {
      await this.db.insert(interactionLogs).values({
        tenantId: tenant.id,
        thinkrrCallId: callId,
        callerPhone: callerPhone || '',
        category,
        summary: summarySource.substring(0, 2000),
        outcome: payload.status ?? 'completed',
        durationSeconds: Number.isFinite(duration) ? duration : 0,
      });
    } catch (err) {
      this.logger.warn(
        `interaction_logs insert failed for ${callId}: ${(err as Error).message}`,
      );
    }

    this.logger.log(
      `Call logged tenant=${tenant.id} call_id=${callId} category=${category} matched=${match?.jobId ?? 'none'}`,
    );

    return { accepted: true, matchedJobId: match?.jobId ?? null };
  }

  private async resolveTenant(payload: ThinkrrCallPayload) {
    if (payload.tenant_id) {
      const byId = await this.db.query.tenants.findFirst({
        where: eq(tenants.id, payload.tenant_id),
      });
      if (byId) return byId;
    }

    if (payload.agent_id) {
      const byAgent = await this.db.query.tenants.findFirst({
        where: eq(tenants.thinkrrAgentId, payload.agent_id),
      });
      if (byAgent) return byAgent;
    }

    const phone = payload.called_number ?? payload.to_number ?? payload.agent_phone;
    if (phone) {
      const byPhone = await this.db.query.tenants.findFirst({
        where: eq(tenants.assignedPhoneNumber, phone),
      });
      if (byPhone) return byPhone;
    }

    return null;
  }

  /**
   * Look up the caller's phone against cached active jobs (Towbook + AAA)
   * stored in Redis by the job poller. Digits-only comparison.
   */
  private async matchJobByPhone(
    tenantId: string,
    callerPhone: string,
  ): Promise<{ jobId: string; source: 'TOWBOOK' | 'AAA_PORTAL' } | null> {
    if (!callerPhone) return null;
    const sources: Array<{ key: string; source: 'TOWBOOK' | 'AAA_PORTAL' }> = [
      { key: `jobs:towbook:${tenantId}`, source: 'TOWBOOK' },
      { key: `jobs:aaa_portal:${tenantId}`, source: 'AAA_PORTAL' },
    ];
    for (const { key, source } of sources) {
      let raw: string | null = null;
      try {
        raw = await this.redis.get(key);
      } catch (err) {
        this.logger.warn(`Redis read failed for ${key}: ${(err as Error).message}`);
        continue;
      }
      if (!raw) continue;
      let jobs: ActiveJob[];
      try {
        jobs = JSON.parse(raw) as ActiveJob[];
      } catch {
        continue;
      }
      const callerLast10 = lastTenDigits(callerPhone);
      const hit = jobs.find(
        (j) => lastTenDigits(normalizePhoneDigits(j.customerPhone)) === callerLast10,
      );
      if (hit?.jobId) return { jobId: hit.jobId, source };
    }
    return null;
  }

  categorizeCall(text: string): CallCategory {
    const lower = text.toLowerCase();
    if (
      lower.includes('eta') ||
      lower.includes('how long') ||
      lower.includes('update') ||
      lower.includes('where is')
    ) {
      return 'ETA_LOOKUP';
    }
    if (
      lower.includes('new tow') ||
      lower.includes('need a tow') ||
      lower.includes('broke down') ||
      lower.includes('flat tire')
    ) {
      return 'NEW_TOW_REQUEST';
    }
    if (
      lower.includes('transfer') ||
      lower.includes('speak to') ||
      lower.includes('talk to someone') ||
      lower.includes('human')
    ) {
      return 'TRANSFER_TO_HUMAN';
    }
    if (lower.includes('impound') || lower.includes('my car') || lower.includes('pick up my')) {
      return 'IMPOUND_INQUIRY';
    }
    if (lower.includes('price') || lower.includes('cost') || lower.includes('how much')) {
      return 'PRICING_QUOTE';
    }
    if (
      lower.includes('complaint') ||
      lower.includes('unhappy') ||
      lower.includes('terrible') ||
      lower.includes('awful')
    ) {
      return 'COMPLAINT';
    }
    return 'GENERAL_INQUIRY';
  }
}

function normalizePhoneDigits(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '');
}

/**
 * For phone-equality across Towbook (10 digits, US, no country code) and
 * Thinkrr (E.164 with leading 1), compare the last 10 digits.
 */
function lastTenDigits(digits: string): string {
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
