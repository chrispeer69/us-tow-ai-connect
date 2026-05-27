import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { outboundCallLogs } from '../../db/schema';
import { OutboundVoiceService } from '../outbound-voice/outbound-voice.service';
import {
  DestinationClassifierService,
  type ClassifyDestinationResult,
} from './destination-classifier.service';
import { FlipEngineService } from './flip-engine.service';
import { decideFlip, type FlipDecision } from './flip-decision.engine';
import {
  IssueClassifierService,
  type ClassifyIssueResult,
} from './issue-classifier.service';
import {
  renderConfirmDetails,
  renderConviniPitch,
  renderOffer1,
  renderOffer2,
  renderOffer3,
} from './flip-scripts';

/**
 * Session 49c — Flip orchestrator.
 *
 * Loop:
 *   1. Cron tick (default every 60s).
 *   2. For each tenant with `flip_engine_enabled = true`:
 *      a. Fetch new motor club jobs (Towbook + AAA) since last tick.
 *      b. For each new job, classify destination + issue.
 *      c. Decide flip eligibility (decideFlip).
 *      d. Build the script via flip-scripts renderers.
 *      e. Enqueue outbound call via OutboundVoiceService (custom template).
 *      f. Insert an outbound_call_logs row capturing all decisions.
 *   3. Move on. Errors per-job are logged but never abort the whole batch.
 *
 * Job-source adapters are NOT modified by this service. We rely on
 * existing scrapeAllActiveJobs adapter methods + an in-memory "seen jobs"
 * set keyed on `${source}:${tenantId}:${jobId}` so we don't re-enqueue
 * the same job. The set evicts entries older than 6 hours to keep memory
 * bounded.
 */
@Injectable()
export class FlipOrchestratorService {
  private readonly logger = new Logger(FlipOrchestratorService.name);
  private readonly seen = new Map<string, number>(); // key -> ms timestamp
  private readonly RETAIN_MS = 6 * 60 * 60 * 1000;
  private running = false;

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly flipEngine: FlipEngineService,
    private readonly destinationClassifier: DestinationClassifierService,
    private readonly issueClassifier: IssueClassifierService,
    private readonly voice: OutboundVoiceService,
  ) {}

  @Cron('0 */1 * * * *') // every 60s
  async tickCron(): Promise<void> {
    if (process.env.OUTBOUND_FLIP_ENGINE_ENABLED !== 'true') return;
    if (this.running) {
      this.logger.debug('[flip-orchestrator] previous tick still running, skipping');
      return;
    }
    this.running = true;
    try {
      await this.tick();
    } finally {
      this.running = false;
      this.gcSeen();
    }
  }

  /**
   * One pass across all flip-enabled tenants. Public so tests / admin
   * "run now" endpoints can drive it without waiting for the cron.
   */
  async tick(): Promise<{ tenantsProcessed: number; jobsClassified: number; callsEnqueued: number }> {
    const tenantIds = await this.flipEngine.listEnabledTenantIds();
    let jobsClassified = 0;
    let callsEnqueued = 0;
    for (const tenantId of tenantIds) {
      try {
        const result = await this.processTenant(tenantId);
        jobsClassified += result.jobsClassified;
        callsEnqueued += result.callsEnqueued;
      } catch (err) {
        this.logger.warn(
          `[flip-orchestrator] tenant ${tenantId} tick threw: ${(err as Error).message}`,
        );
      }
    }
    return { tenantsProcessed: tenantIds.length, jobsClassified, callsEnqueued };
  }

  private async processTenant(tenantId: string) {
    let jobsClassified = 0;
    let callsEnqueued = 0;

    // Hand-off to the existing job-poller adapters via FlipEngineService.
    // The poller already knows how to fetch new jobs per source; we just
    // expose a thin "jobs since last tick" feed via the public API.
    const jobs = await this.flipEngine.fetchPendingFlipJobs(tenantId);
    for (const job of jobs) {
      const seenKey = `${job.source}:${tenantId}:${job.jobId}`;
      if (this.seen.has(seenKey)) continue;
      this.seen.set(seenKey, Date.now());
      jobsClassified += 1;

      try {
        const enqueued = await this.handleJob(tenantId, job);
        if (enqueued) callsEnqueued += 1;
      } catch (err) {
        this.logger.warn(
          `[flip-orchestrator] job ${seenKey} threw: ${(err as Error).message}`,
        );
      }
    }
    return { jobsClassified, callsEnqueued };
  }

  /**
   * Process a single job: classify, decide, render, enqueue, log.
   */
  async handleJob(
    tenantId: string,
    job: PendingFlipJob,
  ): Promise<boolean> {
    // Pull tenant config + blocklist + our shops in parallel.
    const [config, blocklistRows, ourShops] = await Promise.all([
      this.flipEngine.getConfig(tenantId),
      this.flipEngine.listBlocklist(tenantId),
      this.flipEngine.listActiveShops(tenantId),
    ]);
    const blocklist = blocklistRows
      .filter((b) => b.active)
      .map((b) => ({
        matchType: b.matchType as 'NAME_PATTERN' | 'EXACT_NAME' | 'EXACT_ADDRESS' | 'PHONE',
        matchValue: b.matchValue,
        active: b.active,
      }));
    const ourShopNames = ourShops.map((s) => s.name.toLowerCase().trim());

    // 1. Classify destination.
    const destination: ClassifyDestinationResult = await this.destinationClassifier.classify({
      destinationName: job.destinationName ?? null,
      destinationAddress: job.destinationAddress ?? null,
      destinationPhone: job.destinationPhone ?? null,
      source: job.source,
      blocklist,
      ourShopNames,
    });

    // 2. Classify issue.
    const issue: ClassifyIssueResult = this.issueClassifier.classify({
      reasonText: job.reasonText ?? null,
      vehicleNotes: job.vehicleNotes ?? null,
      motorClubServiceCode: job.motorClubServiceCode ?? null,
    });

    // 3. Decide.
    const decision: FlipDecision = decideFlip({
      source: job.source,
      destinationTag: destination.tag,
      issueSubcategory: issue.subcategory,
      issueConfidence: issue.confidence,
      config: (config.config as Record<string, unknown>) ?? {},
    });

    // 4. Pick nearest shop (only when we'll actually pitch a flip).
    let nearestShopName: string | null = null;
    let distanceMilesSaved: number | null = null;
    if (decision.flipEligible && job.pickupLat != null && job.pickupLng != null) {
      const pick = await this.flipEngine.pickNearestShop({
        tenantId,
        pickupLat: job.pickupLat,
        pickupLng: job.pickupLng,
        shopType: 'REPAIR',
      });
      nearestShopName = pick.shop?.name ?? null;
      distanceMilesSaved = pick.distanceMiles;
    }

    // 5. Build script.
    const mentionRentals = (config.config as { mention_rentals?: boolean })?.mention_rentals !== false;
    const confirm = renderConfirmDetails({
      customerName: job.customerName,
      companyName: job.companyName ?? 'our team',
      vehicle: job.vehicle ?? 'your vehicle',
      pickupLocation: job.pickupAddress ?? 'your location',
      destination: destination.resolvedAddress ?? job.destinationAddress ?? 'your destination',
    });
    const offers = decision.flipEligible && nearestShopName
      ? [
          renderOffer1({ ourShopName: nearestShopName, distanceMilesSaved, rentalsAvailable: mentionRentals }),
          renderOffer2({ ourShopName: nearestShopName, distanceMilesSaved, rentalsAvailable: mentionRentals }),
          renderOffer3({ ourShopName: nearestShopName, distanceMilesSaved, rentalsAvailable: mentionRentals }),
        ]
      : [];
    const convini = renderConviniPitch({
      intensity: decision.conviniIntensity,
      rentalsAvailable: mentionRentals,
      ourBodyShopMention: decision.bodyShopSoftMention
        ? pickTwoBodyShops(ourShops)
        : undefined,
    });

    const fullBody = [confirm, ...offers, convini].join('\n\n');

    // 6. Persist log row before enqueue (so we have the trail even if
    //    the orchestrator crashes mid-call).
    const [logRow] = await this.db
      .insert(outboundCallLogs)
      .values({
        tenantId,
        customerName: job.customerName,
        customerPhone: job.customerPhone,
        motorClub: job.motorClub ?? null,
        vehicle: job.vehicle ?? null,
        issueType: issue.subcategory,
        originalDestination: job.destinationAddress ?? null,
        destinationBusinessName: destination.resolvedName ?? job.destinationName ?? null,
        destinationType: destination.tag,
        flipEligible: decision.flipEligible,
        nearestOurShop: nearestShopName,
      })
      .returning({ id: outboundCallLogs.id });

    // 7. Enqueue the outbound call. Custom template + the rendered body
    //    in scriptVariables so OutboundVoiceService.enqueueCall renders
    //    `{{body}}` straight through.
    try {
      await this.voice.enqueueCall({
        tenantId,
        purpose: 'custom',
        toPhone: job.customerPhone,
        toName: job.customerName,
        scriptTemplate: 'custom',
        scriptVariables: { body: fullBody },
        relatedJobId: null, // job.jobId is the source-side id, not a UUID
      });
      return true;
    } catch (err) {
      this.logger.warn(
        `[flip-orchestrator] enqueue failed for log ${logRow.id}: ${(err as Error).message}`,
      );
      // Mark the log row terminal-failed.
      await this.db
        .update(outboundCallLogs)
        .set({ flipOutcome: 'ENQUEUE_FAILED' })
        .where(eq(outboundCallLogs.id, logRow.id));
      return false;
    }
  }

  private gcSeen() {
    const cutoff = Date.now() - this.RETAIN_MS;
    for (const [k, t] of this.seen) {
      if (t < cutoff) this.seen.delete(k);
    }
  }
}

function pickTwoBodyShops(
  shops: Array<{ name: string; shopType: string; active: boolean }>,
): { shop1: string; shop2: string } | undefined {
  const body = shops.filter((s) => s.shopType === 'BODY' && s.active);
  if (body.length === 0) return undefined;
  return {
    shop1: body[0].name,
    shop2: body[1]?.name ?? body[0].name,
  };
}

export interface PendingFlipJob {
  source: 'TOWBOOK' | 'AAA_PORTAL' | string;
  jobId: string;
  customerName: string;
  customerPhone: string;
  vehicle?: string | null;
  motorClub?: string | null;
  motorClubServiceCode?: string | null;
  reasonText?: string | null;
  vehicleNotes?: string | null;
  pickupAddress?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  destinationName?: string | null;
  destinationAddress?: string | null;
  destinationPhone?: string | null;
  companyName?: string | null;
}
