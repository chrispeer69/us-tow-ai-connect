'use server';

/**
 * Server action for the "Schedule a Demo" form.
 * Sends a Twilio SMS summarizing the submission to Chris at 614-633-7935.
 *
 * Required env vars on the @ustow/web service:
 *   - TWILIO_ACCOUNT_SID   (Twilio account SID, starts with "AC…")
 *   - TWILIO_AUTH_TOKEN    (Twilio auth token)
 *   - TWILIO_FROM_NUMBER   (Twilio phone number to send from, E.164 e.g. +16145551234)
 *   - DEMO_SMS_TO          (optional override, defaults to +16146337935)
 */

const DEFAULT_RECIPIENT = '+16146337935'; // Chris Peer

export type ScheduleDemoResult = { ok: true } | { ok: false; error: string };

function plain(v: FormDataEntryValue | null): string {
  return v == null ? '' : String(v).trim();
}

export async function submitDemoRequest(
  formData: FormData,
): Promise<ScheduleDemoResult> {
  const name = plain(formData.get('name'));
  const businessName = plain(formData.get('businessName'));
  const city = plain(formData.get('city'));
  const state = plain(formData.get('state'));
  const phone = plain(formData.get('phone'));
  const email = plain(formData.get('email'));
  const annualRevenue = plain(formData.get('annualRevenue'));
  const fleetSize = plain(formData.get('fleetSize'));

  if (!name || !businessName || !phone) {
    return { ok: false, error: 'Name, business name, and phone are required.' };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Please provide a valid email address (or leave it blank).' };
  }

  const lines = [
    'New US Tow AI-Connect demo request',
    `Name: ${name}`,
    `Business: ${businessName}`,
    `Location: ${[city, state].filter(Boolean).join(', ') || '—'}`,
    `Phone: ${phone}`,
    `Email: ${email || '—'}`,
    `Annual revenue: ${annualRevenue || '—'}`,
    `Fleet size: ${fleetSize || '—'}`,
  ];
  const body = lines.join('\n');

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  const toNumber = process.env.DEMO_SMS_TO || DEFAULT_RECIPIENT;

  if (!accountSid || !authToken || !fromNumber) {
    console.error(
      '[schedule-demo] Twilio env vars missing — demo request from %s (%s) NOT sent:\n%s',
      name,
      phone,
      body,
    );
    return {
      ok: false,
      error:
        'SMS service is not configured on the server. Your request was logged — please call 614-633-7935 directly.',
    };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`, 'utf8').toString('base64');

  const formBody = new URLSearchParams();
  formBody.set('From', fromNumber);
  formBody.set('To', toNumber);
  formBody.set('Body', body);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody.toString(),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(
        '[schedule-demo] Twilio rejected: %s %s — %s',
        res.status,
        res.statusText,
        errBody,
      );
      return {
        ok: false,
        error: `SMS service returned ${res.status}. Please call 614-633-7935 directly.`,
      };
    }
  } catch (err) {
    console.error('[schedule-demo] Twilio request failed:', err);
    return {
      ok: false,
      error: 'Could not reach SMS service. Please call 614-633-7935 directly.',
    };
  }

  return { ok: true };
}
