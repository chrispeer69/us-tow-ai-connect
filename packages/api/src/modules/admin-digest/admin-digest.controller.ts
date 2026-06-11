import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { and, eq, gte, sql } from 'drizzle-orm';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Inject } from '@nestjs/common';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { emailMessages, smsMessages, tenants } from '../../db/schema';
import { FlipNotifierService } from '../flip-engine/flip-notifier.service';
import { DigestSchedulerService } from './digest-scheduler.cron';

const FREQUENCY = z.enum(['daily', 'weekly', 'off']);
const PHONE = z.string().regex(/^\+?[1-9]\d{6,14}$/, 'Must be E.164 format');
const MANUAL_REPORT_SEND_LIMIT_PER_HOUR = 15;

export const DigestSettingsUpdateSchema = z.object({
  digestEmails: z
    .array(z.string().email().max(320))
    .max(20),
  digestFrequency: FREQUENCY,
  managerPhones: z.array(PHONE).max(20).optional(),
  dailySmsEnabled: z.boolean().optional(),
  dailySmsHourLocal: z.number().int().min(0).max(23).optional(),
});

export type DigestSettingsUpdate = z.infer<typeof DigestSettingsUpdateSchema>;

@Controller('v1/admin/digest')
@UseGuards(AdminAuthGuard)
export class AdminDigestController {
  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly scheduler: DigestSchedulerService,
    private readonly flipNotifier: FlipNotifierService,
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
          managerPhones: tenants.managerPhones,
          flipEngineConfig: tenants.flipEngineConfig,
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
      managerPhones: Array.isArray(tenant?.managerPhones) ? tenant.managerPhones : [],
      dailySmsEnabled: ((tenant?.flipEngineConfig as Record<string, unknown> | null) ?? {})
        .send_daily_report !== false,
      dailySmsHourLocal: Number(
        ((tenant?.flipEngineConfig as Record<string, unknown> | null) ?? {})
          .daily_report_hour_local ?? 21,
      ),
    };
  }

  /** PUT /v1/admin/digest — update recipients + frequency. */
  @Put()
  async update(
    @Req() req: AdminRequest,
    @Body(new ZodValidationPipe(DigestSettingsUpdateSchema)) body: DigestSettingsUpdate,
  ) {
    const normalized = Array.from(new Set(body.digestEmails.map((e) => e.trim().toLowerCase())));
    const normalizedPhones = body.managerPhones
      ? Array.from(new Set(body.managerPhones.map((phone) => phone.trim()).filter(Boolean)))
      : undefined;
    const tenant = (
      await this.db
        .select({ flipEngineConfig: tenants.flipEngineConfig })
        .from(tenants)
        .where(eq(tenants.id, req.tenantId))
        .limit(1)
    )[0];
    const flipEngineConfig = {
      ...(((tenant?.flipEngineConfig as Record<string, unknown> | null) ?? {})),
      ...(body.dailySmsEnabled === undefined ? {} : { send_daily_report: body.dailySmsEnabled }),
      ...(body.dailySmsHourLocal === undefined
        ? {}
        : { daily_report_hour_local: body.dailySmsHourLocal }),
    };
    await this.db
      .update(tenants)
      .set({
        digestEmails: normalized as unknown as never,
        digestFrequency: body.digestFrequency,
        ...(normalizedPhones ? { managerPhones: normalizedPhones as unknown as never } : {}),
        flipEngineConfig: flipEngineConfig as never,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, req.tenantId));
    return {
      digestEmails: normalized,
      digestFrequency: body.digestFrequency,
      managerPhones: normalizedPhones,
      dailySmsEnabled: flipEngineConfig.send_daily_report !== false,
      dailySmsHourLocal: Number(flipEngineConfig.daily_report_hour_local ?? 21),
    };
  }

  /** POST /v1/admin/digest/test — send the next digest/report immediately. */
  @Post('test')
  async test(
    @Req() req: AdminRequest,
    @Query('range') range: 'daily' | 'weekly' = 'daily',
    @Query('channel') channel: 'email' | 'sms' | 'all' = 'email',
  ) {
    const normalizedRange = range === 'weekly' ? 'weekly' : 'daily';
    await this.enforceManualReportLimit(req.tenantId, channel);
    const result = {
      range: normalizedRange,
      email: { sent: 0, recipients: [] as string[] },
      sms: { sent: 0, recipients: [] as string[] },
    };
    if (channel === 'email' || channel === 'all') {
      result.email = await this.scheduler.sendForTenant(req.tenantId, normalizedRange);
    }
    if (channel === 'sms' || channel === 'all') {
      result.sms = await this.flipNotifier.sendDailyReportNow(req.tenantId);
    }
    return result;
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

  private async enforceManualReportLimit(
    tenantId: string,
    channel: 'email' | 'sms' | 'all',
  ): Promise<void> {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const tenant = (
      await this.db
        .select({
          digestEmails: tenants.digestEmails,
          managerPhones: tenants.managerPhones,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
    )[0];

    const pendingEmailCount =
      channel === 'email' || channel === 'all'
        ? readEmailRecipients(tenant?.digestEmails).length
        : 0;
    const pendingSmsCount =
      channel === 'sms' || channel === 'all'
        ? readPhoneRecipients(tenant?.managerPhones).length
        : 0;

    const emailCount = (
      await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(emailMessages)
        .where(
          and(
            eq(emailMessages.tenantId, tenantId),
            eq(emailMessages.relatedKind, 'admin_digest'),
            gte(emailMessages.createdAt, since),
          ),
        )
    )[0]?.count ?? 0;

    const smsCount = (
      await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(smsMessages)
        .where(
          and(
            eq(smsMessages.tenantId, tenantId),
            eq(smsMessages.direction, 'outbound'),
            gte(smsMessages.createdAt, since),
            sql`${smsMessages.body} like 'FLIP DAILY%'`,
          ),
        )
    )[0]?.count ?? 0;

    if (
      emailCount + smsCount + pendingEmailCount + pendingSmsCount >
      MANUAL_REPORT_SEND_LIMIT_PER_HOUR
    ) {
      throw new HttpException(
        {
          status: 'error',
          code: 'REPORT_SEND_LIMIT_REACHED',
          message: 'Reached limit. Try after a few hours.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

function readEmailRecipients(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && /.@./.test(v));
}

function readPhoneRecipients(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}
