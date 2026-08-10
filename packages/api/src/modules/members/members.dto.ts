import { z } from 'zod';
import { ROLES, STATUSES } from './permissions';

export const RoleSchema = z.enum(ROLES);
export const StatusSchema = z.enum(STATUSES);

// bcrypt silently truncates past 72 bytes — cap there rather than accept a
// password whose tail does nothing.
export const PasswordSchema = z.string().min(8).max(72);

export const InviteMemberSchema = z.object({
  email: z.string().email().max(255),
  role: RoleSchema.default('VIEWER'),
  name: z.string().max(255).optional(),
  // When present the member is provisioned directly with this password and no
  // invite email is sent — the path that works while SendGrid/Twilio approvals
  // are pending. Owner-only; see MembersController.
  password: PasswordSchema.optional(),
});
export type InviteMemberBody = z.infer<typeof InviteMemberSchema>;

export const SetMemberPasswordSchema = z.object({
  password: PasswordSchema,
});
export type SetMemberPasswordBody = z.infer<typeof SetMemberPasswordSchema>;

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
  name: z.string().max(255).optional(),
  password: z.string().min(8).max(255).optional(), // optional for backwards compatibility, but required by new UI
});
export type AcceptInviteBody = z.infer<typeof AcceptInviteSchema>;
