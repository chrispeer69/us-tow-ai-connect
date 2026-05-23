import { Body, Controller, Header, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { TwilioSignatureGuard } from '../../common/guards/twilio-signature.guard';
import { TwilioSmsService } from './twilio-sms.service';

interface SmsStatusCallbackBody {
  MessageSid?: string;
  MessageStatus?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
}

/**
 * Twilio status callbacks for outbound SMS. The signature guard validates the
 * request; we then translate Twilio's status vocabulary to ours and update the
 * sms_messages row keyed by `twilio_sid`.
 *
 * Inbound SMS (caller replies) are handled by the flip-accept module so the
 * approval-parsing live next to the workflow code that owns the meaning of
 * "YES", "NO REASON", etc.
 */
@Controller('webhooks/twilio')
@UseGuards(TwilioSignatureGuard)
export class SmsWebhookController {
  private readonly logger = new Logger(SmsWebhookController.name);

  constructor(private readonly sms: TwilioSmsService) {}

  @Post('sms-status-callback')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  async handleSmsStatus(@Body() body: SmsStatusCallbackBody): Promise<string> {
    const sid = body?.MessageSid;
    const status = body?.MessageStatus ?? 'unknown';
    if (!sid) {
      this.logger.warn('sms-status-callback received without MessageSid');
      return '<Response/>';
    }
    const err = body?.ErrorMessage || (body?.ErrorCode ? `code=${body.ErrorCode}` : null);
    try {
      await this.sms.updateStatusBySid({
        twilioSid: sid,
        status,
        error: err,
        deliveredAt: status === 'delivered' ? new Date() : null,
      });
    } catch (e) {
      this.logger.warn(`SMS status update failed sid=${sid}: ${(e as Error).message}`);
    }
    return '<Response/>';
  }
}
