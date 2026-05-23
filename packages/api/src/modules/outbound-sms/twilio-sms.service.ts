import { Inject, Injectable, Logger } from '@nestjs/common';
import twilio, { type Twilio } from 'twilio';
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { smsMessages, type SmsMessageRow } from '../../db/schema';

export interface SendSmsParams {
  to: string;
  body: string;
  tenantId: string;
  related?: {
    trackingLinkId?: string | null;
    flipRequestId?: string | null;
  };
}

export interface SendSmsResult {
  id: string;
  twilioSid: string | null;
  status: string;
  deduped: boolean;
}

const DEDUPE_WINDOW_MS = 60_000;

/**
 * Shared SMS sender for tracking links, flip-accept manager pings, and any
 * other outbound SMS we add later. Three responsibilities:
 *   1. Insert an sms_messages audit row before/after Twilio call.
 *   2. Idempotency: dedupe identical (to, body) sends within 60 s.
 *   3. Log gracefully when Twilio isn't configured (local dev / tests).
 *
 * The Twilio status-callback webhook updates the row's `status` /
 * `delivered_at` once the carrier confirms delivery.
 */
@Injectable()
export class TwilioSmsService {
  private readonly logger = new Logger(TwilioSmsService.name);
  private readonly client: Twilio | null;
  private readonly fromNumber: string;
  private readonly baseUrl: string;

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER ?? '';
    this.baseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001';

    if (!sid || sid.startsWith('REPLACE_ME') || !token || token.startsWith('REPLACE_ME')) {
      this.logger.warn(
        'TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not configured — outbound SMS will be logged only',
      );
      this.client = null;
      return;
    }
    this.client = twilio(sid, token);
  }

  isConfigured(): boolean {
    return this.client !== null && !!this.fromNumber;
  }

  async sendSms(params: SendSmsParams): Promise<SendSmsResult> {
    const { to, body, tenantId, related } = params;

    const dedupe = await this.findDedupeRow(tenantId, to, body);
    if (dedupe) {
      this.logger.log(
        `Dedupe hit for SMS to=${to} tenant=${tenantId} (existing sms id=${dedupe.id})`,
      );
      return {
        id: dedupe.id,
        twilioSid: dedupe.twilioSid,
        status: dedupe.status,
        deduped: true,
      };
    }

    if (!this.client || !this.fromNumber) {
      this.logger.warn(
        `[twilio-fallback] SMS not sent (Twilio unconfigured) to=${to} body="${body.slice(0, 80)}"`,
      );
      const inserted = await this.db
        .insert(smsMessages)
        .values({
          tenantId,
          direction: 'outbound',
          toPhone: to,
          fromPhone: this.fromNumber || 'unconfigured',
          body,
          status: 'log_only',
          relatedTrackingLinkId: related?.trackingLinkId ?? null,
          relatedFlipRequestId: related?.flipRequestId ?? null,
        })
        .returning();
      const row = inserted[0];
      return { id: row.id, twilioSid: null, status: row.status, deduped: false };
    }

    const inserted = await this.db
      .insert(smsMessages)
      .values({
        tenantId,
        direction: 'outbound',
        toPhone: to,
        fromPhone: this.fromNumber,
        body,
        status: 'queued',
        relatedTrackingLinkId: related?.trackingLinkId ?? null,
        relatedFlipRequestId: related?.flipRequestId ?? null,
      })
      .returning();
    const row = inserted[0];

    try {
      const message = await this.client.messages.create({
        to,
        from: this.fromNumber,
        body,
        statusCallback: `${this.baseUrl}/webhooks/twilio/sms-status-callback`,
      });
      await this.db
        .update(smsMessages)
        .set({ twilioSid: message.sid, status: message.status ?? 'sent' })
        .where(eq(smsMessages.id, row.id));
      return {
        id: row.id,
        twilioSid: message.sid,
        status: message.status ?? 'sent',
        deduped: false,
      };
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.warn(`Twilio SMS send failed to=${to}: ${msg}`);
      await this.db
        .update(smsMessages)
        .set({ status: 'failed', error: msg })
        .where(eq(smsMessages.id, row.id));
      return { id: row.id, twilioSid: null, status: 'failed', deduped: false };
    }
  }

  async sendBulk(
    recipients: Array<{ to: string; related?: SendSmsParams['related'] }>,
    body: string,
    tenantId: string,
  ): Promise<SendSmsResult[]> {
    const results: SendSmsResult[] = [];
    for (const r of recipients) {
      results.push(await this.sendSms({ to: r.to, body, tenantId, related: r.related }));
    }
    return results;
  }

  async recordInbound(args: {
    tenantId: string;
    fromPhone: string;
    toPhone: string;
    body: string;
    twilioSid?: string | null;
    relatedFlipRequestId?: string | null;
    relatedTrackingLinkId?: string | null;
  }): Promise<SmsMessageRow> {
    const inserted = await this.db
      .insert(smsMessages)
      .values({
        tenantId: args.tenantId,
        direction: 'inbound',
        toPhone: args.toPhone,
        fromPhone: args.fromPhone,
        body: args.body,
        twilioSid: args.twilioSid ?? null,
        status: 'received',
        relatedFlipRequestId: args.relatedFlipRequestId ?? null,
        relatedTrackingLinkId: args.relatedTrackingLinkId ?? null,
      })
      .returning();
    return inserted[0];
  }

  async updateStatusBySid(args: {
    twilioSid: string;
    status: string;
    error?: string | null;
    deliveredAt?: Date | null;
  }): Promise<void> {
    if (!args.twilioSid) return;
    await this.db
      .update(smsMessages)
      .set({
        status: args.status,
        error: args.error ?? null,
        deliveredAt: args.deliveredAt ?? (args.status === 'delivered' ? new Date() : null),
      })
      .where(eq(smsMessages.twilioSid, args.twilioSid));
  }

  /** Public so tests can poke the dedupe window directly. */
  async findDedupeRow(
    tenantId: string,
    toPhone: string,
    body: string,
  ): Promise<SmsMessageRow | null> {
    const cutoff = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const rows = await this.db
      .select()
      .from(smsMessages)
      .where(
        and(
          eq(smsMessages.tenantId, tenantId),
          eq(smsMessages.direction, 'outbound'),
          eq(smsMessages.toPhone, toPhone),
          eq(smsMessages.body, body),
          gte(smsMessages.createdAt, cutoff),
          isNotNull(smsMessages.body),
        ),
      )
      .orderBy(desc(smsMessages.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }
}
