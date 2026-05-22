import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { tenants, interactionLogs } from '../../db/schema';

export interface ThinkrrCallPayload {
  call_id?: string;
  id?: string;
  agent_id?: string;
  phone_number?: string;
  from_number?: string;
  to_number?: string;
  agent_phone?: string;
  duration?: number;
  status?: string;
  transcript?: string;
  summary?: string;
  recording_url?: string;
  sentiment?: string;
  agent_name?: string;
  timestamp?: string;
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

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  async processCallWebhook(payload: ThinkrrCallPayload): Promise<{ accepted: boolean; reason?: string }> {
    if (!process.env.DATABASE_URL) {
      this.logger.warn('DATABASE_URL not set — webhook discarded (no persistence available)');
      return { accepted: false, reason: 'database not configured' };
    }

    const tenant = await this.resolveTenant(payload);
    if (!tenant) {
      this.logger.warn(
        `Webhook received for unknown tenant. to=${payload.to_number ?? payload.agent_phone} agent_id=${payload.agent_id}`,
      );
      return { accepted: false, reason: 'tenant not found' };
    }

    const category = this.categorizeCall(payload.transcript ?? payload.summary ?? '');
    const summarySource = payload.summary ?? payload.transcript ?? '';

    await this.db.insert(interactionLogs).values({
      tenantId: tenant.id,
      thinkrrCallId: payload.call_id ?? payload.id ?? 'unknown',
      callerPhone: payload.phone_number ?? payload.from_number ?? '',
      category,
      summary: summarySource.substring(0, 2000),
      outcome: payload.status ?? 'completed',
      durationSeconds: Number(payload.duration ?? 0),
    });

    this.logger.log(`Call logged for tenant ${tenant.id}: ${category}`);
    return { accepted: true };
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

    const phone = payload.to_number ?? payload.agent_phone;
    if (phone) {
      const byPhone = await this.db.query.tenants.findFirst({
        where: eq(tenants.assignedPhoneNumber, phone),
      });
      if (byPhone) return byPhone;
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
