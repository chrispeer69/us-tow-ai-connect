import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { inboundCallLogs } from '../../db/schema';

/**
 * Job events coming back FROM US Tow Dispatch.
 *
 * One job: close the loop between a phone call and the tow it produced. Emily
 * creates the job through USTD's public API, but the response goes to Retell,
 * not to us — so without this, a transcript and a job number live in two
 * systems with nothing joining them, and "read the call that produced this bad
 * job" is a manual hunt through timestamps.
 *
 * Matching is by phone number and recency rather than by anything USTD sends,
 * because USTD has no idea a phone call was involved. That is a heuristic and
 * it is treated as one: it only ever fills an EMPTY job number on a recent
 * inbound call, so a wrong guess cannot overwrite a right answer.
 */
interface UstdWebhookBody {
  event?: string;
  type?: string;
  data?: {
    id?: string;
    jobNumber?: string;
    job_number?: string;
    status?: string;
    customer?: { phone?: string };
    customerPhone?: string;
  };
}

/** How far back to look for the call that produced a job. */
const MATCH_WINDOW_MINUTES = 30;

@Controller('webhooks/ustd')
export class UstdWebhookController {
  private readonly logger = new Logger(UstdWebhookController.name);

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  @Post('job')
  @HttpCode(200)
  async handle(
    @Req() req: Request,
    @Headers('x-signature') signature: string | undefined,
    @Headers('x-ustd-signature') altSignature: string | undefined,
    @Body() body: UstdWebhookBody,
  ) {
    const secret = process.env.USTD_WEBHOOK_SECRET;
    if (secret) {
      const raw = (req as Request & { rawBody?: Buffer }).rawBody;
      const payload = Buffer.isBuffer(raw) ? raw : Buffer.from(JSON.stringify(body), 'utf8');
      const expected = createHmac('sha256', secret).update(payload).digest('hex');
      const given = (signature ?? altSignature ?? '').replace(/^sha256=/, '').trim();
      const ok =
        given.length === expected.length &&
        timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(expected, 'utf8'));
      if (!ok) throw new UnauthorizedException('bad signature');
    } else {
      // The endpoint only ever fills a blank field on a row that already
      // exists, so an unsigned forgery cannot invent a call or change a real
      // one. Still worth saying out loud rather than discovering later.
      this.logger.warn('USTD_WEBHOOK_SECRET is not set — USTD webhook is UNVERIFIED');
    }

    const event = body.event ?? body.type ?? '';
    if (!event.startsWith('job.')) return { ok: true, ignored: event || 'no event' };

    const jobNumber = body.data?.jobNumber ?? body.data?.job_number ?? body.data?.id;
    const phone = body.data?.customer?.phone ?? body.data?.customerPhone;
    if (!jobNumber || !phone) return { ok: true, ignored: 'no job number or phone' };

    const tenantId = process.env.ROADSIDE_TENANT_ID;
    if (!tenantId) return { ok: true, ignored: 'no tenant configured' };

    // Last 10 digits, so +1614… and 614… match the same person.
    const last10 = phone.replace(/\D/g, '').slice(-10);
    if (last10.length < 10) return { ok: true, ignored: 'unusable phone' };

    const since = new Date(Date.now() - MATCH_WINDOW_MINUTES * 60 * 1000);
    const [candidate] = await this.db
      .select({ id: inboundCallLogs.id })
      .from(inboundCallLogs)
      .where(
        and(
          eq(inboundCallLogs.tenantId, tenantId),
          isNull(inboundCallLogs.ustdJobNumber),
          gte(inboundCallLogs.createdAt, since),
          sql`right(regexp_replace(coalesce(${inboundCallLogs.fromNumber}, ''), '\\D', '', 'g'), 10) = ${last10}`,
        ),
      )
      .orderBy(desc(inboundCallLogs.createdAt))
      .limit(1);

    if (!candidate) {
      this.logger.log(`USTD ${event} ${jobNumber}: no recent inbound call from ${last10}`);
      return { ok: true, matched: false };
    }

    await this.db
      .update(inboundCallLogs)
      .set({ ustdJobNumber: String(jobNumber), updatedAt: new Date() })
      .where(eq(inboundCallLogs.id, candidate.id));

    this.logger.log(`USTD ${event}: linked job ${jobNumber} to inbound call ${candidate.id}`);
    return { ok: true, matched: true };
  }
}
