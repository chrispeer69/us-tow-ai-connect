import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly fromAddress: string;

  constructor() {
    this.fromAddress = process.env.ALERT_EMAIL_FROM ?? 'alerts@ustowdispatch.com';
    const emailPassword = process.env.EMAIL_PASSWORD;

    if (emailPassword) {
      this.transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST ?? 'smtp.gmail.com',
        port: Number(process.env.EMAIL_PORT ?? 587),
        secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
        auth: {
          user: this.fromAddress,
          pass: emailPassword,
        },
      });
      this.logger.log('AuthEmailService Nodemailer initialized');
    } else {
      this.logger.warn('EMAIL_PASSWORD not set. Auth emails will not be sent.');
    }
  }

  async sendPasswordResetOtp(toEmail: string, otpCode: string): Promise<void> {
    const subject = 'Your Password Reset Code';
    const text = `You requested to reset your password.\n\nYour 6-digit reset code is: ${otpCode}\n\nThis code will expire in 15 minutes.\nIf you did not request a password reset, you can safely ignore this email.`;
    
    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: this.fromAddress,
          to: toEmail,
          subject,
          text,
        });
        this.logger.log(`Sent OTP email to ${toEmail}`);
      } catch (err) {
        this.logger.error(`Failed to send OTP email: ${(err as Error).message}`);
        throw err;
      }
    } else {
      this.logger.log(`[DRY RUN] Would send OTP ${otpCode} to ${toEmail}`);
    }
  }
}
