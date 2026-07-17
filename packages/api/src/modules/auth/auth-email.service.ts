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

  async sendInviteEmail(toEmail: string, inviteUrl: string, companyName: string): Promise<void> {
    const subject = `You've been invited to join ${companyName} on AI-Connect`;
    const text = `You've been invited to join ${companyName}'s workspace on US Tow AI-Connect.\n\nClick the link below to accept your invitation and set up your account:\n\n${inviteUrl}\n\nThis link will expire in 7 days.\nIf you are not expecting this invitation, you can safely ignore this email.`;
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>You've been invited!</h2>
        <p>You've been invited to join <strong>${companyName}</strong>'s workspace on US Tow AI-Connect.</p>
        <p style="margin: 30px 0;">
          <a href="${inviteUrl}" style="background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Accept Invitation
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">This link will expire in 7 days.</p>
      </div>
    `;

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: this.fromAddress,
          to: toEmail,
          subject,
          text,
          html,
        });
        this.logger.log(`Sent invite email to ${toEmail}`);
      } catch (err) {
        this.logger.error(`Failed to send invite email: ${(err as Error).message}`);
        // don't throw, just log so we don't crash the invite flow
      }
    } else {
      this.logger.log(`[DRY RUN] Would send invite email to ${toEmail} for ${companyName}`);
    }
  }
}
