import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TenantOnboardingService } from './tenant-onboarding.service';
import { CaptchaService } from './captcha.service';
import type { OnboardingFormData } from '@ustow/shared';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const DRAFT_ID = '22222222-2222-2222-2222-222222222222';

function makeChain<T>(value: T) {
  const chain = {
    values: () => chain,
    returning: () => Promise.resolve([value]),
    onConflictDoNothing: () => chain,
    where: () => chain,
    set: () => chain,
    limit: () => Promise.resolve([value]),
    from: () => chain,
    orderBy: () => chain,
  };
  return chain;
}

function makeDb(opts?: { existingDraft?: Record<string, unknown> | null; insertedTenantId?: string }) {
  const draft = opts?.existingDraft;
  const tenantId = opts?.insertedTenantId ?? TENANT_ID;
  const inserted: Array<{ table: string; values: Record<string, unknown> }> = [];
  let selectCalls = 0;

  const builder = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            selectCalls += 1;
            return Promise.resolve(selectCalls === 1 && draft ? [draft] : []);
          },
        }),
      }),
    }),
    insert: (tableObj: { _table?: { name?: string } } & Record<string, unknown>) => ({
      values: (v: Record<string, unknown>) => {
        const tableName =
          (tableObj as { _ZodObject?: unknown })._ZodObject !== undefined
            ? 'unknown'
            : 'unknown';
        inserted.push({ table: tableName, values: v });
        const ret = {
          returning: (..._args: unknown[]) =>
            Promise.resolve([{ id: tenantId, ...v, currentStep: 1, formData: v.formData, expiresAt: new Date(Date.now() + 1000), status: 'draft' }]),
          onConflictDoNothing: () => Promise.resolve(),
          then: (resolve: (v: undefined) => void) => {
            resolve(undefined);
            return Promise.resolve();
          },
        };
        return ret;
      },
    }),
    update: (_t: unknown) => ({
      set: (_v: Record<string, unknown>) => ({
        where: () => Promise.resolve(),
      }),
    }),
    delete: (_t: unknown) => ({
      where: () => Promise.resolve(),
    }),
  };

  return { builder, inserted };
}

const makeEncryption = () => ({
  encryptCredentials: vi.fn(() => ({
    usernameEncrypted: 'u',
    passwordEncrypted: 'p',
    iv: 'a:b',
    authTag: 'x:y',
  })),
});

const makeAdapters = () => ({
  getAdapter: vi.fn(() => ({
    testConnection: vi.fn(async () => ({ success: true, message: 'ok', latencyMs: 12 })),
  })),
});

const makeNotifications = () => ({
  send: vi.fn(async () => {}),
});

const makeRedis = () => ({
  del: vi.fn(async () => 0),
});

describe('TenantOnboardingService.complete (happy path)', () => {
  beforeEach(() => {
    delete process.env.SIGNUP_CAPTCHA_KEY;
  });

  it('creates tenant, member, api key, routing rule, agent config, KP draft', async () => {
    const form: OnboardingFormData = {
      step1: { companyName: 'Acme Towing', brandNames: ['Acme'], serviceAreaDescription: 'Central OH', timezone: 'America/New_York' },
      step2: { adminEmail: 'owner@acme.com', adminPhone: '+16145551234', billingEmail: 'bill@acme.com' },
      step3: { towbookUsername: 'u', towbookPassword: 'p', aaaUsername: '', aaaPassword: '' },
      step4: { greetingMessage: 'Thanks for calling!', voicePreference: 'Polly.Joanna', transferNumber: '+16145559999', defaultEtaMins: 30 },
    };
    const draft = {
      id: DRAFT_ID,
      email: 'owner@acme.com',
      formData: form,
      currentStep: 4,
      status: 'draft',
      partnerAccountId: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const { builder, inserted } = makeDb({ existingDraft: draft, insertedTenantId: TENANT_ID });
    const captcha = new CaptchaService();

    const svc = new TenantOnboardingService(
      builder as never,
      makeRedis() as never,
      makeEncryption() as never,
      makeAdapters() as never,
      makeNotifications() as never,
      captcha,
    );

    const out = await svc.complete({ draftId: DRAFT_ID }, '127.0.0.1');
    expect(out.tenantId).toBe(TENANT_ID);
    expect(out.apiKey).toMatch(/^usk_/);
    expect(out.knowledgePackUrl).toContain('/public/knowledge/');
    expect(out.knowledgePackJsonUrl).toContain('profile.json');
    // tenant + member + user + routing + agent_config + KP + api_key + credentials = 8 inserts
    expect(inserted.length).toBeGreaterThanOrEqual(7);
  });

  it('rejects when step1, step2, or step4 is missing', async () => {
    const draft = {
      id: DRAFT_ID,
      email: 'owner@acme.com',
      formData: { step1: { companyName: 'x', brandNames: [], serviceAreaDescription: '', timezone: 'America/New_York' } },
      currentStep: 1,
      status: 'draft',
      partnerAccountId: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const { builder } = makeDb({ existingDraft: draft });
    const svc = new TenantOnboardingService(
      builder as never,
      makeRedis() as never,
      makeEncryption() as never,
      makeAdapters() as never,
      makeNotifications() as never,
      new CaptchaService(),
    );
    await expect(svc.complete({ draftId: DRAFT_ID }, '127.0.0.1')).rejects.toThrow(/INCOMPLETE|Steps/);
  });
});

describe('CaptchaService', () => {
  beforeEach(() => {
    delete process.env.SIGNUP_CAPTCHA_KEY;
  });

  it('returns ok when SIGNUP_CAPTCHA_KEY is unset', async () => {
    const svc = new CaptchaService();
    expect(await svc.verify('whatever')).toEqual({ ok: true });
    expect(svc.isEnabled()).toBe(false);
  });

  it('returns failure when key is set but token missing', async () => {
    process.env.SIGNUP_CAPTCHA_KEY = 'secret';
    const svc = new CaptchaService();
    const out = await svc.verify(undefined);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/missing/i);
  });
});
