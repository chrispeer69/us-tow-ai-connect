import { Inject, Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import {
  aiAgentConfigs,
  routingRules,
  tenantApiKeys,
  tenantKnowledgePack,
  tenantMembers,
  tenants,
  users,
} from '../../db/schema';
import type { PartnerTenantCreateBody, BrandingBody } from '@ustow/shared';
import { BrandingSchema } from '@ustow/shared';
import { recordAudit } from '../tenant-onboarding/audit-log.helper';

@Injectable()
export class PartnerService {
  private readonly logger = new Logger(PartnerService.name);

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  async bulkCreate(body: PartnerTenantCreateBody, partner: string) {
    const created: Array<{
      tenantId: string;
      companyName: string;
      apiKey: string;
      knowledgePackUrl: string;
      knowledgePackJsonUrl: string;
    }> = [];

    for (const item of body.tenants) {
      const apiKeyPlaintext = `usk_${randomBytes(24).toString('hex')}`;
      const apiKeyHash = await bcrypt.hash(apiKeyPlaintext, 10);
      const apiKeyPrefix = apiKeyPlaintext.slice(0, 12);

      const branding: Partial<BrandingBody> = item.branding ?? {};
      const mergedBranding = BrandingSchema.parse({
        companyDisplayName: item.companyName,
        primaryColor: '#3b82f6',
        secondaryColor: '#1e293b',
        accentColor: '#facc15',
        fontFamily: 'Inter',
        hidePoweredBy: true, // Partner-resold tenants hide our branding by default.
        ...branding,
      } as BrandingBody);

      const insertedTenant = await this.db
        .insert(tenants)
        .values({
          companyName: item.companyName,
          ownerEmail: item.ownerEmail.trim().toLowerCase(),
          timezone: item.timezone,
          targetSoftwareType: 'TOWBOOK',
          apiKeyHash,
          apiKeyPrefix,
          partnerAccountId: body.partnerAccountId,
          thinkrrAgentId: item.thinkrrAgentId ?? null,
          branding: mergedBranding as never,
        })
        .returning({ id: tenants.id });
      const tenantId = insertedTenant[0].id;

      await this.db.insert(tenantMembers).values({
        tenantId,
        email: item.ownerEmail.trim().toLowerCase(),
        name: item.companyName,
        role: 'OWNER',
        status: 'ACTIVE',
      });

      await this.db
        .insert(users)
        .values({
          email: item.ownerEmail.trim().toLowerCase(),
          name: null,
          platformRole: 'tenant_admin',
        })
        .onConflictDoNothing({ target: users.email });

      await this.db.insert(tenantApiKeys).values({
        tenantId,
        name: `partner:${body.partnerAccountId}`,
        keyHash: apiKeyHash,
        keyPrefix: apiKeyPrefix,
      });

      if (item.transferNumber) {
        await this.db.insert(routingRules).values({
          tenantId,
          ruleName: 'Partner default dispatch',
          phoneNumber: item.transferNumber,
          isActiveNow: true,
          priorityOrder: 0,
        });
      }

      await this.db.insert(aiAgentConfigs).values({
        tenantId,
        greetingMessage: `Thank you for calling ${item.companyName}. How can I help?`,
        defaultEtaMins: 45,
        impoundEnabled: false,
        serviceToggles: {} as never,
        knowledgePack: {} as never,
      });

      await this.db.insert(tenantKnowledgePack).values({
        tenantId,
        content: {} as never,
        draft: {
          identity: { name: item.companyName, brands: [item.companyName], slogan: '', founded_year: null, license_numbers: [] },
          services: [],
          service_areas: [],
          hours: { regular: { mon_fri: '24/7', sat: '24/7', sun: '24/7' }, after_hours_premium: false },
          fleet: [],
          transfer_rules: item.transferNumber
            ? [{ trigger: 'human_request', phone: item.transferNumber, label: 'Dispatch' }]
            : [],
          pricing_policy: { quote_at_dispatch: true, accepts_motor_clubs: [], cash_accepted: true, cards_accepted: true },
          escalation: { manager_phones: [], escalate_after_min_on_hold: 5 },
        } as never,
        version: 0,
        published: false,
      });

      await recordAudit(this.db, {
        tenantId,
        actorType: 'partner',
        actorId: partner,
        action: 'partner.tenant.created',
        resourceType: 'tenant',
        resourceId: tenantId,
        metadata: {
          partnerAccountId: body.partnerAccountId,
          thinkrrAgentId: item.thinkrrAgentId ?? null,
        },
      });

      created.push({
        tenantId,
        companyName: item.companyName,
        apiKey: apiKeyPlaintext,
        knowledgePackUrl: this.buildKpUrl(tenantId, 'md'),
        knowledgePackJsonUrl: this.buildKpUrl(tenantId, 'json'),
      });
    }

    this.logger.log(`[partner=${partner}] created ${created.length} tenant(s) for account ${body.partnerAccountId}`);
    return { partnerAccountId: body.partnerAccountId, created };
  }

  private buildKpUrl(tenantId: string, ext: 'md' | 'json'): string {
    const base = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001';
    if (ext === 'json') return `${base}/public/knowledge/${tenantId}/profile.json`;
    return `${base}/public/knowledge/${tenantId}/profile.md`;
  }
}
