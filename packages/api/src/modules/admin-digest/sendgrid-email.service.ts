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
      const msg = (err as Error).message;
      this.logger.warn(
        `SendGrid send failed tenant=${params.tenantId} to=${params.to}: ${msg}`,
      );
      await this.db
        .update(emailMessages)
        .set({ status: 'failed', error: msg })
        .where(eq(emailMessages.id, row.id));
      return { id: row.id, sendgridMessageId: null, status: 'failed' };
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
