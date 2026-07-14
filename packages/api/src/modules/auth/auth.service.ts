import { Injectable, UnauthorizedException, BadRequestException, Inject, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { eq, or, desc } from 'drizzle-orm';
import { users, tenantMembers, tenants, passwordResetOtps, UserRow } from '../../db/schema';
import { DB_CLIENT, DbClient } from '../../db/db.module';
import { AuthEmailService } from './auth-email.service';

export interface JwtPayload {
  userId: string;
  email: string;
  tenantId?: string;
  role?: string;
  platformRole?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly emailService: AuthEmailService,
  ) {}

  async validateUser(email: string, pass: string): Promise<UserRow | null> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (user && user.passwordHash && (await bcrypt.compare(pass, user.passwordHash))) {
      return user;
    }
    return null;
  }

  async login(user: UserRow) {
    // Find their default tenant member profile
    const [member] = await this.db
      .select()
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, user.id))
      .limit(1);

    const platformRole = isConfiguredSuperAdminEmail(user.email)
      ? 'super_admin'
      : user.platformRole;

    // SECURITY: If the user has no tenant membership AND is not a super admin,
    // they should not be granted access. This prevents random Google sign-ins
    // from falling through to the DEFAULT_ADMIN_TENANT_ID env var.
    if (!member && platformRole !== 'super_admin') {
      this.logger.warn(`Login rejected: user ${user.email} has no tenant membership`);
      throw new UnauthorizedException(
        'Your account is not associated with any company. Please ask your company admin to invite you first.',
      );
    }

    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      tenantId: member?.tenantId,
      role: member?.role,
      platformRole,
    };

    try { return { access_token: this.jwtService.sign(payload) }; } catch (e: any) { throw new Error("JWT Crash: " + e.message); }
  }

  async register(data: any) {
    // --- Input validation ---
    const email = (typeof data.email === 'string' ? data.email : '').trim().toLowerCase();
    const password = typeof data.password === 'string' ? data.password : '';
    const firstName = (typeof data.firstName === 'string' ? data.firstName : '').trim().slice(0, 100);
    const lastName = (typeof data.lastName === 'string' ? data.lastName : '').trim().slice(0, 100);
    const companyName = (typeof data.companyName === 'string' ? data.companyName : '').trim().slice(0, 200);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('A valid email address is required');
    }
    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    if (!firstName) {
      throw new BadRequestException('First name is required');
    }

    // Check if user exists
    const existing = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      throw new BadRequestException('User already exists');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Transaction for user + tenant + membership
    let newUser;
    await this.db.transaction(async (tx: any) => {
      const [u] = await tx.insert(users).values({
        email,
        passwordHash,
        name: `${firstName} ${lastName}`.trim(),
      }).returning();
      
      newUser = u;

      // DATA MIGRATION STRATEGY: Link to existing tenants if email matches
      const existingMembers = await tx.select().from(tenantMembers).where(eq(tenantMembers.email, email));
      const existingTenants = await tx.select().from(tenants).where(eq(tenants.ownerEmail, email));
      
      if (existingMembers.length > 0 || existingTenants.length > 0) {
        await tx.update(tenantMembers).set({ userId: u.id }).where(eq(tenantMembers.email, email));
        await tx.update(tenants).set({ ownerId: u.id }).where(eq(tenants.ownerEmail, email));
      } else if (companyName) {
        // Generate a proper API key (matches the pattern in tenant-onboarding.service.ts)
        const apiKeyPlaintext = `usk_${randomBytes(24).toString('hex')}`;
        const apiKeyHash = await bcrypt.hash(apiKeyPlaintext, 10);
        const apiKeyPrefix = apiKeyPlaintext.slice(0, 12);

        const [tenant] = await tx.insert(tenants).values({
          companyName,
          ownerId: u.id,
          ownerEmail: email,
          targetSoftwareType: 'NONE',
          apiKeyHash,
          apiKeyPrefix,
        }).returning();

        await tx.insert(tenantMembers).values({
          tenantId: tenant.id,
          userId: u.id,
          email: email,
          name: `${firstName} ${lastName}`.trim(),
          role: 'OWNER',
          status: 'ACCEPTED',
        });
      }
    }).catch(err => {
      this.logger.error(`Signup transaction failed for ${email}: ${err.message}`, err.stack);
      throw new BadRequestException('Account creation failed. Please try again.');
    });

    if (!newUser) throw new Error('User creation failed');
    return this.login(newUser);
  }

  async validateOAuthLogin(profile: any): Promise<UserRow> {
    const email = profile.emails?.[0]?.value?.trim().toLowerCase();
    if (!email) throw new BadRequestException('Google account lacks email');

    let [user] = await this.db.select().from(users).where(or(eq(users.googleId, profile.id), eq(users.email, email))).limit(1);

    if (!user) {
      // SECURITY: Before creating a user, check if they were invited (have a
      // tenantMembers row) or own a tenant. If neither, they are a stranger
      // and should NOT be auto-provisioned into the system.
      const [existingMember] = await this.db.select().from(tenantMembers).where(eq(tenantMembers.email, email)).limit(1);
      const [existingTenant] = await this.db.select().from(tenants).where(eq(tenants.ownerEmail, email)).limit(1);
      const isSuperAdmin = isConfiguredSuperAdminEmail(email);

      if (!existingMember && !existingTenant && !isSuperAdmin) {
        this.logger.warn(`Google OAuth rejected for unknown email: ${email}`);
        throw new UnauthorizedException(
          'No account found for this email. Please ask your company admin to invite you, or sign up with a company name first.',
        );
      }

      // Create user from Google Profile (they are a known/invited user)
      const [u] = await this.db.insert(users).values({
        email,
        googleId: profile.id,
        name: `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim(),
      }).returning();
      user = u;
      
      // Link to existing tenants
      await this.db.update(tenantMembers).set({ userId: u.id }).where(eq(tenantMembers.email, email));
      await this.db.update(tenants).set({ ownerId: u.id }).where(eq(tenants.ownerEmail, email));
    } else {
      // If user exists but google ID wasn't linked, link it
      if (!user.googleId) {
        await this.db.update(users).set({ googleId: profile.id }).where(eq(users.id, user.id));
      }
      
      // Safety net: ensure any existing unlinked tenant memberships are linked
      await this.db.update(tenantMembers).set({ userId: user.id }).where(eq(tenantMembers.email, email));
      await this.db.update(tenants).set({ ownerId: user.id }).where(eq(tenants.ownerEmail, email));
    }

    return user;
  }

  async sendPasswordResetOtp(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const [user] = await this.db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    
    // We do not throw if the user doesn't exist, to prevent email enumeration.
    if (!user) {
      this.logger.log(`Password reset requested for unknown email: ${normalizedEmail}`);
      return;
    }

    // Generate a 6-digit numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins from now

    await this.db.insert(passwordResetOtps).values({
      userId: user.id,
      otp,
      expiresAt,
    });

    await this.emailService.sendPasswordResetOtp(normalizedEmail, otp);
  }

  async resetPasswordWithOtp(email: string, otp: string, newPassword: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const [user] = await this.db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);

    if (!user) {
      throw new BadRequestException('Invalid email or OTP code.');
    }

    // Find the most recent unexpired OTP for this user
    const [otpRecord] = await this.db
      .select()
      .from(passwordResetOtps)
      .where(eq(passwordResetOtps.userId, user.id))
      .orderBy(desc(passwordResetOtps.createdAt))
      .limit(1);

    if (!otpRecord) {
      throw new BadRequestException('No reset code found. Please request a new one.');
    }

    if (otpRecord.otp !== otp.trim()) {
      throw new BadRequestException('Invalid OTP code.');
    }

    if (new Date() > otpRecord.expiresAt) {
      throw new BadRequestException('OTP code has expired. Please request a new one.');
    }

    // Hash the new password and update
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.db.update(users).set({ passwordHash }).where(eq(users.id, user.id));

    // Delete all OTPs for this user so they can't be reused
    await this.db.delete(passwordResetOtps).where(eq(passwordResetOtps.userId, user.id));
  }
}

function isConfiguredSuperAdminEmail(email: string): boolean {
  return (process.env.SUPER_ADMIN_EMAILS || process.env.SUPER_ADMIN_DEV_EMAIL || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.trim().toLowerCase());
}
