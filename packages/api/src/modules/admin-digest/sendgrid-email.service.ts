import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { emailMessages, type EmailMessageRow } from '../../db/schema';

interface SendGridClient {
  setApiKey: (k: string) => void;
  send: (
    msg: {
      to: string;
      from: string;
      subject: string;
      html?: string;
      text?: string;
    },
  ) => Promise<Array<{ headers?: Record<string, string> }>>;
}

export interface SendEmailParams {
  tenantId: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  related?: {
    kind?: string;
    id?: string | null;
  };
}

export interface SendEmailResult {
  id: string;
  sendgridMessageId: string | null;
  status: EmailMessageRow['status'];
}

/**
 * SendGrid analogue of TwilioSmsService. Same shape:
 *   1. Pre-write `email_messages` row with status=queued.
 *   2. Call provider; on success update sendgrid_message_id + status=sent.
 *   3. On absence of SENDGRID_API_KEY, write status=logged_only and log to stdout.
 *
 * Deliveries / bounces flow back later via SendGrid event webhook (not yet
 * wired — placeholder row.status='sent' is the terminal state today).
 */
@Injectable()
export class SendGridEmailService {
  private readonly logger = new Logger(SendGridEmailService.name);
  private sendgrid: SendGridClient | null = null;
  private readonly fromAddress: string;

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {
    this.fromAddress =
      process.env.DIGEST_EMAIL_FROM ??
      process.env.ALERT_EMAIL_FROM ??
      'alerts@ustowdispatch.com';
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey || apiKey.startsWith('REPLACE_ME')) {
      this.logger.warn(
        'SENDGRID_API_KEY not configured — digest/alert emails will be logged_only',
      );
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const sg = require('@sendgrid/mail') as { default: SendGridClient } | SendGridClient;
      this.sendgrid = 'default' in sg ? (sg as { default: SendGridClient }).default : (sg as SendGridClient);
      this.sendgrid.setApiKey(apiKey);
      this.logger.log('SendGrid initialized for admin digest emails');
    } catch (err) {
      this.logger.warn(`@sendgrid/mail unavailable: ${(err as Error).message}`);
      this.sendgrid = null;
    }
  }

  isConfigured(): boolean {
    return this.sendgrid !== null;
  }

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const inserted = await this.db
      .insert(emailMessages)
      .values({
        tenantId: params.tenantId,
        toAddress: params.to,
        fromAddress: this.fromAddress,
        subject: params.subject,
        htmlBody: params.html,
        textBody: params.text ?? null,
        status: this.sendgrid ? 'queued' : 'logged_only',
        relatedKind: params.related?.kind ?? null,
        relatedId: params.related?.id ?? null,
      })
      .returning();
    const row = inserted[0];

    if (!this.sendgrid) {
      const viaSmtp = await this.trySmtp(params, row.id);
      if (viaSmtp) return viaSmtp;
      this.logger.log(
        `[sendgrid-fallback] tenant=${params.tenantId} to=${params.to} subject="${params.subject}"`,
      );
      return { id: row.id, sendgridMessageId: null, status: 'logged_only' };
    }

    try {
      const [response] = await this.sendgrid.send({
        to: params.to,
        from: this.fromAddress,
        subject: params.subject,
        html: params.html,
        text: params.text ?? stripTags(params.html),
      });
      const sendgridId =
        response?.headers?.['x-message-id'] ?? response?.headers?.['X-Message-Id'] ?? null;
      await this.db
        .update(emailMessages)
        .set({ status: 'sent', sendgridMessageId: sendgridId })
        .where(eq(emailMessages.id, row.id));
      return { id: row.id, sendgridMessageId: sendgridId, status: 'sent' };
    } catch (err) {
      const msg = describeSendGridError(err);
      this.logger.warn(
        `SendGrid send failed tenant=${params.tenantId} to=${params.to}: ${msg}`,
      );

      // SendGrid is not always recoverable at the account level — a lapsed
      // trial or an account under review rejects every send regardless of
      // payload. When SMTP is configured, use it rather than dropping the mail.
      const viaSmtp = await this.trySmtp(params, row.id);
      if (viaSmtp) return viaSmtp;

      await this.db
        .update(emailMessages)
        .set({ status: 'failed', error: msg })
        .where(eq(emailMessages.id, row.id));
      return { id: row.id, sendgridMessageId: null, status: 'failed' };
    }
  }

  /**
   * SMTP fallback. Any provider works — Gmail with an app password, Resend,
   * Postmark, Mailgun, SES — so a dead SendGrid account never blocks delivery.
   *
   *   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS
   *   SMTP_SECURE=true for implicit TLS on 465
   *
   * Returns null when SMTP is unconfigured so the caller can fall through to
   * its existing behaviour.
   */
  private async trySmtp(
    params: SendEmailParams,
    rowId: string,
  ): Promise<SendEmailResult | null> {
    const host = process.env.SMTP_HOST?.trim();
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS?.trim();
    if (!host || !user || !pass) return null;

    try {
      // Required lazily so a missing optional dep can never break boot.
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const nodemailer = require('nodemailer');
      const port = Number(process.env.SMTP_PORT ?? 587);
      const transport = nodemailer.createTransport({
        host,
        port,
        secure: process.env.SMTP_SECURE === 'true' || port === 465,
        auth: { user, pass },
      });

      const info = await transport.sendMail({
        from: process.env.SMTP_FROM?.trim() || this.fromAddress,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text ?? stripTags(params.html),
      });

      await this.db
        .update(emailMessages)
        .set({ status: 'sent', sendgridMessageId: info?.messageId ?? null })
        .where(eq(emailMessages.id, rowId));

      this.logger.log(
        `[smtp] delivered tenant=${params.tenantId} to=${params.to} via ${host}`,
      );
      return { id: rowId, sendgridMessageId: info?.messageId ?? null, status: 'sent' };
    } catch (err) {
      this.logger.warn(`[smtp] send failed to=${params.to}: ${(err as Error).message}`);
      return null;
    }
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function describeSendGridError(err: unknown): string {
  const fallback = err instanceof Error ? err.message : String(err);
  const response = (err as { response?: { statusCode?: number; body?: unknown } })?.response;
  if (!response?.body) return fallback;

  const body = response.body as {
    errors?: Array<{ message?: string; field?: string; help?: string }>;
  };
  const details = Array.isArray(body.errors)
    ? body.errors
        .map((e) =>
          [e.message, e.field ? `field=${e.field}` : '', e.help].filter(Boolean).join(' '),
        )
        .filter(Boolean)
        .join('; ')
    : '';
  const status = response.statusCode ? `HTTP ${response.statusCode}` : '';
  return [fallback, status, details].filter(Boolean).join(' — ');
}
