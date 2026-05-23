import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Inject } from '@nestjs/common';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { tenants } from '../../db/schema';
import { DigestSchedulerService } from './digest-scheduler.cron';

const FREQUENCY = z.enum(['daily', 'weekly', 'off']);

export const DigestSettingsUpdateSchema = z.object({
  digestEmails: z
    .array(z.string().email().max(320))
    .max(20),
  digestFrequency: FREQUENCY,
});

export type DigestSettingsUpdate = z.infer<typeof DigestSettingsUpdateSchema>;

@Controller('v1/admin/digest')
@UseGuards(AdminAuthGuard)
export class AdminDigestController {
  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly scheduler: DigestSchedulerService,
  ) {}

  /** GET /v1/admin/digest — recipients + frequency + last-send metadata. */
  @Get()
  async get(@Req() req: AdminRequest) {
    const tenant = (
      await this.db
        .select({
          id: tenants.id,
          digestEmails: tenants.digestEmails,
          digestFrequency: tenants.digestFrequency,
          companyName: tenants.companyName,
        })
        .from(tenants)
        .where(eq(tenants.id, req.tenantId))
        .limit(1)
    )[0];
    return {
      tenantId: req.tenantId,
      companyName: tenant?.companyName ?? null,
      digestEmails: Array.isArray(tenant?.digestEmails) ? tenant.digestEmails : [],
      digestFrequency: tenant?.digestFrequency ?? 'daily',
    };
  }

  /** PUT /v1/admin/digest — update recipients + frequency. */
  @Put()
  async update(
    @Req() req: AdminRequest,
    @Body(new ZodValidationPipe(DigestSettingsUpdateSchema)) body: DigestSettingsUpdate,
  ) {
    const normalized = Array.from(new Set(body.digestEmails.map((e) => e.trim().toLowerCase())));
    await this.db
      .update(tenants)
      .set({
        digestEmails: normalized as unknown as never,
        digestFrequency: body.digestFrequency,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, req.tenantId));
    return { digestEmails: normalized, digestFrequency: body.digestFrequency };
  }

  /** POST /v1/admin/digest/test — send the next digest immediately. */
  @Post('test')
  async test(
    @Req() req: AdminRequest,
    @Query('range') range: 'daily' | 'weekly' = 'daily',
  ) {
    const result = await this.scheduler.sendForTenant(
      req.tenantId,
      range === 'weekly' ? 'weekly' : 'daily',
    );
    return { range, ...result };
  }

  /** GET /v1/admin/digest/preview — render HTML without sending. */
  @Get('preview')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async preview(
    @Req() req: AdminRequest,
    @Query('range') range: 'daily' | 'weekly' = 'daily',
  ) {
    const html = await this.scheduler.renderForTenant(
      req.tenantId,
      range === 'weekly' ? 'weekly' : 'daily',
    );
    return html ?? '<p>Tenant not found</p>';
  }
}
