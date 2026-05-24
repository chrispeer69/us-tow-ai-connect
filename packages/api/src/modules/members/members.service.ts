import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { rolePermissions, tenantMembers } from '../../db/schema';
import { SendGridEmailService } from '../admin-digest/sendgrid-email.service';
import {
  PERMISSION_MATRIX,
  grantsSatisfy,
  isRole,
  type Role,
} from './permissions';

export interface InviteInput {
  email: string;
  role: Role;
  name?: string;
  invitedBy?: string | null;
}

export interface UpdateInput {
  role?: Role;
  status?: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
  name?: string;
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly email: SendGridEmailService,
  ) {}

  // ─── queries ────────────────────────────────────────────────────────────
  async listByTenant(tenantId: string) {
    const rows = await this.db
      .select()
      .from(tenantMembers)
      .where(eq(tenantMembers.tenantId, tenantId))
      .orderBy(asc(tenantMembers.invitedAt));
    // invite_token is a bearer credential — never expose it in list responses.
    return rows.map((r) => this.redact(r));
  }

  async findMember(tenantId: string, email: string) {
    const normalized = email.trim().toLowerCase();
    return (
      await this.db
        .select()
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.tenantId, tenantId),
            sql`lower(${tenantMembers.email}) = ${normalized}`,
          ),
        )
        .limit(1)
    )[0];
  }

  // ─── permission resolution (DB-backed, static fallback) ───────────────────
  /** Grants for a role: role_permissions rows, or the static matrix if unseeded. */
  async permissionsForRole(role: string): Promise<string[]> {
    const rows = await this.db
      .select({ key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.role, role));
    if (rows.length > 0) return rows.map((r) => r.key);
    // Fallback: DB not seeded yet — use the compiled mirror so enforcement is
    // never silently empty.
    return isRole(role) ? [...PERMISSION_MATRIX[role]] : [];
  }

  async roleHasPermission(role: string, required: string): Promise<boolean> {
    const grants = await this.permissionsForRole(role);
    return grantsSatisfy(grants, required);
  }

  /** Effective member + permission keys for the acting user (RBAC `me`). */
  async currentUser(tenantId: string, email: string | null) {
    let member = email ? await this.findMember(tenantId, email) : undefined;
    if (!member) {
      // No resolvable identity (legacy tenant-id-only request): fall back to the
      // tenant's canonical owner so the UI has a subject to render.
      member = (
        await this.db
          .select()
          .from(tenantMembers)
          .where(
            and(
              eq(tenantMembers.tenantId, tenantId),
              eq(tenantMembers.role, 'OWNER'),
            ),
          )
          .orderBy(asc(tenantMembers.invitedAt))
          .limit(1)
      )[0];
    }
    if (!member) {
      return { member: null, permissions: [] as string[], resolvedFrom: 'none' };
    }
    const permissions = await this.permissionsForRole(member.role);
    return {
      member: this.redact(member),
      permissions,
      resolvedFrom: email ? 'identity' : 'owner_fallback',
    };
  }

  // ─── mutations ────────────────────────────────────────────────────────────
  async invite(tenantId: string, input: InviteInput) {
    const normalizedEmail = input.email.trim().toLowerCase();
    const dup = await this.findMember(tenantId, normalizedEmail);
    if (dup) {
      throw new ConflictException({
        status: 'error',
        code: 'MEMBER_EXISTS',
        message: 'A member with that email already exists',
      });
    }
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const member = (
      await this.db
        .insert(tenantMembers)
        .values({
          tenantId,
          email: normalizedEmail,
          name: input.name ?? null,
          role: input.role,
          status: 'INVITED',
          invitedBy: input.invitedBy ?? null,
          inviteToken: token,
          inviteTokenExpiresAt: expiresAt,
        })
        .returning()
    )[0];

    await this.sendInviteEmail(tenantId, normalizedEmail, token, input.role);
    // Never leak the raw token in the API response.
    return this.redact(member);
  }

  async update(tenantId: string, memberId: string, input: UpdateInput) {
    const target = await this.requireMember(tenantId, memberId);

    // Guard the last owner against demotion / suspension.
    if (target.role === 'OWNER') {
      const demoting = input.role !== undefined && input.role !== 'OWNER';
      const deactivating = input.status !== undefined && input.status !== 'ACTIVE';
      if (demoting || deactivating) {
        await this.assertNotLastOwner(tenantId, 'demote');
      }
    }

    const patch: Partial<typeof tenantMembers.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.role !== undefined) patch.role = input.role;
    if (input.status !== undefined) patch.status = input.status;
    if (Object.keys(patch).length === 0) return this.redact(target);

    const updated = (
      await this.db
        .update(tenantMembers)
        .set(patch)
        .where(eq(tenantMembers.id, memberId))
        .returning()
    )[0];
    return this.redact(updated);
  }

  async revoke(tenantId: string, memberId: string) {
    const target = await this.requireMember(tenantId, memberId);
    if (target.role === 'OWNER') {
      await this.assertNotLastOwner(tenantId, 'remove');
    }
    await this.db.delete(tenantMembers).where(eq(tenantMembers.id, memberId));
    return { status: 'success' as const };
  }

  async acceptInvite(token: string, email?: string) {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new BadRequestException({
        status: 'error',
        code: 'INVALID_TOKEN',
        message: 'Missing invite token',
      });
    }
    const member = (
      await this.db
        .select()
        .from(tenantMembers)
        .where(eq(tenantMembers.inviteToken, trimmed))
        .limit(1)
    )[0];
    if (!member) {
      throw new NotFoundException({
        status: 'error',
        code: 'INVALID_TOKEN',
        message: 'Invite token not recognized',
      });
    }
    if (
      member.inviteTokenExpiresAt &&
      member.inviteTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new ForbiddenException({
        status: 'error',
        code: 'TOKEN_EXPIRED',
        message: 'This invitation has expired. Ask an owner to re-invite you.',
      });
    }
    if (email && email.trim().toLowerCase() !== member.email.toLowerCase()) {
      throw new ForbiddenException({
        status: 'error',
        code: 'EMAIL_MISMATCH',
        message: 'This invitation belongs to a different email address',
      });
    }
    const now = new Date();
    const updated = (
      await this.db
        .update(tenantMembers)
        .set({
          status: 'ACTIVE',
          acceptedAt: now,
          lastLoginAt: now,
          inviteToken: null,
          inviteTokenExpiresAt: null,
        })
        .where(eq(tenantMembers.id, member.id))
        .returning()
    )[0];
    return this.redact(updated);
  }

  // ─── helpers ──────────────────────────────────────────────────────────────
  private async requireMember(tenantId: string, memberId: string) {
    const target = (
      await this.db
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.id, memberId), eq(tenantMembers.tenantId, tenantId)))
        .limit(1)
    )[0];
    if (!target) {
      throw new NotFoundException({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Member not found',
      });
    }
    return target;
  }

  private async assertNotLastOwner(tenantId: string, action: 'demote' | 'remove') {
    const owners =
      (
        await this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(tenantMembers)
          .where(
            and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.role, 'OWNER')),
          )
      )[0]?.count ?? 0;
    if (owners <= 1) {
      throw new ConflictException({
        status: 'error',
        code: 'LAST_OWNER',
        message: `Cannot ${action} the last owner`,
      });
    }
  }

  private redact<T extends { inviteToken?: string | null }>(row: T): T {
    if (!row) return row;
    const { inviteToken: _omit, ...rest } = row;
    return rest as T;
  }

  private async sendInviteEmail(
    tenantId: string,
    to: string,
    token: string,
    role: Role,
  ) {
    const base = (process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    const acceptUrl = `${base}/accept-invite?token=${token}&email=${encodeURIComponent(to)}`;
    const subject = "You've been invited to US Tow Dispatch";
    const html = `
      <p>You've been invited to join a US Tow Dispatch workspace as <strong>${role}</strong>.</p>
      <p><a href="${acceptUrl}">Accept your invitation</a></p>
      <p>This link expires in 7 days. If you weren't expecting this, you can ignore it.</p>
    `.trim();
    try {
      const result = await this.email.sendEmail({
        tenantId,
        to,
        subject,
        html,
        text: `Accept your invitation: ${acceptUrl} (expires in 7 days)`,
        related: { kind: 'member_invite' },
      });
      if (result.status === 'logged_only') {
        // SendGrid not configured — surface the link for the operator.
        this.logger.warn(`Invite (logged_only) for ${to}: ${acceptUrl}`);
      }
    } catch (err) {
      // Email is best-effort; the invite row already exists and can be re-sent.
      this.logger.error(
        `Failed to send invite email to ${to}: ${(err as Error).message}`,
      );
    }
  }
}
