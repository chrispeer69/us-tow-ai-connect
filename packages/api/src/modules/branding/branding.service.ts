import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { tenants } from '../../db/schema';
import { BrandingSchema, type BrandingBody } from '@ustow/shared';
import { recordAudit } from '../tenant-onboarding/audit-log.helper';

const DEFAULTS: BrandingBody = {
  companyDisplayName: '',
  logoUrl: '',
  faviconUrl: '',
  primaryColor: '#3b82f6',
  secondaryColor: '#1e293b',
  accentColor: '#facc15',
  fontFamily: 'Inter',
  emailSignatureHtml: '',
  smsSignature: '',
  supportPhone: '',
  supportEmail: '',
  customDomain: null,
  hidePoweredBy: false,
};

@Injectable()
export class BrandingService {
  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  async get(tenantId: string): Promise<BrandingBody> {
    const row = (
      await this.db
        .select({ id: tenants.id, branding: tenants.branding, companyName: tenants.companyName })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
    )[0];
    if (!row) {
      throw new NotFoundException({ status: 'error', code: 'TENANT_NOT_FOUND', message: 'Tenant not found' });
    }
    const stored = (row.branding as Partial<BrandingBody>) ?? {};
    const merged: BrandingBody = {
      ...DEFAULTS,
      ...stored,
      companyDisplayName: stored.companyDisplayName || row.companyName || '',
    };
    return BrandingSchema.parse(merged);
  }

  async put(tenantId: string, body: BrandingBody, actor: string) {
    const current = await this.get(tenantId);
    const next = BrandingSchema.parse({ ...current, ...body });
    await this.db
      .update(tenants)
      .set({ branding: next as never, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));
    await recordAudit(this.db, {
      tenantId,
      actorType: 'tenant_admin',
      actorId: actor,
      action: 'branding.updated',
      resourceType: 'branding',
      resourceId: tenantId,
      beforeState: current as never,
      afterState: next as never,
    });
    return next;
  }

  async patchUrl(
    tenantId: string,
    field: 'logoUrl' | 'faviconUrl',
    url: string,
  ): Promise<BrandingBody> {
    const current = await this.get(tenantId);
    const next: BrandingBody = { ...current, [field]: url };
    await this.db
      .update(tenants)
      .set({ branding: next as never, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));
    return next;
  }

  /**
   * Lightweight resolver for the BrandingProvider on the public driver +
   * tracking pages. Returns the branding blob without throwing when the
   * tenant is missing — falls back to the global defaults so a bad
   * tenant id doesn't crash the renderer.
   */
  async getSafe(tenantId: string): Promise<BrandingBody> {
    try {
      return await this.get(tenantId);
    } catch {
      return DEFAULTS;
    }
  }
}
