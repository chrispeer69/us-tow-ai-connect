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
