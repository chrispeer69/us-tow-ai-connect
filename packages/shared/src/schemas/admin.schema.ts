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

const VehicleClassPolicy = z.enum(['AI_HANDLES', 'TRANSFER', 'NOT_OFFERED']);

export const AgentConfigUpdateSchema = z.object({
  greetingMessage: z.string().max(250),
  defaultEtaMins: z.number().int().min(0).max(600),
  impoundEnabled: z.boolean().optional(),
  serviceToggles: z.record(
    z.object({
      enabled: z.boolean(),
      classes: z.record(VehicleClassPolicy).optional(),
    }),
  ),
});
export type AgentConfigUpdateBody = z.infer<typeof AgentConfigUpdateSchema>;
