import { z } from 'zod';
import { ROLES, STATUSES } from './permissions';

export const RoleSchema = z.enum(ROLES);
export const StatusSchema = z.enum(STATUSES);

export const InviteMemberSchema = z.object({
  email: z.string().email().max(255),
  role: RoleSchema.default('VIEWER'),
  name: z.string().max(255).optional(),
});
export type InviteMemberBody = z.infer<typeof InviteMemberSchema>;

export const UpdateMemberSchema = z
  .object({
    role: RoleSchema.optional(),
    status: StatusSchema.optional(),
    name: z.string().max(255).optional(),
  })
  .refine((b) => b.role !== undefined || b.status !== undefined || b.name !== undefined, {
    message: 'At least one of role, status, or name is required',
  });
export type UpdateMemberBody = z.infer<typeof UpdateMemberSchema>;

export const AcceptInviteSchema = z.object({
  token: z.string().min(1).max(255),
  email: z.string().email().max(255).optional(),
});
export type AcceptInviteBody = z.infer<typeof AcceptInviteSchema>;
