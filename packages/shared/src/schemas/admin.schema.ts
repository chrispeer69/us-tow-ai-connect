import { z } from 'zod';

export const SaveCredentialsSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(500),
  softwareType: z.enum(['TOWBOOK', 'TOWLOGS', 'OMADI', 'AAA_PORTAL', 'NATIVE']),
});
export type SaveCredentialsBody = z.infer<typeof SaveCredentialsSchema>;

const e164 = z.string().regex(/^\+?[1-9]\d{6,14}$/, 'Must be E.164 format');

export const RoutingRuleCreateSchema = z.object({
  ruleName: z.string().min(1).max(100),
  phoneNumber: e164,
});
export type RoutingRuleCreateBody = z.infer<typeof RoutingRuleCreateSchema>;

export const CompanyUpdateSchema = z.object({
  companyName: z.string().min(1).max(255),
  ownerEmail: z.string().email().max(255),
  timezone: z.string().min(1).max(50),
  managerPhones: z.array(e164).max(20).optional(),
});
export type CompanyUpdateBody = z.infer<typeof CompanyUpdateSchema>;

export const MemberRole = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);
export type MemberRoleType = z.infer<typeof MemberRole>;

export const MemberCreateSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().max(255).optional(),
  role: MemberRole.default('MEMBER'),
});
export type MemberCreateBody = z.infer<typeof MemberCreateSchema>;

export const MemberUpdateSchema = z.object({
  name: z.string().max(255).optional(),
  role: MemberRole.optional(),
  status: z.enum(['ACTIVE', 'INVITED', 'SUSPENDED']).optional(),
});
export type MemberUpdateBody = z.infer<typeof MemberUpdateSchema>;

export const ApiKeyCreateSchema = z.object({
  name: z.string().min(1).max(100),
});
export type ApiKeyCreateBody = z.infer<typeof ApiKeyCreateSchema>;

export const BillingPlan = z.enum(['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE']);
export type BillingPlanType = z.infer<typeof BillingPlan>;

export const BillingPlanUpdateSchema = z.object({
  plan: BillingPlan,
});
export type BillingPlanUpdateBody = z.infer<typeof BillingPlanUpdateSchema>;

// ── Session 28: Stripe checkout ──────────────────────────────────────────
// A checkout is either a subscription (one of the paid plans) or a one-off
// per-job credit pack purchase. The API maps the plan/kind to a configured
// Stripe price id (STRIPE_PRICE_*) — the client never sends raw price ids.
export const SubscriptionPlan = z.enum(['STARTER', 'PRO', 'ENTERPRISE']);
export type SubscriptionPlanType = z.infer<typeof SubscriptionPlan>;

export const CheckoutSessionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('subscription'),
    plan: SubscriptionPlan,
  }),
  z.object({
    kind: z.literal('credit_pack'),
    // Optional quantity of credit packs (Stripe line-item quantity). Defaults
    // to 1 server-side.
    quantity: z.number().int().min(1).max(100).optional(),
  }),
]);
export type CheckoutSessionBody = z.infer<typeof CheckoutSessionSchema>;

const VehicleClassPolicy = z.enum(['AI_HANDLES', 'TRANSFER', 'NOT_OFFERED']);
const OutboundCallMode = z.enum(['AUTO', 'MANUAL_ONLY', 'OFF']);

export const AgentConfigUpdateSchema = z.object({
  greetingMessage: z.string().max(250),
  defaultEtaMins: z.number().int().min(0).max(600),
  impoundEnabled: z.boolean().optional(),
  outboundCallMode: OutboundCallMode.optional(),
  testModeEnabled: z.boolean().optional(),
  testOverrideNumber: z.string().max(20).optional().nullable(),
  serviceToggles: z.record(
    z.object({
      enabled: z.boolean(),
      classes: z.record(VehicleClassPolicy).optional(),
    }),
  ),
});
export type AgentConfigUpdateBody = z.infer<typeof AgentConfigUpdateSchema>;
