import { Injectable, Logger } from '@nestjs/common';
import twilio, { type Twilio } from 'twilio';
import type { DestinationType } from './google-places.service';

export interface OutboundCallParams {
  customerPhone: string;
  customerName: string;
  vehicle: string;
  pickupLocation: string;
  destination: string;
  destinationType: DestinationType;
  flipEligible: boolean;
  nearestOurShop: string | null;
  tenantId: string;
}

@Injectable()
export class TwilioOutboundService {
  private readonly logger = new Logger(TwilioOutboundService.name);
  private readonly client: Twilio | null;
  private readonly fromNumber: string;
  private readonly baseUrl: string;

  constructor() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER ?? '';
    this.baseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001';

    if (!sid || sid.startsWith('REPLACE_ME') || !token || token.startsWith('REPLACE_ME')) {
      this.logger.warn(
        'TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not configured — outbound calls will be skipped',
      );
      this.client = null;
      return;
    }
    this.client = twilio(sid, token);
  }

  isConfigured(): boolean {
    return this.client !== null && !!this.fromNumber;
  }

  async initiateConfirmationCall(params: OutboundCallParams): Promise<string | null> {
    if (!this.client) {
      this.logger.warn(`Skipping outbound call to ${params.customerPhone} — Twilio not configured`);
      return null;
    }
    if (!this.fromNumber) {
      this.logger.warn('TWILIO_PHONE_NUMBER is empty — cannot initiate outbound call');
      return null;
    }

    const twiml = this.buildTwiml(params);

    const call = await this.client.calls.create({
      to: params.customerPhone,
      from: this.fromNumber,
      twiml,
      statusCallback: `${this.baseUrl}/webhooks/twilio/call-status`,
      statusCallbackEvent: ['completed'],
      record: true,
    });

    this.logger.log(`Outbound call initiated: ${call.sid} to ${params.customerPhone}`);
    return call.sid;
  }

  buildTwiml(params: OutboundCallParams): string {
    const safeName = escapeXml(params.customerName || 'there');
    const safeVehicle = escapeXml(params.vehicle || 'your vehicle');
    const safePickup = escapeXml(params.pickupLocation || 'your current location');
    const safeDestination = escapeXml(params.destination || 'your requested destination');
    const tenantQs = encodeURIComponent(params.tenantId);
    const phoneQs = encodeURIComponent(params.customerPhone);

    const parts: string[] = [];

    parts.push(
      `<Say voice="Polly.Joanna">Hi, this is Sarah calling from Roadside Towing on behalf of Triple A. Am I speaking with ${safeName}?</Say>`,
    );
    parts.push(`<Pause length="2"/>`);
    parts.push(
      `<Say voice="Polly.Joanna">I'm calling to confirm the details of your tow request. I have your vehicle as a ${safeVehicle}, being picked up at ${safePickup}, and towed to ${safeDestination}. Is all of that correct?</Say>`,
    );
    parts.push(`<Pause length="3"/>`);

    if (params.flipEligible && params.nearestOurShop) {
      const safeShop = escapeXml(params.nearestOurShop);
      parts.push(
        `<Say voice="Polly.Joanna">I want to let you know, we have a certified repair facility nearby called ${safeShop}. If you'd like, we can redirect your tow there at no extra charge, and you'd receive a free diagnostic and 10 percent off your repair. Would you like me to make that switch? Press 1 for yes, or 2 to keep your current destination.</Say>`,
      );
      parts.push(
        `<Gather numDigits="1" action="${this.baseUrl}/webhooks/twilio/flip-response?tenantId=${tenantQs}&amp;phone=${phoneQs}" method="POST">` +
          `<Pause length="5"/>` +
          `</Gather>`,
      );
    } else if (params.destinationType === 'AUTO_BODY') {
      parts.push(
        `<Say voice="Polly.Joanna">Just so you know, we also own two independent body shops in the area that offer VIP services. If you ever need collision work in the future and want to choose your own shop, we'd love to take care of you.</Say>`,
      );
    }

    const intensity =
      params.destinationType === 'UNKNOWN' || params.destinationType === 'RESIDENTIAL'
        ? 'hard'
        : 'soft';
    if (intensity === 'hard') {
      parts.push(
        `<Say voice="Polly.Joanna">Before I let you go, I want to tell you about our free app called Convini Car. It puts roadside assistance, repair scheduling, car rentals, and exclusive member deals all in one place on your phone. It's completely free. Press 1 if you'd like me to text you the download link.</Say>`,
      );
    } else {
      parts.push(
        `<Say voice="Polly.Joanna">One quick thing. We have a free app called Convini Car for roadside assistance and repair scheduling. Press 1 if you'd like me to text you the link.</Say>`,
      );
    }
    parts.push(
      `<Gather numDigits="1" action="${this.baseUrl}/webhooks/twilio/convini-response?tenantId=${tenantQs}&amp;phone=${phoneQs}" method="POST">` +
        `<Pause length="3"/>` +
        `</Gather>`,
    );

    parts.push(`<Say voice="Polly.Joanna">Your driver is on the way. Have a great day!</Say>`);

    return `<Response>${parts.join('')}</Response>`;
  }

  async sendConviniSms(toPhone: string): Promise<string | null> {
    if (!this.client || !this.fromNumber) {
      this.logger.warn(`Cannot send Convini SMS to ${toPhone} — Twilio not configured`);
      return null;
    }
    const message = await this.client.messages.create({
      to: toPhone,
      from: this.fromNumber,
      body: 'Thanks for choosing us! Download the free Convini Car app here: https://convini.app/download',
    });
    return message.sid;
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
