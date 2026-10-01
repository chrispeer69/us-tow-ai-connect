import { Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { tenants } from '../../db/schema';
import { GhlAccountSyncService } from './ghl-account-sync.service';

@Controller('v1/admin/ghl-account-sync')
@UseGuards(AdminAuthGuard)
export class GhlAccountSyncController {
  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly sync: GhlAccountSyncService,
  ) {}

  @Get('status')
  status() {
    return this.sync.getStatus();
  }

  @Post('resync')
  async resync(@Req() req: AdminRequest) {
    const tenant = (
      await this.db
        .select({
          companyName: tenants.companyName,
          ownerEmail: tenants.ownerEmail,
        })
        .from(tenants)
        .where(eq(tenants.id, req.tenantId))
        .limit(1)
    )[0];

    if (!tenant) {
      return { success: false, skipped: true, error: 'Tenant not found' };
    }

    return this.sync.syncAccountWithResult({
      email: tenant.ownerEmail,
      name: tenant.companyName,
      companyName: tenant.companyName,
      source: 'US Tow AI-Connect / Manual Resync',
    });
  }
}
