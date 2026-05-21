import { Injectable, Logger } from '@nestjs/common';

interface SendGridClient {
  setApiKey: (k: string) => void;
  send: (msg: {
    to: string;
    from: string;
    subject: string;
    text: string;
    html?: string;
  }) => Promise<unknown>;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private sendgrid: SendGridClient | null = null;
  private readonly fromAddress: string;

  constructor() {
    this.fromAddress = process.env.ALERT_EMAIL_FROM ?? 'alerts@ustowdispatch.com';
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      this.logger.warn('SENDGRID_API_KEY not set — emails will log to stdout only.');
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const sg = require('@sendgrid/mail') as { default: SendGridClient } | SendGridClient;
      this.sendgrid = 'default' in sg ? sg.default : sg;
      this.sendgrid.setApiKey(apiKey);
      this.logger.log('SendGrid initialized');
    } catch (err) {
      this.logger.warn(`@sendgrid/mail unavailable: ${(err as Error).message}`);
    }
  }

  async sendSessionAlert(toEmail: string, companyName: string, softwareType = 'Towbook'): Promise<void> {
    const subject = `Action required: ${softwareType} session expired`;
    const text = `Hi ${companyName} team,\n\nYour connection to ${softwareType} has expired. Please log in to US Tow Dispatch and re-enter your credentials.\n\nUntil resolved, AI ETA lookups will fall back to your default dispatcher transfer number.\n\n— US Tow Dispatch`;
    await this.send(toEmail, subject, text);
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.sendgrid) {
      this.logger.log(`[email-fallback] to=${to} subject=${subject}`);
      this.logger.log(text);
      return;
    }
    try {
      await this.sendgrid.send({ to, from: this.fromAddress, subject, text });
      this.logger.log(`Sent email to=${to} subject=${subject}`);
    } catch (err) {
      this.logger.error(`SendGrid send failed: ${(err as Error).message}`);
    }
  }
}
