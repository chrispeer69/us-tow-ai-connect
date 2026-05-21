import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, asc } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { interactionLogs, routingRules } from '../../db/schema';
import type { LogInteractionRequest } from '@ustow/shared';

@Injectable()
export class AiConnectService {
  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  async getActiveTransferRoute(tenantId: string) {
    const rows = await this.db
      .select()
      .from(routingRules)
      .where(and(eq(routingRules.tenantId, tenantId), eq(routingRules.isActiveNow, true)))
      .orderBy(asc(routingRules.priorityOrder))
      .limit(1);
    const rule = rows[0];
    if (!rule) {
      throw new NotFoundException({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'No active routing rule configured',
      });
    }
    return rule;
  }

  async logInteraction(tenantId: string, dto: LogInteractionRequest): Promise<void> {
    await this.db.insert(interactionLogs).values({
      tenantId,
      thinkrrCallId: dto.thinkrr_call_id,
      callerPhone: dto.caller_phone,
      category: dto.category,
      summary: dto.summary,
      outcome: dto.outcome,
      durationSeconds: dto.duration_seconds,
    });
  }
}
