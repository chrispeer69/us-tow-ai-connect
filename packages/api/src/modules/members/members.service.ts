import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { and, desc, eq, sql, asc } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import * as bcrypt from 'bcryptjs';
import { tenantMembers, tenants, users, rolePermissions } from '../../db/schema';
import { AuthEmailService } from '../auth/auth-email.service';
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
  /** When set, provision the login immediately instead of emailing an invite. */
  password?: string;
}

/** The JWT-derived caller, as attached by AdminAuthGuard. */
export interface ActingUser {
  email?: string | null;
  platformRole?: string | null;
}

export interface UpdateInput {
  name?: string;
  role?: Role;
  status?: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly authEmail: AuthEmailService,
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
    // Direct provisioning: the owner typed a password, so skip the invite mail
    // round-trip entirely and land the member in the state acceptInvite() would
    // have produced. This is the flow that works while outbound email/SMS
    // approvals are pending.
    if (input.password) {
      const userId = await this.upsertUserPassword(
        normalizedEmail,
        input.password,
        input.name,
      );
      const now = new Date();
      const member = (
        await this.db
          .insert(tenantMembers)
          .values({
            tenantId,
            userId,
            email: normalizedEmail,
            name: input.name ?? null,
            role: input.role,
            status: 'ACTIVE',
            invitedBy: input.invitedBy ?? null,
            acceptedAt: now,
          })
          .returning()
      )[0];
      this.logger.log(
        `member provisioned with a password: ${normalizedEmail} (${input.role}) tenant=${tenantId} by=${input.invitedBy ?? 'unknown'}`,
      );
      return this.redact(member);
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

  /**
   * Owner-set password for an existing member. Creates the `users` row if the
   * member never accepted their invite, links it, and retires any outstanding
   * invite token so the old link can't be replayed.
   *
   * A SUSPENDED member stays suspended — resetting a password is not a way to
   * quietly re-enable revoked access.
   */
  async setPassword(
    tenantId: string,
    memberId: string,
    password: string,
    actorEmail?: string | null,
  ) {
    const member = await this.requireMember(tenantId, memberId);
    const email = member.email.trim().toLowerCase();

    const userId = await this.upsertUserPassword(
      email,
      password,
      member.name ?? undefined,
    );

    const now = new Date();
    const updated = (
      await this.db
        .update(tenantMembers)
        .set({
          userId,
          status: member.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
          acceptedAt: member.acceptedAt ?? now,
          inviteToken: null,
          inviteTokenExpiresAt: null,
        })
        .where(eq(tenantMembers.id, memberId))
        .returning()
    )[0];

    this.logger.log(
      `password set for ${email} tenant=${tenantId} by=${actorEmail ?? 'unknown'}`,
    );
    return this.redact(updated);
  }

  /**
   * Credential management (setting or resetting another person's password) is
   * OWNER-only, enforced here rather than through PermissionGuard so it can
   * never be softened by RBAC_ENFORCE being unset. Fails closed when the
   * caller's identity can't be resolved from the verified JWT.
   */
  async assertCanManageCredentials(tenantId: string, actor: ActingUser | undefined) {
    if (actor?.platformRole === 'super_admin') return;

    const email =
      typeof actor?.email === 'string' ? actor.email.trim().toLowerCase() : '';
    if (!email) {
      throw new ForbiddenException({
        status: 'error',
        code: 'FORBIDDEN',
        message: 'Could not identify the signed-in user',
      });
    }

    const member = await this.findMember(tenantId, email);
    if (!member || member.status !== 'ACTIVE' || member.role !== 'OWNER') {
      throw new ForbiddenException({
        status: 'error',
        code: 'FORBIDDEN',
        message: 'Only an owner can set or reset member passwords',
      });
    }
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

    // The guard caches membership status for a few seconds; drop the entry so
    // turning someone on or off is felt on their very next request instead of
    // at the end of the cache window.
    if (input.status !== undefined) {
      AdminAuthGuard.invalidateStatus(tenantId, target.email);
      this.logger.log(
        `member ${target.email} tenant=${tenantId} status ${target.status} -> ${input.status}`,
      );
    }
    return this.redact(updated);
  }

  async revoke(tenantId: string, memberId: string) {
    const target = await this.requireMember(tenantId, memberId);
    if (target.role === 'OWNER') {
      await this.assertNotLastOwner(tenantId, 'remove');
    }
    await this.db.delete(tenantMembers).where(eq(tenantMembers.id, memberId));
    AdminAuthGuard.invalidateStatus(tenantId, target.email);
    return { status: 'success' as const };
  }

  async acceptInvite(token: string, email?: string, name?: string, password?: string) {
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
    const userEmail = member.email.trim().toLowerCase();
    
    // Create the user record if they don't exist yet
    let userRow = (await this.db.select().from(users).where(eq(users.email, userEmail)).limit(1))[0];
    
    if (!userRow) {
      if (!password) {
        throw new BadRequestException({
          status: 'error',
          code: 'MISSING_PASSWORD',
          message: 'A password is required to create your account',
        });
      }
      
      const passwordHash = await bcrypt.hash(password, 10);
      
      const insertedUser = await this.db.insert(users).values({
        email: userEmail,
        passwordHash,
        name: name || member.name || userEmail.split('@')[0],
      }).returning();
      userRow = insertedUser[0];
    }

    const now = new Date();
    const updated = (
      await this.db
        .update(tenantMembers)
        .set({
          userId: userRow.id,
          status: 'ACTIVE',
          name: name || member.name,
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
  /**
   * Write a bcrypt hash onto the platform identity for `email`, creating it if
   * this person has never had a login. Returns the users.id so the caller can
   * link the membership.
   */
  private async upsertUserPassword(
    email: string,
    password: string,
    name?: string | null,
  ): Promise<string> {
    const normalized = email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, 10);

    const existing = (
      await this.db.select().from(users).where(eq(users.email, normalized)).limit(1)
    )[0];

    if (existing) {
      const updated = (
        await this.db
          .update(users)
          .set({
            passwordHash,
            name: existing.name ?? name ?? null,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existing.id))
          .returning()
      )[0];
      return updated.id;
    }

    const inserted = (
      await this.db
        .insert(users)
        .values({
          email: normalized,
          passwordHash,
          name: name ?? normalized.split('@')[0],
        })
        .returning()
    )[0];
    return inserted.id;
  }

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
    
    try {
      const tenantRows = await this.db
        .select()
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      const companyName = tenantRows[0]?.companyName ?? 'US Tow Dispatch';

      await this.authEmail.sendInviteEmail(to, acceptUrl, companyName);
    } catch (err) {
      // Email is best-effort; the invite row already exists and can be re-sent.
      this.logger.error(
        `Failed to send invite email to ${to} for tenant=${tenantId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
