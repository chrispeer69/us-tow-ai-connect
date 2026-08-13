import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { outboundCallLogs } from '../../db/schema';
import type { ActiveJob } from '../adapters/adapter.interface';
import { GooglePlacesService } from './google-places.service';
import { FlipLogicService } from './flip-logic.service';
import { TwilioOutboundService } from './twilio-outbound.service';

const PROCESSED_JOBS_KEY = 'outbound:processed-jobs';
const PROCESSED_TTL_SECONDS = 24 * 60 * 60;
const ELIGIBLE_STATUSES = new Set(['Waiting', 'Dispatched']);

@Injectable()
export class OutboundPollerCron {
  private readonly logger = new Logger(OutboundPollerCron.name);
  private isRunning = false;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly googlePlaces: GooglePlacesService,
    private readonly flipLogic: FlipLogicService,
    private readonly twilioOutbound: TwilioOutboundService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async checkForNewJobs(): Promise<void> {
    if (!process.env.DATABASE_URL) {
      return;
    }
    if (this.isRunning) {
      this.logger.warn('Previous outbound cycle still running. Skipping.');
      return;
    }
    this.isRunning = true;

    try {
      const keys = await this.redis.keys('jobs:*');
      for (const key of keys) {
        await this.processTenantKey(key);
      }
    } catch (err) {
      this.logger.error(`Outbound cycle failed: ${(err as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }

  private async processTenantKey(key: string): Promise<void> {
    // key shape: jobs:<software>:<tenantId>
    const parts = key.split(':');
    if (parts.length < 3) return;
    const tenantId = parts[parts.length - 1];

    const jobsJson = await this.redis.get(key);
    if (!jobsJson) return;

    let jobs: ActiveJob[];
    try {
      jobs = JSON.parse(jobsJson) as ActiveJob[];
    } catch {
      this.logger.warn(`Skipping malformed cache at ${key}`);
      return;
    }

    for (const job of jobs) {
      if (!job?.jobId) continue;
      if (!ELIGIBLE_STATUSES.has(job.status)) continue;

      const seenKey = `${PROCESSED_JOBS_KEY}:${tenantId}:${job.jobId}`;
      // SET ... NX returns 'OK' on first write, null when key already exists
      const claimed = await this.redis.set(seenKey, '1', 'EX', PROCESSED_TTL_SECONDS, 'NX');
      if (claimed !== 'OK') continue;

      try {
        await this.handleJob(tenantId, job);
      } catch (err) {
        this.logger.error(
          `Failed outbound for tenant=${tenantId} job=${job.jobId}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async handleJob(tenantId: string, job: ActiveJob): Promise<void> {
    this.logger.log(`New job detected: ${job.jobId} - ${job.customerName}`);

    const classification = await this.googlePlaces.classifyAddress(job.destination);
    const decision = this.flipLogic.decide(classification.type, job.destination);
    const phone = normalizePhone(job.customerPhone);

    let callSid: string | null = null;
    if (phone) {
      callSid = await this.twilioOutbound.initiateConfirmationCall({
        customerPhone: phone,
        customerName: job.customerName,
        vehicle: job.vehicle,
        pickupLocation: 'your current location',
        destination: classification.businessName || job.destination,
        destinationType: classification.type,
        flipEligible: decision.flipEligible,
        nearestOurShop: decision.nearestShop,
        tenantId,
      });
    } else {
      this.logger.warn(`Job ${job.jobId}: no usable customer phone — logging without dialing`);
    }

    await this.db.insert(outboundCallLogs).values({
      tenantId,
      customerName: job.customerName ?? 'Unknown',
      customerPhone: phone ?? job.customerPhone ?? '',
      vehicle: job.vehicle,
      originalDestination: job.destination,
      destinationBusinessName: classification.businessName || null,
      destinationType: classification.type,
      // Gate eligibility on actually having a shop to name, matching
      // FlipOrchestrator (`decision.flipEligible && !!nearestShopName`). This
      // path used to record eligible=true with no shop, which is a state no
      // call can act on — twilio-outbound.service already refuses to pitch
      // without one. Those rows inflated `eligible` and `never_pitched` in the
      // daily review and made the agent look like it was skipping pitches it
      // never had. Logging defect only: no call behaviour changes here.
      flipEligible: decision.flipEligible && !!decision.nearestShop,
      noFlipReason:
        decision.flipEligible && !decision.nearestShop ? 'no_partner_shop_in_range' : null,
      nearestOurShop: decision.nearestShop,
      conviniSellType: decision.conviniSellType,
      callRecordingUrl: callSid ? `pending:${callSid}` : null,
    });
  }
}

function normalizePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (raw.startsWith('+')) return raw;
  return `+${digits}`;
}
