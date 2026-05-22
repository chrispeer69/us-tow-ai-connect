import {
  Body,
  Controller,
  Header,
  HttpCode,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { DB_CLIENT, type DbClient } from '../../../db/db.module';
import { outboundCallLogs } from '../../../db/schema';
import { NotificationService } from '../../notifications/notification.service';
import { TwilioOutboundService } from '../twilio-outbound.service';

const FLIP_ACCEPT_TWIML =
  "<Response><Say voice=\"Polly.Joanna\">Wonderful! I've updated your destination. Your driver has been notified. Have a great day!</Say></Response>";
const FLIP_DECLINE_TWIML =
  '<Response><Say voice="Polly.Joanna">No problem at all. Your driver is headed to your original destination.</Say></Response>';
const CONVINI_ACCEPT_TWIML =
  "<Response><Say voice=\"Polly.Joanna\">Done! You'll receive a text with the download link in just a moment. Have a great day!</Say></Response>";
const CONVINI_DECLINE_TWIML =
  '<Response><Say voice="Polly.Joanna">No problem. Your driver is on the way. Have a great day!</Say></Response>';

interface TwilioFormBody {
  Digits?: string;
  CallSid?: string;
  CallStatus?: string;
  CallDuration?: string;
  RecordingUrl?: string;
}

@Controller('webhooks/twilio')
export class TwilioWebhookController {
  private readonly logger = new Logger(TwilioWebhookController.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly notifications: NotificationService,
    private readonly twilio: TwilioOutboundService,
  ) {}

  @Post('flip-response')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  async handleFlipResponse(
    @Body() body: TwilioFormBody,
    @Query('tenantId') tenantId: string,
    @Query('phone') phone: string,
  ): Promise<string> {
    const accepted = body?.Digits === '1';

    if (accepted) {
      this.logger.log(`FLIP ACCEPTED tenant=${tenantId} phone=${phone}`);
      await this.markFlipOutcome(tenantId, phone, 'SUCCESS');
      await this.notifications
        .send(
          process.env.OPS_ALERT_EMAIL ?? 'alerts@ustowdispatch.com',
          `Flip accepted for tenant ${tenantId}`,
          `Customer ${phone} accepted the redirect offer. Tenant: ${tenantId}.`,
        )
        .catch((err) =>
          this.logger.warn(`Flip notification email failed: ${(err as Error).message}`),
        );
      return FLIP_ACCEPT_TWIML;
    }

    this.logger.log(`FLIP DECLINED tenant=${tenantId} phone=${phone}`);
    await this.markFlipOutcome(tenantId, phone, 'DECLINED');
    return FLIP_DECLINE_TWIML;
  }

  @Post('convini-response')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  async handleConviniResponse(
    @Body() body: TwilioFormBody,
    @Query('tenantId') tenantId: string,
    @Query('phone') phone: string,
  ): Promise<string> {
    const accepted = body?.Digits === '1';

    if (accepted) {
      this.logger.log(`CONVINI link requested by ${phone} (tenant=${tenantId})`);

      try {
        await this.twilio.sendConviniSms(phone);
      } catch (err) {
        this.logger.warn(`Convini SMS failed for ${phone}: ${(err as Error).message}`);
      }

      await this.markConviniSent(tenantId, phone);
      return CONVINI_ACCEPT_TWIML;
    }

    return CONVINI_DECLINE_TWIML;
  }

  @Post('call-status')
  @HttpCode(200)
  async handleCallStatus(@Body() body: TwilioFormBody) {
    this.logger.log(
      `Twilio call status: sid=${body?.CallSid} status=${body?.CallStatus} duration=${body?.CallDuration}s`,
    );

    if (process.env.DATABASE_URL && body?.CallSid) {
      try {
        const durationSeconds = body.CallDuration ? Number(body.CallDuration) : null;
        await this.db
          .update(outboundCallLogs)
          .set({
            callDurationSeconds: durationSeconds,
            callRecordingUrl: body.RecordingUrl ?? `sid:${body.CallSid}`,
          })
          .where(eq(outboundCallLogs.callRecordingUrl, `pending:${body.CallSid}`));
      } catch (err) {
        this.logger.warn(`Could not update call status row: ${(err as Error).message}`);
      }
    }

    return { received: true };
  }

  private async markFlipOutcome(
    tenantId: string,
    phone: string,
    outcome: 'SUCCESS' | 'DECLINED',
  ): Promise<void> {
    if (!process.env.DATABASE_URL || !tenantId || !phone) return;
    try {
      const rows = await this.db
        .select({ id: outboundCallLogs.id })
        .from(outboundCallLogs)
        .where(
          and(
            eq(outboundCallLogs.tenantId, tenantId),
            eq(outboundCallLogs.customerPhone, phone),
          ),
        )
        .orderBy(desc(outboundCallLogs.callTime))
        .limit(1);

      const row = rows[0];
      if (!row) return;

      await this.db
        .update(outboundCallLogs)
        .set({ flipOutcome: outcome, managementNotified: outcome === 'SUCCESS' })
        .where(eq(outboundCallLogs.id, row.id));
    } catch (err) {
      this.logger.warn(`Could not record flip outcome: ${(err as Error).message}`);
    }
  }

  private async markConviniSent(tenantId: string, phone: string): Promise<void> {
    if (!process.env.DATABASE_URL || !tenantId || !phone) return;
    try {
      const rows = await this.db
        .select({ id: outboundCallLogs.id })
        .from(outboundCallLogs)
        .where(
          and(
            eq(outboundCallLogs.tenantId, tenantId),
            eq(outboundCallLogs.customerPhone, phone),
          ),
        )
        .orderBy(desc(outboundCallLogs.callTime))
        .limit(1);

      const row = rows[0];
      if (!row) return;

      await this.db
        .update(outboundCallLogs)
        .set({ conviniLinkSent: true })
        .where(eq(outboundCallLogs.id, row.id));
    } catch (err) {
      this.logger.warn(`Could not record Convini sent flag: ${(err as Error).message}`);
    }
  }
}
