import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { jobEvents, unifiedJobs, type UnifiedJobRow } from '../../db/schema';

const ROADSIDE_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const CONTACT_TAG = 'ustow-roadside-contact';
const IN_TOW_TAG = 'ustow-in-tow';
const COMPLETED_TAG = 'ustow-tow-completed';
const TEST_MODE_TAG = 'ustow-roadside-test';
const BLUECOLLARTIPS_BASE_URL = 'https://bluecollartips.app';
const BLUECOLLARTIPS_COMPANY_SLUG = 'roadside-towing';

type BridgeStage = 'new' | 'in_tow' | 'completed';

function rawLocationId(value: string): string {
  return value.trim().replace(/^location:/i, '');
}

function splitName(name: string | null): { firstName?: string; lastName?: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || undefined };
}

@Injectable()
export class GhlRoadsideBridgeService {
  private readonly logger = new Logger(GhlRoadsideBridgeService.name);
  private readonly token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN?.trim();
  private readonly locationId = rawLocationId(process.env.GHL_LOCATION_ID ?? '');

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  isEnabled(): boolean {
    return process.env.GHL_ROADSIDE_BRIDGE_ENABLED === 'true';
  }

  private isTestMode(): boolean {
    return process.env.GHL_ROADSIDE_BRIDGE_TEST_MODE === 'true';
  }

  private outboundPhone(actualPhone: string): string {
    if (!this.isTestMode()) return actualPhone;
    const testPhone = process.env.GHL_ROADSIDE_BRIDGE_TEST_PHONE?.trim();
    if (!testPhone) throw new Error('GHL_ROADSIDE_BRIDGE_TEST_PHONE is missing while test mode is enabled');
    if (!/^\+[1-9]\d{7,14}$/.test(testPhone)) {
      throw new Error('GHL_ROADSIDE_BRIDGE_TEST_PHONE must use E.164 format, for example +17407461583');
    }
    return testPhone;
  }

  async handleNewJob(job: UnifiedJobRow): Promise<void> {
    await this.syncJob(job, 'new');
  }

  async handleInTowJob(job: UnifiedJobRow): Promise<void> {
    await this.syncJob(job, 'in_tow');
  }

  async handleCompletedJob(job: UnifiedJobRow): Promise<void> {
    await this.syncJob(job, 'completed');
  }

  private async syncJob(job: UnifiedJobRow, stage: BridgeStage): Promise<void> {
    if (!this.isEnabled() || job.tenantId !== ROADSIDE_TENANT_ID || job.source !== 'towbook') return;
    if (!job.callerPhone || (stage === 'in_tow' && job.status !== 'in_tow') || (stage === 'completed' && job.status !== 'completed')) return;
    if (!this.token || !this.locationId) {
      this.logger.warn('Roadside GHL bridge enabled but GHL credentials/location are missing');
      return;
    }

    const eventType = stage === 'completed' ? 'ghl_completed_sent' : stage === 'in_tow' ? 'ghl_in_tow_sent' : 'ghl_contact_synced';
    const sent = await this.db.query.jobEvents.findFirst({
      where: and(eq(jobEvents.jobId, job.id), eq(jobEvents.eventType, eventType)),
      orderBy: [desc(jobEvents.createdAt)],
    });
    if (sent) return;

    const payload = (job.sourcePayload ?? {}) as Record<string, unknown>;
    const testMode = this.isTestMode();
    const outboundPhone = this.outboundPhone(job.callerPhone);
    const driverName = typeof payload.driverName === 'string' ? payload.driverName.trim() : '';
    const contactName = testMode ? 'Roadside Bridge Test' : job.callerName;
    const name = splitName(contactName);
    const customFields: [string | undefined, string | undefined][] = [
      [process.env.GHL_TOWBOOK_JOB_FIELD_KEY, job.sourceJobId],
      [process.env.GHL_TOWBOOK_SOURCE_FIELD_KEY, 'towbook'],
      [process.env.GHL_TOWBOOK_DRIVER_FIELD_KEY, driverName],
    ];
    if (stage === 'completed') {
      customFields.push([process.env.GHL_TOW_COMPLETED_AT_FIELD_KEY, job.completedAt?.toISOString() ?? new Date().toISOString()]);
    }
    const populatedFields = customFields.filter((item): item is [string, string] => Boolean(item[0] && item[1]));

    const response = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Version: 'v3',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...name,
        name: contactName ?? undefined,
        phone: outboundPhone,
        locationId: this.locationId,
        source: 'US Tow AI Connect / TowBook',
        customFields: populatedFields.map(([key, fieldValue]) => ({ key, fieldValue })),
      }),
    });
    if (!response.ok) throw new Error(`GHL contact upsert failed: ${response.status}`);
    const result = (await response.json()) as { contact?: { id?: string } };
    const contactId = result.contact?.id;
    if (!contactId) throw new Error('GHL contact upsert returned no contact id');

    let reviewUrl: string | undefined;
    if (stage === 'in_tow') {
      reviewUrl = await this.createBlueCollarTipsLink(job, contactId, driverName, outboundPhone, testMode);
      const reviewFieldKey = process.env.GHL_BLUECOLLARTIPS_URL_FIELD_KEY?.trim();
      if (!reviewFieldKey) throw new Error('GHL_BLUECOLLARTIPS_URL_FIELD_KEY is missing');
      const fieldsResponse = await fetch(
        `https://services.leadconnectorhq.com/locations/${this.locationId}/customFields?model=contact`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.token}`,
            Version: 'v3',
            Accept: 'application/json',
          },
        },
      );
      if (!fieldsResponse.ok) {
        throw new Error(`GHL custom fields lookup failed: ${fieldsResponse.status}`);
      }
      const fieldsResult = (await fieldsResponse.json()) as {
        customFields?: Array<{ id?: string; fieldKey?: string }>;
      };
      const reviewField = fieldsResult.customFields?.find(
        (field) => field.fieldKey === reviewFieldKey,
      );
      if (!reviewField?.id) {
        throw new Error(`GHL custom field not found: ${reviewFieldKey}`);
      }
      const updateResponse = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Version: 'v3',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customFields: [{ id: reviewField.id, key: reviewFieldKey, fieldValue: reviewUrl }],
        }),
      });
      const updateBody = await updateResponse.text();
      if (!updateResponse.ok) {
        throw new Error(`GHL review link update failed: ${updateResponse.status} ${updateBody.slice(0, 300)}`);
      }
      this.logger.log(
        `GHL review link update accepted for TowBook job ${job.sourceJobId} ` +
        `(field ${reviewFieldKey}, contact ${contactId})`,
      );
    }

    const tag = stage === 'completed' ? COMPLETED_TAG : stage === 'in_tow' ? IN_TOW_TAG : CONTACT_TAG;
    const tags = testMode ? [tag, TEST_MODE_TAG] : [tag];

    // A returning customer (and especially the shared test contact) may still
    // carry COMPLETED from an older tow. Clear lifecycle state at NEW/IN TOW
    // before adding the current tag, otherwise GHL's completion wait finishes
    // immediately for the new job.
    const resetTags =
      stage === 'completed'
        ? [COMPLETED_TAG, ...(testMode ? [TEST_MODE_TAG] : [])]
        : [IN_TOW_TAG, COMPLETED_TAG, ...(testMode && stage === 'in_tow' ? [TEST_MODE_TAG] : [])];
    if (resetTags.length > 0) {
      const removeTagResponse = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Version: 'v3',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tags: resetTags }),
      });
      if (!removeTagResponse.ok) throw new Error(`GHL tag reset failed: ${removeTagResponse.status}`);
    }

    const tagResponse = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Version: 'v3',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tags }),
    });
    if (!tagResponse.ok) throw new Error(`GHL tag update failed: ${tagResponse.status}`);

    await this.db.insert(jobEvents).values({
      jobId: job.id,
      eventType,
      payload: { contactId, tag, reviewUrl, testMode },
      actor: 'ghl-roadside-bridge',
    });
    this.logger.log(`Roadside ${stage} sent to GHL for TowBook job ${job.sourceJobId}`);
  }

  private async createBlueCollarTipsLink(
    job: UnifiedJobRow,
    contactId: string,
    driverName: string,
    contactPhone: string,
    testMode: boolean,
  ): Promise<string> {
    const secret = process.env.BLUECOLLARTIPS_GHL_WEBHOOK_SECRET?.trim();
    if (!secret) throw new Error('BLUECOLLARTIPS_GHL_WEBHOOK_SECRET is missing');
    const response = await fetch(`${BLUECOLLARTIPS_BASE_URL}/api/public/webhooks/ghl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': secret },
      body: JSON.stringify({
        companySlug: BLUECOLLARTIPS_COMPANY_SLUG,
        jobId: job.sourceJobId,
        ghlContactId: contactId,
        expiresInDays: 10,
        driver: driverName ? { name: driverName } : undefined,
        contact: testMode
          ? { name: 'Roadside Bridge Test', phone: contactPhone }
          : { name: job.callerName ?? undefined, phone: contactPhone },
      }),
    });
    if (!response.ok) throw new Error(`Blue Collar Tips link creation failed: ${response.status}`);
    const result = (await response.json()) as { tipUrl?: string };
    if (!result.tipUrl) throw new Error('Blue Collar Tips returned no review URL');
    return result.tipUrl;
  }
}
