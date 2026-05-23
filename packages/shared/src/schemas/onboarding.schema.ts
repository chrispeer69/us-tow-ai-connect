import { z } from 'zod';

const e164 = z.string().regex(/^\+?[1-9]\d{6,14}$/, 'Must be E.164 format');

export const OnboardingStartSchema = z.object({
  email: z.string().email().max(255),
  companyName: z.string().min(1).max(255).optional(),
  partnerAccountId: z.string().max(120).optional(),
});
export type OnboardingStartBody = z.infer<typeof OnboardingStartSchema>;

export const OnboardingCompanyStep = z.object({
  companyName: z.string().min(1).max(255),
  brandNames: z.array(z.string().max(255)).max(20).default([]),
  serviceAreaDescription: z.string().max(2000).optional().default(''),
  timezone: z.string().min(1).max(50),
});

export const OnboardingContactStep = z.object({
  adminEmail: z.string().email().max(255),
  adminPhone: e164,
  billingEmail: z.string().email().max(255),
});

export const OnboardingIntegrationStep = z.object({
  towbookUsername: z.string().max(200).optional(),
  towbookPassword: z.string().max(500).optional(),
  aaaUsername: z.string().max(200).optional(),
  aaaPassword: z.string().max(500).optional(),
  testedAt: z.string().optional(),
});

export const OnboardingAgentStep = z.object({
  greetingMessage: z.string().min(1).max(500),
  voicePreference: z.enum(['Polly.Joanna', 'Polly.Matthew', 'Polly.Amy', 'Polly.Brian']).default('Polly.Joanna'),
  transferNumber: e164,
  defaultEtaMins: z.number().int().min(0).max(600).default(45),
});

export const OnboardingStepSchema = z.object({
  draftId: z.string().uuid(),
  step: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  values: z.union([
    OnboardingCompanyStep,
    OnboardingContactStep,
    OnboardingIntegrationStep,
    OnboardingAgentStep,
  ]),
});
export type OnboardingStepBody = z.infer<typeof OnboardingStepSchema>;

export const OnboardingTestCredentialsSchema = z.object({
  draftId: z.string().uuid(),
  softwareType: z.enum(['TOWBOOK', 'AAA_PORTAL']),
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(500),
});
export type OnboardingTestCredentialsBody = z.infer<typeof OnboardingTestCredentialsSchema>;

export const OnboardingCompleteSchema = z.object({
  draftId: z.string().uuid(),
  captchaToken: z.string().optional(),
});
export type OnboardingCompleteBody = z.infer<typeof OnboardingCompleteSchema>;

export interface OnboardingFormData {
  step1?: z.infer<typeof OnboardingCompanyStep>;
  step2?: z.infer<typeof OnboardingContactStep>;
  step3?: z.infer<typeof OnboardingIntegrationStep>;
  step4?: z.infer<typeof OnboardingAgentStep>;
}

// ============ BRANDING SCHEMA ============
const hex = z.string().regex(/^#([0-9a-fA-F]{3}){1,2}$/, 'Must be hex color (#abc or #aabbcc)');

export const BrandingFontFamily = z.enum([
  'Inter',
  'Roboto',
  'Open Sans',
  'Source Sans 3',
  'Lato',
  'Montserrat',
  'System UI',
]);
export type BrandingFontFamilyType = z.infer<typeof BrandingFontFamily>;

export const BrandingSchema = z.object({
  companyDisplayName: z.string().max(255).default(''),
  logoUrl: z.string().url().max(2000).optional().or(z.literal('')),
  faviconUrl: z.string().url().max(2000).optional().or(z.literal('')),
  primaryColor: hex.default('#3b82f6'),
  secondaryColor: hex.default('#1e293b'),
  accentColor: hex.default('#facc15'),
  fontFamily: BrandingFontFamily.default('Inter'),
  emailSignatureHtml: z.string().max(5000).default(''),
  smsSignature: z.string().max(160).default(''),
  supportPhone: z.string().regex(/^\+?[1-9]\d{6,14}$/).optional().or(z.literal('')),
  supportEmail: z.string().email().max(255).optional().or(z.literal('')),
  customDomain: z.string().max(255).nullable().optional(),
  hidePoweredBy: z.boolean().default(false),
});
export type BrandingBody = z.infer<typeof BrandingSchema>;

// ============ KNOWLEDGE PACK V2 ============
const KpServiceArea = z.object({
  county: z.string().max(120),
  cities: z.array(z.string().max(120)).max(200).default([]),
  zip_prefixes: z.array(z.string().regex(/^[0-9]{3,5}$/)).max(200).default([]),
});

const KpService = z.object({
  name: z.string().max(120),
  description: z.string().max(2000).default(''),
  price_range_disclaimer: z.string().max(500).default(''),
  availability_24_7: z.boolean().default(true),
});

const KpFleetVehicle = z.object({
  type: z.enum(['light-duty', 'medium-duty', 'heavy-duty', 'flatbed', 'wrecker', 'rotator']),
  count: z.number().int().min(0).max(1000),
});

const KpTransferRule = z.object({
  trigger: z.enum(['human_request', 'impound', 'pricing', 'after_hours']),
  phone: z.string().regex(/^\+?[1-9]\d{6,14}$/),
  label: z.string().max(120),
});

export const KnowledgePackV2Schema = z.object({
  identity: z.object({
    name: z.string().max(255),
    brands: z.array(z.string().max(255)).max(20).default([]),
    slogan: z.string().max(255).default(''),
    founded_year: z.number().int().min(1800).max(2100).nullable().optional(),
    license_numbers: z.array(z.string().max(80)).max(20).default([]),
  }),
  services: z.array(KpService).max(50).default([]),
  service_areas: z.array(KpServiceArea).max(50).default([]),
  hours: z.object({
    regular: z.object({
      mon_fri: z.string().max(120),
      sat: z.string().max(120),
      sun: z.string().max(120),
    }),
    after_hours_premium: z.boolean().default(false),
  }),
  fleet: z.array(KpFleetVehicle).max(20).default([]),
  transfer_rules: z.array(KpTransferRule).max(20).default([]),
  pricing_policy: z.object({
    quote_at_dispatch: z.boolean().default(true),
    accepts_motor_clubs: z.array(z.string().max(80)).max(50).default([]),
    cash_accepted: z.boolean().default(true),
    cards_accepted: z.boolean().default(true),
  }),
  escalation: z.object({
    manager_phones: z.array(z.string().regex(/^\+?[1-9]\d{6,14}$/)).max(20).default([]),
    escalate_after_min_on_hold: z.number().int().min(0).max(60).default(5),
  }),
});
export type KnowledgePackV2 = z.infer<typeof KnowledgePackV2Schema>;

// ============ SUPER-ADMIN ============
export const ImpersonateSchema = z.object({
  targetTenantId: z.string().uuid(),
});
export type ImpersonateBody = z.infer<typeof ImpersonateSchema>;

// ============ PARTNER BULK CREATE ============
export const PartnerTenantCreateSchema = z.object({
  partnerAccountId: z.string().min(1).max(120),
  tenants: z.array(z.object({
    companyName: z.string().min(1).max(255),
    ownerEmail: z.string().email().max(255),
    timezone: z.string().min(1).max(50).default('America/New_York'),
    transferNumber: z.string().regex(/^\+?[1-9]\d{6,14}$/).optional(),
    thinkrrAgentId: z.string().max(100).optional(),
    branding: BrandingSchema.partial().optional(),
  })).min(1).max(50),
});
export type PartnerTenantCreateBody = z.infer<typeof PartnerTenantCreateSchema>;
