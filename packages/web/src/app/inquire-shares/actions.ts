'use server';

/**
 * Server action for the "Inquire About Purchasing Shares" form.
 * Sends the submission to chris@bluecollarai.online via SendGrid REST API.
 *
 * Required env vars on the @ustow/web service:
 *   - SENDGRID_API_KEY    (required)
 *   - SHARES_INQUIRY_TO   (optional; defaults to chris@bluecollarai.online)
 *   - SHARES_INQUIRY_FROM (optional; defaults to chris@bluecollarai.online —
 *                          must be a verified sender in SendGrid)
 */

const RECIPIENT = process.env.SHARES_INQUIRY_TO || 'chris@bluecollarai.online';
const SENDER = process.env.SHARES_INQUIRY_FROM || 'chris@bluecollarai.online';

export type InquiryResult = { ok: true } | { ok: false; error: string };

function esc(v: FormDataEntryValue | null): string {
  if (v == null) return '';
  return String(v).replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
}

function plain(v: FormDataEntryValue | null): string {
  return v == null ? '' : String(v).trim();
}

export async function submitShareInquiry(formData: FormData): Promise<InquiryResult> {
  const name = plain(formData.get('name'));
  const email = plain(formData.get('email'));

  if (!name || !email) {
    return { ok: false, error: 'Name and email are required.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Please provide a valid email address.' };
  }

  const fields: Array<[string, string]> = [
    ['Name', plain(formData.get('name'))],
    ['Company Name', plain(formData.get('companyName'))],
    ['Email Address', plain(formData.get('email'))],
    ['Cell Phone', plain(formData.get('cellPhone'))],
    ['Company Phone', plain(formData.get('companyPhone'))],
    ['Address', plain(formData.get('address'))],
    ['Annual Revenue', plain(formData.get('annualRevenue'))],
    ['Business & Fleet Description', plain(formData.get('businessDescription'))],
    ['Manager Names', plain(formData.get('managerNames'))],
    ["Managers' Email", plain(formData.get('managersEmail'))],
    ["Managers' Phone", plain(formData.get('managersPhone'))],
    ['Investment Interest (1–10)', plain(formData.get('interestLevel'))],
    ['Investment Timeline', plain(formData.get('timeline'))],
  ];

  const html = `
    <h2 style="font-family:Inter,system-ui,sans-serif;">New share inquiry — US Tow AI-Connect</h2>
    <p style="font-family:Inter,system-ui,sans-serif;color:#555;">
      A prospective shareholder submitted the inquiry form on ustowaiconnect.com.
    </p>
    <table style="border-collapse:collapse;font-family:Inter,system-ui,sans-serif;font-size:14px;">
      ${fields
        .map(
          ([k, v]) => `
        <tr>
          <td style="padding:8px 12px;border:1px solid #eee;background:#f9fafb;font-weight:600;vertical-align:top;">${esc(
            k,
          )}</td>
          <td style="padding:8px 12px;border:1px solid #eee;vertical-align:top;white-space:pre-wrap;">${esc(v) || '—'}</td>
        </tr>`,
        )
        .join('')}
    </table>
  `;

  const text = fields.map(([k, v]) => `${k}: ${v || '—'}`).join('\n');

  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.error(
      '[inquire-shares] SENDGRID_API_KEY is not set — inquiry from %s (%s) NOT sent. Payload:\n%s',
      name,
      email,
      text,
    );
    return {
      ok: false,
      error:
        'Email service is not configured on the server. Your message was logged — please email chris@bluecollarai.online directly.',
    };
  }

  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: RECIPIENT }],
            subject: `Share inquiry — ${name} (${plain(formData.get('companyName')) || 'company TBD'})`,
          },
        ],
        from: { email: SENDER, name: 'US Tow AI-Connect' },
        reply_to: { email, name },
        content: [
          { type: 'text/plain', value: text },
          { type: 'text/html', value: html },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(
        '[inquire-shares] SendGrid rejected: %s %s — %s',
        res.status,
        res.statusText,
        body,
      );
      return {
        ok: false,
        error: `Email service returned ${res.status}. Please email chris@bluecollarai.online directly.`,
      };
    }
  } catch (err) {
    console.error('[inquire-shares] SendGrid request failed:', err);
    return {
      ok: false,
      error: 'Could not reach email service. Please email chris@bluecollarai.online directly.',
    };
  }

  return { ok: true };
}
