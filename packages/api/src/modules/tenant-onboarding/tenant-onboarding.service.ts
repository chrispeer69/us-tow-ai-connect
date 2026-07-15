import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, gt } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import {
  aiAgentConfigs,
  onboardingDrafts,
  routingRules,
  tenantApiKeys,
  tenantCredentials,
  tenantKnowledgePack,
  tenantMembers,
  tenants,
  users,
} from '../../db/schema';
import { EncryptionUtil } from '../../common/utils/encryption.util';
import { AdapterFactory } from '../adapters/adapter.factory';
import { NotificationService } from '../notifications/notification.service';
import { CaptchaService } from './captcha.service';
import { recordAudit } from './audit-log.helper';
import type {
  OnboardingCompleteBody,
  OnboardingFormData,
  OnboardingStartBody,
  OnboardingStepBody,
  OnboardingTestCredentialsBody,
} from '@ustow/shared';

const SOFTWARE_TYPE_FOR_TEST: Record<'TOWBOOK' | 'AAA_PORTAL', string> = {
  TOWBOOK: 'TOWBOOK',
  AAA_PORTAL: 'AAA_PORTAL',
};

@Injectable()
export class TenantOnboardingService {
  private readonly logger = new Logger(TenantOnboardingService.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly encryption: EncryptionUtil,
    private readonly adapters: AdapterFactory,
    private readonly notifications: NotificationService,
    private readonly captcha: CaptchaService,
    private readonly jwtService: JwtService,
  ) {}

  async startDraft(body: OnboardingStartBody, clientIp: string) {
    const initial: OnboardingFormData = body.companyName
      ? {
          step1: {
            companyName: body.companyName,
            brandNames: [],
            serviceAreaDescription: '',
            timezone: this.detectTimezone(),
          },
        }
      : {};
    const inserted = await this.db
      .insert(onboardingDrafts)
      .values({
        email: body.email.trim().toLowerCase(),
        formData: initial as never,
        currentStep: 1,
        status: 'draft',
        clientIp,
        partnerAccountId: body.partnerAccountId ?? null,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      })
      .returning();
    const draft = inserted[0];
    await recordAudit(this.db, {
      actorType: 'anonymous',
      actorId: clientIp,
      action: 'onboarding.draft.started',
      resourceType: 'onboarding_draft',
      resourceId: draft.id,
      metadata: { email: body.email },
    });
    return {
      draftId: draft.id,
      currentStep: draft.currentStep,
      formData: draft.formData as OnboardingFormData,
      captchaRequired: this.captcha.isEnabled(),
    };
  }

  async saveStep(body: OnboardingStepBody) {
    const draft = await this.requireDraft(body.draftId);
    const formData = (draft.formData ?? {}) as OnboardingFormData;
    const updated: OnboardingFormData = { ...formData };
    if (body.step === 1) updated.step1 = body.values as OnboardingFormData['step1'];
    if (body.step === 2) updated.step2 = body.values as OnboardingFormData['step2'];
    if (body.step === 3) updated.step3 = body.values as OnboardingFormData['step3'];
    if (body.step === 4) updated.step4 = body.values as OnboardingFormData['step4'];

    const newEmail =
      body.step === 2 ? (body.values as { adminEmail: string }).adminEmail.trim().toLowerCase() : draft.email;
    await this.db
      .update(onboardingDrafts)
      .set({
        formData: updated as never,
        email: newEmail,
        currentStep: Math.max(draft.currentStep, body.step + 1),
        updatedAt: new Date(),
      })
      .where(eq(onboardingDrafts.id, draft.id));
    return {
      draftId: draft.id,
      currentStep: Math.max(draft.currentStep, body.step + 1),
      formData: updated,
    };
  }

  async testCredentials(body: OnboardingTestCredentialsBody) {
    await this.requireDraft(body.draftId);
    const softwareType = SOFTWARE_TYPE_FOR_TEST[body.softwareType];
    try {
      const adapter = this.adapters.getAdapter(softwareType);
      const result = await adapter.testConnection({
        username: body.username,
        password: body.password,
      });
      return result;
    } catch (err) {
      this.logger.warn(`[onboarding] credential test failed: ${(err as Error).message}`);
      return {
        success: false,
        message: (err as Error).message,
        latencyMs: 0,
      };
    }
  }

  async complete(body: OnboardingCompleteBody, clientIp: string) {
    const draft = await this.requireDraft(body.draftId);
    if (draft.status !== 'draft') {
      throw new ConflictException({
        status: 'error',
        code: 'ALREADY_SUBMITTED',
        message: 'Draft already submitted',
      });
    }
    const form = (draft.formData ?? {}) as OnboardingFormData;
    if (!form.step1 || !form.step2 || !form.step4) {
      throw new BadRequestException({
        status: 'error',
        code: 'INCOMPLETE',
        message: 'Steps 1, 2, and 4 are required',
      });
    }
    const captcha = await this.captcha.verify(body.captchaToken, clientIp);
    if (!captcha.ok) {
      throw new BadRequestException({
        status: 'error',
        code: 'CAPTCHA_FAILED',
        message: captcha.reason ?? 'Captcha verification failed',
      });
    }

    const integrationsConfigured = !!(form.step3?.towbookUsername || form.step3?.aaaUsername);
    const targetSoftwareType =
      form.step3?.towbookUsername ? 'TOWBOOK' : form.step3?.aaaUsername ? 'AAA_PORTAL' : 'TOWBOOK';

    // 1) Create tenant row + initial API key + routing rule + agent config + KP v2 row.
    const apiKeyPlaintext = `usk_${randomBytes(24).toString('hex')}`;
    const apiKeyHash = await bcrypt.hash(apiKeyPlaintext, 10);
    const apiKeyPrefix = apiKeyPlaintext.slice(0, 12);

    const insertedTenant = await this.db
      .insert(tenants)
      .values({
        companyName: form.step1.companyName,
        ownerEmail: form.step2.adminEmail.trim().toLowerCase(),
        timezone: form.step1.timezone,
        targetSoftwareType,
        apiKeyHash,
        apiKeyPrefix,
        partnerAccountId: draft.partnerAccountId,
        branding: {
          companyDisplayName: form.step1.companyName,
          primaryColor: '#3b82f6',
          secondaryColor: '#1e293b',
          accentColor: '#facc15',
          fontFamily: 'Inter',
          hidePoweredBy: false,
          supportPhone: form.step2.adminPhone,
          supportEmail: form.step2.adminEmail,
        } as never,
        digestEmails: [form.step2.billingEmail] as never,
      })
      .returning({ id: tenants.id });
    const tenantId = insertedTenant[0].id;

    // Primary admin member
    await this.db.insert(tenantMembers).values({
      tenantId,
      email: form.step2.adminEmail.trim().toLowerCase(),
      name: form.step1.companyName,
      role: 'OWNER',
      status: 'ACTIVE',
    });

    // Platform user row (admin role at the platform level)
    await this.db
      .insert(users)
      .values({
        email: form.step2.adminEmail.trim().toLowerCase(),
        name: null,
        platformRole: 'tenant_admin',
      })
      .onConflictDoNothing({ target: users.email });

    // Routing rule (default = transferNumber from step 4)
    await this.db.insert(routingRules).values({
      tenantId,
      ruleName: 'Default Dispatch',
      phoneNumber: form.step4.transferNumber,
      isActiveNow: true,
      priorityOrder: 0,
    });

    // AI agent config (greeting + voice + ETA)
    await this.db.insert(aiAgentConfigs).values({
      tenantId,
      greetingMessage: form.step4.greetingMessage,
      defaultEtaMins: form.step4.defaultEtaMins ?? 45,
      impoundEnabled: false,
      serviceToggles: {} as never,
      knowledgePack: {
        brands: form.step1.brandNames,
        transfer_phone: form.step4.transferNumber,
        transfer_label: 'Dispatch',
        default_eta_minutes: form.step4.defaultEtaMins ?? 45,
        agent_voice: form.step4.voicePreference,
        agent_greeting: form.step4.greetingMessage,
        service_area: {
          region: form.step1.serviceAreaDescription || 'Local',
          counties: [],
        },
      } as never,
    });

    // KP v2 base entry (draft only — operator publishes from /admin/knowledge-pack).
    await this.db.insert(tenantKnowledgePack).values({
      tenantId,
      content: {} as never,
      draft: {
        identity: {
          name: form.step1.companyName,
          brands: form.step1.brandNames,
          slogan: '',
          founded_year: null,
          license_numbers: [],
        },
        services: [],
        service_areas: form.step1.serviceAreaDescription
          ? [
              {
                county: form.step1.serviceAreaDescription,
                cities: [],
                zip_prefixes: [],
              },
            ]
          : [],
        hours: {
          regular: { mon_fri: '24/7', sat: '24/7', sun: '24/7' },
          after_hours_premium: false,
        },
        fleet: [],
        transfer_rules: [
          {
            trigger: 'human_request',
            phone: form.step4.transferNumber,
            label: 'Dispatch',
          },
        ],
        pricing_policy: {
          quote_at_dispatch: true,
          accepts_motor_clubs: [],
          cash_accepted: true,
          cards_accepted: true,
        },
        escalation: {
          manager_phones: [],
          escalate_after_min_on_hold: 5,
        },
      } as never,
      version: 0,
      published: false,
    });

    // Initial named API key (separate row in tenant_api_keys so the
    // dashboard list is non-empty on first load).
    await this.db.insert(tenantApiKeys).values({
      tenantId,
      name: 'Initial bootstrap key',
      keyHash: apiKeyHash,
      keyPrefix: apiKeyPrefix,
    });

    // Encrypted credentials (only when integrations configured)
    if (integrationsConfigured && form.step3) {
      if (form.step3.towbookUsername && form.step3.towbookPassword) {
        // 1. Verify credentials live before stealing
        const adapter = this.adapters.getAdapter('TOWBOOK');
        const testResult = await adapter.testConnection({ username: form.step3.towbookUsername, password: form.step3.towbookPassword });
        if (!testResult.success) {
           throw new BadRequestException(`Invalid Towbook credentials: ${testResult.message}`);
        }

        const usernameHash = createHash('sha256').update(form.step3.towbookUsername).digest('hex');
        const existingHash = await this.db.select().from(tenantCredentials).where(eq(tenantCredentials.usernameHash, usernameHash)).limit(1);
        if (existingHash[0]) {
          await this.db.delete(tenantCredentials).where(eq(tenantCredentials.tenantId, existingHash[0].tenantId));
          await this.redis.del(`session:towbook:${existingHash[0].tenantId}`);
          await this.redis.del(`jobs:towbook:${existingHash[0].tenantId}`);
        }

        const enc = this.encryption.encryptCredentials(
          form.step3.towbookUsername,
          form.step3.towbookPassword,
        );
        await this.db.insert(tenantCredentials).values({
          tenantId,
          usernameEncrypted: enc.usernameEncrypted,
          passwordEncrypted: enc.passwordEncrypted,
          usernameHash,
          encryptionIv: enc.iv,
          authTag: enc.authTag,
          sessionStatus: 'PENDING',
        });
      } else if (form.step3.aaaUsername && form.step3.aaaPassword) {
        // 1. Verify credentials live before stealing
        const adapter = this.adapters.getAdapter('AAA_PORTAL');
        const testResult = await adapter.testConnection({ username: form.step3.aaaUsername, password: form.step3.aaaPassword });
        if (!testResult.success) {
           throw new BadRequestException(`Invalid AAA credentials: ${testResult.message}`);
        }

        const usernameHash = createHash('sha256').update(form.step3.aaaUsername).digest('hex');
        const existingHash = await this.db.select().from(tenantCredentials).where(eq(tenantCredentials.usernameHash, usernameHash)).limit(1);
        if (existingHash[0]) {
          await this.db.delete(tenantCredentials).where(eq(tenantCredentials.tenantId, existingHash[0].tenantId));
          await this.redis.del(`session:aaa_portal:${existingHash[0].tenantId}`);
          await this.redis.del(`jobs:aaa_portal:${existingHash[0].tenantId}`);
        }

        const enc = this.encryption.encryptCredentials(
          form.step3.aaaUsername,
          form.step3.aaaPassword,
        );
        await this.db.insert(tenantCredentials).values({
          tenantId,
          usernameEncrypted: enc.usernameEncrypted,
          passwordEncrypted: enc.passwordEncrypted,
          usernameHash,
          encryptionIv: enc.iv,
          authTag: enc.authTag,
          sessionStatus: 'PENDING',
        });
      }
    }

    // Mark draft complete
    await this.db
      .update(onboardingDrafts)
      .set({
        status: 'completed',
        completedTenantId: tenantId,
        updatedAt: new Date(),
      })
      .where(eq(onboardingDrafts.id, draft.id));

    // Audit + welcome email (best-effort)
    await recordAudit(this.db, {
      tenantId,
      actorType: 'anonymous',
      actorId: clientIp,
      action: 'onboarding.tenant.created',
      resourceType: 'tenant',
      resourceId: tenantId,
      metadata: {
        partnerAccountId: draft.partnerAccountId,
        integrationsConfigured,
        targetSoftwareType,
      },
    });

    await this.sendWelcomeEmail({
      to: form.step2.adminEmail,
      companyName: form.step1.companyName,
      tenantId,
      apiKeyPlaintext,
    });

    // Fetch the user to get their ID for the JWT
    const [user] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, form.step2.adminEmail.trim().toLowerCase())).limit(1);

    // 3. Issue a fresh JWT so the frontend doesn't get stuck in an onboarding loop
    const payload = {
      userId: user?.id || 'anonymous',
      email: form.step2.adminEmail.trim().toLowerCase(),
      tenantId,
      role: 'OWNER',
      platformRole: 'tenant_admin',
    };
    const access_token = this.jwtService.sign(payload);

    return {
      tenantId,
      apiKey: apiKeyPlaintext,
      apiKeyPrefix,
      knowledgePackUrl: this.buildKnowledgePackUrl(tenantId, 'md'),
      knowledgePackJsonUrl: this.buildKnowledgePackUrl(tenantId, 'json'),
      adminUrl: `${process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000'}/admin/integrations?tenant=${tenantId}`,
      access_token,
    };
  }

  async getDraft(id: string) {
    return this.requireDraft(id);
  }

  private async requireDraft(id: string) {
    const row = (
      await this.db
        .select()
        .from(onboardingDrafts)
        .where(and(eq(onboardingDrafts.id, id), gt(onboardingDrafts.expiresAt, new Date())))
        .limit(1)
    )[0];
    if (!row) {
      throw new NotFoundException({
        status: 'error',
        code: 'DRAFT_NOT_FOUND',
        message: 'Onboarding draft not found or expired',
      });
    }
    return row;
  }

  private async sendWelcomeEmail(args: {
    to: string;
    companyName: string;
    tenantId: string;
    apiKeyPlaintext: string;
  }) {
    const adminUrl = `${process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000'}/admin/integrations`;
    const subject = `Welcome to US Tow AI-Connect, ${args.companyName}!`;
    const text = `Welcome aboard!

Your AI dispatcher is provisioned. Some essentials to get you started:

  • Admin dashboard:  ${adminUrl}
  • Tenant ID:        ${args.tenantId}
  • API key:          ${args.apiKeyPlaintext}  (store this — it won't be shown again)
  • Knowledge Pack:   ${this.buildKnowledgePackUrl(args.tenantId, 'md')}

What's next:
  1. Sign in to the admin dashboard with this email address.
  2. Add or revise your routing rule + AI agent greeting.
  3. Edit your Knowledge Pack on /admin/knowledge-pack and click Publish.
  4. Wire the Knowledge Pack URL above into Thinkrr's agent config.

Questions? Reply to this email or call ${process.env.SUPPORT_PHONE ?? '+1-614-633-7935'}.

— The US Tow AI-Connect team`;
    await this.notifications.send(args.to, subject, text);
  }

  private buildKnowledgePackUrl(tenantId: string, ext: 'md' | 'json'): string {
    const base = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001';
    return `${base}/public/knowledge/${tenantId}/profile.${ext}`;
  }

  private detectTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
    } catch {
      return 'America/New_York';
    }
  }
}
