import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { tenantKnowledgePack, tenants } from '../../db/schema';
import {
  KnowledgePackV2Schema,
  type KnowledgePackV2,
} from '@ustow/shared';
import { recordAudit } from '../tenant-onboarding/audit-log.helper';

@Injectable()
export class KnowledgePackService {
  private readonly logger = new Logger(KnowledgePackService.name);

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  async get(tenantId: string) {
    const row = (
      await this.db
        .select()
        .from(tenantKnowledgePack)
        .where(eq(tenantKnowledgePack.tenantId, tenantId))
        .limit(1)
    )[0];
    if (!row) {
      // Lazily seed an empty draft so the admin UI has something to edit.
      const inserted = await this.db
        .insert(tenantKnowledgePack)
        .values({
          tenantId,
          content: {} as never,
          draft: emptyKp() as never,
          version: 0,
          published: false,
        })
        .returning();
      return rowToApi(inserted[0]);
    }
    return rowToApi(row);
  }

  async saveDraft(tenantId: string, draft: KnowledgePackV2, actor: string) {
    const parsed = KnowledgePackV2Schema.parse(draft);
    const current = await this.get(tenantId);
    await this.db
      .update(tenantKnowledgePack)
      .set({ draft: parsed as never, updatedAt: new Date() })
      .where(eq(tenantKnowledgePack.tenantId, tenantId));
    await recordAudit(this.db, {
      tenantId,
      actorType: 'tenant_admin',
      actorId: actor,
      action: 'knowledge_pack.draft.saved',
      resourceType: 'knowledge_pack',
      resourceId: tenantId,
      beforeState: current.draft as never,
      afterState: parsed as never,
    });
    return this.get(tenantId);
  }

  async publish(tenantId: string, actor: string) {
    const row = (
      await this.db
        .select()
        .from(tenantKnowledgePack)
        .where(eq(tenantKnowledgePack.tenantId, tenantId))
        .limit(1)
    )[0];
    if (!row) {
      throw new NotFoundException({ status: 'error', code: 'KP_NOT_FOUND', message: 'No knowledge pack to publish' });
    }
    const draftObj = row.draft as KnowledgePackV2 | Record<string, never>;
    if (!draftObj || Object.keys(draftObj).length === 0) {
      throw new ConflictException({ status: 'error', code: 'EMPTY_DRAFT', message: 'Draft is empty' });
    }
    const parsed = KnowledgePackV2Schema.parse(draftObj);
    const now = new Date();
    await this.db
      .update(tenantKnowledgePack)
      .set({
        content: parsed as never,
        version: row.version + 1,
        published: true,
        lastPublishedAt: now,
        updatedAt: now,
      })
      .where(eq(tenantKnowledgePack.tenantId, tenantId));

    await recordAudit(this.db, {
      tenantId,
      actorType: 'tenant_admin',
      actorId: actor,
      action: 'knowledge_pack.published',
      resourceType: 'knowledge_pack',
      resourceId: tenantId,
      metadata: { newVersion: row.version + 1 },
      beforeState: row.content as never,
      afterState: parsed as never,
    });

    // Best-effort Thinkrr refresh webhook (skipped if not configured).
    await this.notifyThinkrrRefresh(tenantId, row.version + 1);

    return this.get(tenantId);
  }

  /**
   * Public read: prefer the v2 `content` blob when published; otherwise
   * return null and let callers (e.g. KP markdown endpoint) fall back to
   * the legacy v1 blob on ai_agent_configs.
   *
   * Wrapped in a try/catch so a missing `tenant_knowledge_pack` table
   * (migration 0017 not yet applied on a given env) does not take down
   * the legacy /profile.md endpoint. We return null on any error so the
   * caller falls back gracefully.
   */
  async getPublishedContent(tenantId: string): Promise<{ tenantName: string; content: KnowledgePackV2 } | null> {
    try {
      const row = (
        await this.db
          .select({
            content: tenantKnowledgePack.content,
            published: tenantKnowledgePack.published,
          })
          .from(tenantKnowledgePack)
          .where(eq(tenantKnowledgePack.tenantId, tenantId))
          .limit(1)
      )[0];
      if (!row || !row.published) return null;
      const t = (
        await this.db
          .select({ companyName: tenants.companyName })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1)
      )[0];
      const parsed = KnowledgePackV2Schema.safeParse(row.content);
      if (!parsed.success) {
        this.logger.warn(`[kp] tenant ${tenantId} stored content failed schema validation`);
        return null;
      }
      return { tenantName: t?.companyName ?? parsed.data.identity.name, content: parsed.data };
    } catch (err) {
      this.logger.warn(
        `[kp] getPublishedContent failed for tenant ${tenantId} (likely missing tenant_knowledge_pack table): ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async notifyThinkrrRefresh(tenantId: string, version: number) {
    const url = process.env.THINKRR_KP_REFRESH_WEBHOOK_URL;
    if (!url) {
      this.logger.warn(
        `[kp] THINKRR_KP_REFRESH_WEBHOOK_URL not set — skipping refresh notify for tenant ${tenantId} v${version}`,
      );
      return;
    }
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, version, kind: 'knowledge_pack_published' }),
      });
    } catch (err) {
      this.logger.warn(`[kp] Thinkrr refresh webhook failed: ${(err as Error).message}`);
    }
  }
}

function rowToApi(row: typeof tenantKnowledgePack.$inferSelect) {
  return {
    tenantId: row.tenantId,
    version: row.version,
    published: row.published,
    lastPublishedAt: row.lastPublishedAt,
    draft: row.draft as KnowledgePackV2 | Record<string, never>,
    content: row.content as KnowledgePackV2 | Record<string, never>,
    updatedAt: row.updatedAt,
  };
}

function emptyKp(): KnowledgePackV2 {
  return {
    identity: { name: '', brands: [], slogan: '', founded_year: null, license_numbers: [] },
    services: [],
    service_areas: [],
    hours: { regular: { mon_fri: '24/7', sat: '24/7', sun: '24/7' }, after_hours_premium: false },
    fleet: [],
    transfer_rules: [],
    pricing_policy: { quote_at_dispatch: true, accepts_motor_clubs: [], cash_accepted: true, cards_accepted: true },
    escalation: { manager_phones: [], escalate_after_min_on_hold: 5 },
  };
}
