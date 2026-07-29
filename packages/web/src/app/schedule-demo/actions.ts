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

// @ts-expect-error Kept as reference for Twilio fallback
const _DEFAULT_RECIPIENT = '+16146337935'; // Chris Peer

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

  const payload = {
    name,
    businessName,
    city,
    state,
    phone,
    email,
    annualRevenue,
    fleetSize,
    formattedBody: body // You can use this single string in n8n if you just want to send the raw text!
  };

  const webhookUrl = 'https://n8n.fractio.services/webhook/schedule-demo';

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error('[schedule-demo] n8n rejected:', res.status, res.statusText);
      return {
        ok: false,
        error: `Could not send request. Please call 614-633-7935 directly.`,
      };
    }
  } catch (err) {
    console.error('[schedule-demo] n8n webhook request failed:', err);
    return {
      ok: false,
      error: 'Could not reach server. Please call 614-633-7935 directly.',
    };
  }

  return { ok: true };
}
