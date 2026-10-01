import { Injectable, Logger } from '@nestjs/common';

const DEFAULT_TAG = 'ustow-ai-connect-registered';
const GHL_BASE_URL = 'https://services.leadconnectorhq.com';

export interface GhlAccountSyncInput {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  companyName?: string | null;
  source: string;
}

function rawLocationId(value: string): string {
  return value.trim().replace(/^location:/i, '');
}

function clean(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

@Injectable()
export class GhlAccountSyncService {
  private readonly logger = new Logger(GhlAccountSyncService.name);

  isEnabled(): boolean {
    return process.env.GHL_ACCOUNT_SYNC_ENABLED === 'true';
  }

  /**
   * Best-effort CRM sync for a newly-created US Tow AI-Connect account.
   *
   * GHL's upsert endpoint follows the sub-account's duplicate-contact rules,
   * so an existing email/phone is updated and a new person is created. Tags
   * are intentionally added with the dedicated endpoint: including `tags` in
   * the upsert body would replace the contact's existing tags.
   *
   * This method never throws. A GHL outage must not roll back or reject a
   * successfully-created application account.
   */
  async syncAccount(input: GhlAccountSyncInput): Promise<boolean> {
    if (!this.isEnabled()) return false;

    const token = process.env.GHL_ACCOUNT_SYNC_PRIVATE_INTEGRATION_TOKEN?.trim();
    const locationId = rawLocationId(process.env.GHL_ACCOUNT_SYNC_LOCATION_ID ?? '');
    if (!token || !locationId) {
      this.logger.warn('GHL account sync enabled but GHL credentials/location are missing');
      return false;
    }

    const email = clean(input.email)?.toLowerCase();
    const phone = clean(input.phone);
    if (!email && !phone) {
      this.logger.warn('GHL account sync skipped because both email and phone are missing');
      return false;
    }

    const firstName = clean(input.firstName);
    const lastName = clean(input.lastName);
    const name = clean(input.name) ?? ([firstName, lastName].filter(Boolean).join(' ') || undefined);
    const tag = clean(process.env.GHL_ACCOUNT_SYNC_TAG) ?? DEFAULT_TAG;
    const headers = {
      Authorization: `Bearer ${token}`,
      Version: 'v3',
      'Content-Type': 'application/json',
    };

    try {
      const upsertResponse = await fetch(`${GHL_BASE_URL}/contacts/upsert`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({
          locationId,
          email,
          phone,
          firstName,
          lastName,
          name,
          companyName: clean(input.companyName),
          source: input.source,
          createNewIfDuplicateAllowed: false,
        }),
      });
      const upsertBody = await upsertResponse.text();
      if (!upsertResponse.ok) {
        throw new Error(`contact upsert returned ${upsertResponse.status}: ${upsertBody.slice(0, 300)}`);
      }

      const result = JSON.parse(upsertBody) as { contact?: { id?: string } };
      const contactId = result.contact?.id;
      if (!contactId) throw new Error('contact upsert returned no contact id');

      const tagResponse = await fetch(`${GHL_BASE_URL}/contacts/${contactId}/tags`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({ tags: [tag] }),
      });
      if (!tagResponse.ok) {
        const tagBody = await tagResponse.text();
        throw new Error(`tag update returned ${tagResponse.status}: ${tagBody.slice(0, 300)}`);
      }

      this.logger.log(`Synced new US Tow AI-Connect account to GHL contact ${contactId}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`GHL account sync failed without blocking account creation: ${message}`);
      return false;
    }
  }
}
