import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { haversineMiles } from './nearest-shop.selector';
import { Cron } from '@nestjs/schedule';
import { eq, and } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { aiAgentConfigs, outboundCallLogs, tenants, outboundCalls, unifiedJobs } from '../../db/schema';
import type { UnifiedJobRow } from '../../db/schema';
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
  renderCallBody,
  scenarioForDestinationTag,
  SCRIPT_VERSION,
  type ScriptContext,
} from './flip-scripts';
import { GeocoderService } from '../command-center/geocoder.service';

type ManualCallScriptType =
  | 'auto_flip'
  | 'eta_confirmation'
  | 'status_update'
  | 'winch_out'
  | 'convini_only';

function issuePhrase(subcategory: string | null | undefined): string {
  switch (subcategory) {
    // Session 74 — these two must NOT share a phrase. A single flat tire is a
    // roadside tyre change and is on the no-flip list; a full set is genuine
    // shop work and IS flip-eligible. Rendering both as "a flat tire" made the
    // agent read a flip-eligible job as one the rules told it never to pitch,
    // which is how it talked itself out of legitimate offers.
    case 'single_tire_issue':
      return 'a flat tire';
    case 'full_tire_set':
      return 'tire damage needing replacement';
    case 'jump_start':
      return 'a battery or no-start issue';
    case 'lockout':
      return 'a lockout';
    case 'fuel_delivery':
      return 'an out-of-fuel situation';
    case 'winch_out':
      return 'a stuck or off-road recovery';
    case 'accident_with_airbags':
    case 'accident_minor':
      return 'an accident';
    case 'glass_damage':
      return 'glass or windshield damage';
    case 'mechanical':
      return 'a mechanical issue';
    default:
      return 'a service request';
  }
}

/**
 * Session 74 — where a call goes when it is not flip-eligible.
 *
 * Body and glass work is deliberately refused a flip offer, but it must still
 * get the body-shop soft referral rather than the generic residence/unknown
 * script, which says nothing about our shops at all. Chris's call: these jobs
 * are worth calling, they are just not worth pitching a mechanical flip at.
 */
function scenarioForNonEligible(
  destinationTag: string,
  decision: { bodyShopSoftMention?: boolean },
): ReturnType<typeof scenarioForDestinationTag> {
  if (decision.bodyShopSoftMention) return 'auto_body';
  return destinationTag === 'competitor_repair'
    ? scenarioForDestinationTag('unknown')
    : scenarioForDestinationTag(destinationTag);
}

function firstNameOf(full: string | null | undefined): string {
  const n = (full ?? '').trim();
  if (!n) return 'there';
  return n.split(/\s+/)[0];
}

/**
 * Session 49c — Flip orchestrator.
 *
 * Loop:
 * 1. Cron tick (default every 60s).
 * 2. For each tenant with `flip_engine_enabled = true`:
 *    a. Fetch new motor club jobs (Towbook + AAA) since last tick.
 *    b. For each new job, classify destination + issue.
 *    c. Decide flip eligibility (decideFlip).
 *    d. Build the script via flip-scripts renderers.
 *    e. Enqueue outbound call via OutboundVoiceService (custom template).
 *    f. Insert an outbound_call_logs row capturing all decisions.
 * 3. Move on. Errors per-job are logged but never abort the whole batch.
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
    private readonly geocoder: GeocoderService,
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
  /**
   * Session 74 — the conditional offer for calls whose destination the pre-call
   * map lookup could not resolve. See ScriptContext.conditionalShop.
   *
   * Returns a shop ONLY for `unknown` destinations that are otherwise
   * ineligible. Collision, glass, residence, our-shop and no-shop-in-range calls
   * all return null and keep their hard no-offer script — the point is to
   * recover the calls we simply did not know about, not to reopen a rule.
   */
  private async resolveConditionalShop(args: {
    tenantId: string;
    destinationTag: string;
    flipEligible: boolean;
    pickupLat: number | null | undefined;
    pickupLng: number | null | undefined;
    maxDistanceMiles: number;
  }): Promise<{ name: string | null; distanceMiles: number | null }> {
    const none = { name: null, distanceMiles: null };
    if (args.flipEligible || args.destinationTag !== 'unknown') return none;
    if (args.pickupLat == null || args.pickupLng == null) return none;

    const pick = await this.flipEngine.pickNearestShop({
      tenantId: args.tenantId,
      pickupLat: args.pickupLat,
      pickupLng: args.pickupLng,
      shopType: 'REPAIR',
    });
    if (!pick.shop || pick.distanceMiles == null || pick.distanceMiles > args.maxDistanceMiles) {
      return none;
    }
    return { name: pick.shop.name, distanceMiles: pick.distanceMiles };
  }

  async handleJob(
    tenantId: string,
    job: PendingFlipJob,
  ): Promise<boolean> {
    // Dedup: never enqueue the same job twice across server restarts.
    if (job.relatedJobId) {
      const existingCalls = await this.db
        .select({ id: outboundCalls.id })
        .from(outboundCalls)
        .where(
          and(
            eq(outboundCalls.tenantId, tenantId),
            eq(outboundCalls.relatedJobId, job.relatedJobId),
            eq(outboundCalls.purpose, 'custom')
          )
        )
        .limit(1);

      if (existingCalls.length > 0) {
        return false;
      }
    }

    // Pull tenant config + blocklist + our shops in parallel.
    const [config, blocklistRows, ourShops, globalConfig] = await Promise.all([
      this.flipEngine.getConfig(tenantId),
      this.flipEngine.listBlocklist(tenantId),
      this.flipEngine.listActiveShops(tenantId),
      this.flipEngine.getGlobalConfig() as Promise<Record<string, unknown>>,
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

    // 1b. Proximity Override: If Google found lat/lng, check if it's practically at one of our shops (within ~0.2 miles / ~300 meters)
    if (destination.tag !== 'our_shop' && destination.tag !== 'aaa_branded' && destination.resolvedLat != null && destination.resolvedLng != null) {
      for (const shop of ourShops) {
        if (shop.lat != null && shop.lng != null && shop.active) {
          const dist = haversineMiles(destination.resolvedLat, destination.resolvedLng, Number(shop.lat), Number(shop.lng));
          if (dist <= 0.2) {
            destination.tag = 'our_shop';
            destination.reason = `proximity_to_partner_shop_${shop.name}`;
            break;
          }
        }
      }
    }

    // 2. Classify issue.
    const issue: ClassifyIssueResult = this.issueClassifier.classify({
      reasonText: job.reasonText ?? null,
      vehicleNotes: job.vehicleNotes ?? null,
      motorClubServiceCode: job.motorClubServiceCode ?? null,
    });

    const callPolicy = await this.getAgentCallPolicy(tenantId, issue.subcategory);
    if (callPolicy.outboundCallMode !== 'AUTO' || !callPolicy.serviceEnabled) {
      this.logger.debug(
        `[flip-orchestrator] auto call skipped tenant=${tenantId} job=${job.jobId} mode=${callPolicy.outboundCallMode} service=${callPolicy.serviceName} enabled=${callPolicy.serviceEnabled}`,
      );
      return false;
    }

    // 3. Decide.
    const decision: FlipDecision = decideFlip({
      source: job.source,
      destinationTag: destination.tag,
      destinationReason: destination.reason,
      issueSubcategory: issue.subcategory,
      issueConfidence: issue.confidence,
      config: (config.config as Record<string, unknown>) ?? {},
    });

    // 4. Pick nearest shop (only when we'll actually pitch a flip).
    let nearestShopName: string | null = null;
    let distanceMilesSaved: number | null = null;
    const cfg = (config.config as Record<string, unknown>) ?? {};
    const globalCfg = (globalConfig as Record<string, unknown>) ?? {};
    if (decision.flipEligible && job.pickupLat != null && job.pickupLng != null) {
      const pick = await this.flipEngine.pickNearestShop({
        tenantId,
        pickupLat: job.pickupLat,
        pickupLng: job.pickupLng,
        shopType: 'REPAIR',
      });
      const maxDistance = Number(cfg.max_shop_distance_miles ?? globalCfg.max_shop_distance_miles ?? 100);
      if (pick.shop && pick.distanceMiles != null && pick.distanceMiles <= maxDistance) {
        nearestShopName = pick.shop.name;
        distanceMilesSaved = pick.distanceMiles;
      } else if (pick.shop) {
        this.logger.debug(
          `[flip-orchestrator] nearest shop ${pick.shop.name} is ${pick.distanceMiles} miles away, which exceeds max distance of ${maxDistance} miles. Suppressing flip.`,
        );
      }
    }

    // 5. Build the full scripted call body via the scenario engine.
    const mentionRentals = (cfg.mention_rentals ?? globalCfg.mention_rentals ?? true) !== false;
    const bodyShops = pickTwoBodyShops(ourShops);
    const scenario = scenarioForDestinationTag(destination.tag);

    // If we have a competitor_repair tag but couldn't find a nearest shop within max distance, fallback to Convini
    const flipEligible = decision.flipEligible && !!nearestShopName;

    const conditional = await this.resolveConditionalShop({
      tenantId,
      destinationTag: destination.tag,
      flipEligible,
      pickupLat: job.pickupLat,
      pickupLng: job.pickupLng,
      maxDistanceMiles: Number(
        cfg.max_shop_distance_miles ?? globalCfg.max_shop_distance_miles ?? 100,
      ),
    });
    const actualScenario = flipEligible ? scenario : scenarioForNonEligible(destination.tag, decision);

    const ctx: ScriptContext = {
      repName: (cfg.rep_name as string) || (globalCfg.rep_name as string) || '',
      companyName:
        job.companyName ??
        ((cfg.company_name as string) || (globalCfg.company_name as string) || 'Roadside Towing'),
      motorClub: job.motorClub ?? '',
      callbackNumber: (cfg.callback_number as string) || (globalCfg.callback_number as string) || '',
      conviniLink: (cfg.convini_link as string) || (globalCfg.convini_link as string) || 'https://convini.live',
      diagnosticValue: Number(cfg.diagnostic_value ?? globalCfg.diagnostic_value ?? 89),
      customerFirstName: firstNameOf(job.customerName),
      vehicle: formatVehicleYear(job.vehicle),
      pickupLocation: job.pickupAddress ?? 'your location',
      destination: destination.resolvedAddress ?? job.destinationAddress ?? 'your destination',
      issue: issuePhrase(issue.subcategory),
      issueSubcategory: issue.subcategory,
      nearestShop: flipEligible ? nearestShopName : null,
      nearestShopDistanceMiles:
        flipEligible && distanceMilesSaved != null ? Math.round(distanceMilesSaved) : null,
      conditionalShop: conditional.name,
      conditionalShopDistanceMiles:
        conditional.distanceMiles != null ? Math.round(conditional.distanceMiles) : null,
      bodyShop1: decision.bodyShopSoftMention ? bodyShops?.shop1 ?? null : null,
      bodyShop2: decision.bodyShopSoftMention ? bodyShops?.shop2 ?? null : null,
      rentalsAvailable: mentionRentals,
      pitchConvini: (cfg.pitch_convini ?? globalCfg.pitch_convini ?? true) !== false,
      customAgentRules:
        (cfg.custom_agent_rules as string) || (globalCfg.custom_agent_rules as string) || null,
      scriptBlocks: (cfg.script_blocks as Record<string, string>) || undefined,
      globalScriptBlocks: (globalCfg.script_blocks as Record<string, string>) || undefined,
    };
    const fullBody = renderCallBody(actualScenario, ctx);

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
        flipEligible: flipEligible,
        nearestOurShop: nearestShopName,
        noFlipReason: flipEligible ? null : (decision.flipEligible ? 'flip_suppressed_no_nearby_shop_within_max_distance' : decision.reasonCode),
        // Attribution: which script text actually produced this call.
        scriptVersion: SCRIPT_VERSION,
        scenario: actualScenario,
      })
      .returning({ id: outboundCallLogs.id });

    // 7. Enqueue the outbound call. Custom template + the rendered body
    //    in scriptVariables so OutboundVoiceService.enqueueCall renders
    //    `{{body}}` straight through.
    const maxRetries = Number(cfg.max_call_retries ?? globalCfg.max_call_retries ?? 0);
    try {
      await this.voice.enqueueCall({
        tenantId,
        purpose: 'custom',
        toPhone: job.customerPhone,
        toName: job.customerName,
        scriptTemplate: 'custom',
        scriptVariables: { body: fullBody },
        relatedJobId: job.relatedJobId ?? null,
        maxAttempts: maxRetries + 1,
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

  async sandboxAnalyze(
    tenantId: string,
    input: FlipSandboxInput,
  ): Promise<FlipSandboxResult> {
    const job = input.jobId
      ? await this.loadSandboxJob(tenantId, input.jobId)
      : manualSandboxJob(input);

    const [config, blocklistRows, ourShops, globalConfig] = await Promise.all([
      this.flipEngine.getConfig(tenantId),
      this.flipEngine.listBlocklist(tenantId),
      this.flipEngine.listActiveShops(tenantId),
      this.flipEngine.getGlobalConfig() as Promise<Record<string, unknown>>,
    ]);
    const blocklist = blocklistRows
      .filter((b) => b.active)
      .map((b) => ({
        matchType: b.matchType as 'NAME_PATTERN' | 'EXACT_NAME' | 'EXACT_ADDRESS' | 'PHONE',
        matchValue: b.matchValue,
        active: b.active,
      }));
    const ourShopNames = ourShops.map((s) => s.name.toLowerCase().trim());

    const destination = await this.destinationClassifier.classify({
      destinationName: job.destinationName ?? null,
      destinationAddress: job.destinationAddress ?? null,
      destinationPhone: job.destinationPhone ?? null,
      source: job.source,
      blocklist,
      ourShopNames,
    });

    if (destination.tag !== 'our_shop' && destination.tag !== 'aaa_branded' && destination.resolvedLat != null && destination.resolvedLng != null) {
      for (const shop of ourShops) {
        if (shop.lat != null && shop.lng != null && shop.active) {
          const dist = haversineMiles(destination.resolvedLat, destination.resolvedLng, Number(shop.lat), Number(shop.lng));
          if (dist <= 0.2) {
            destination.tag = 'our_shop';
            destination.reason = `proximity_to_partner_shop_${shop.name}`;
            break;
          }
        }
      }
    }

    const issue = this.issueClassifier.classify({
      reasonText: job.reasonText ?? null,
      vehicleNotes: job.vehicleNotes ?? null,
      motorClubServiceCode: job.motorClubServiceCode ?? null,
    });

    const cfg = (config.config as Record<string, unknown>) ?? {};
    const globalCfg = (globalConfig as Record<string, unknown>) ?? {};
    const decision = decideFlip({
      source: job.source,
      destinationTag: destination.tag,
      issueSubcategory: issue.subcategory,
      issueConfidence: issue.confidence,
      config: cfg,
    });

    let nearestShop: {
      name: string;
      distanceMiles: number | null;
      withinMaxDistance: boolean;
    } | null = null;
    let nearestShopName: string | null = null;
    let distanceMilesSaved: number | null = null;
    const maxDistance = Number(cfg.max_shop_distance_miles ?? globalCfg.max_shop_distance_miles ?? 100);
    if (decision.flipEligible && job.pickupLat != null && job.pickupLng != null) {
      const pick = await this.flipEngine.pickNearestShop({
        tenantId,
        pickupLat: job.pickupLat,
        pickupLng: job.pickupLng,
        shopType: 'REPAIR',
      });
      if (pick.shop) {
        const withinMaxDistance = pick.distanceMiles != null && pick.distanceMiles <= maxDistance;
        nearestShop = {
          name: pick.shop.name,
          distanceMiles: pick.distanceMiles,
          withinMaxDistance,
        };
        if (withinMaxDistance) {
          nearestShopName = pick.shop.name;
          distanceMilesSaved = pick.distanceMiles;
        }
      }
    }

    const scenario = scenarioForDestinationTag(destination.tag);
    const flipEligible = decision.flipEligible && !!nearestShopName;
    const actualScenario = flipEligible ? scenario : scenarioForNonEligible(destination.tag, decision);
    const mentionRentals = (cfg.mention_rentals ?? globalCfg.mention_rentals ?? true) !== false;
    const bodyShops = pickTwoBodyShops(ourShops);
    const ctx: ScriptContext = {
      repName: (cfg.rep_name as string) || (globalCfg.rep_name as string) || '',
      companyName:
        job.companyName ??
        ((cfg.company_name as string) || (globalCfg.company_name as string) || 'Roadside Towing'),
      motorClub: job.motorClub ?? '',
      callbackNumber: (cfg.callback_number as string) || (globalCfg.callback_number as string) || '',
      conviniLink: (cfg.convini_link as string) || (globalCfg.convini_link as string) || 'https://convini.live',
      diagnosticValue: Number(cfg.diagnostic_value ?? globalCfg.diagnostic_value ?? 89),
      customerFirstName: firstNameOf(job.customerName),
      vehicle: formatVehicleYear(job.vehicle),
      pickupLocation: job.pickupAddress ?? 'your location',
      destination: destination.resolvedAddress ?? job.destinationAddress ?? 'your destination',
      issue: issuePhrase(issue.subcategory),
      issueSubcategory: issue.subcategory,
      nearestShop: flipEligible ? nearestShopName : null,
      nearestShopDistanceMiles:
        flipEligible && distanceMilesSaved != null ? Math.round(distanceMilesSaved) : null,
      bodyShop1: decision.bodyShopSoftMention ? bodyShops?.shop1 ?? null : null,
      bodyShop2: decision.bodyShopSoftMention ? bodyShops?.shop2 ?? null : null,
      rentalsAvailable: mentionRentals,
      pitchConvini: (cfg.pitch_convini ?? globalCfg.pitch_convini ?? true) !== false,
      customAgentRules:
        (cfg.custom_agent_rules as string) || (globalCfg.custom_agent_rules as string) || null,
      scriptBlocks: (cfg.script_blocks as Record<string, string>) || undefined,
      globalScriptBlocks: (globalCfg.script_blocks as Record<string, string>) || undefined,
    };

    return {
      dryRun: true,
      job,
      destination,
      issue,
      decision,
      nearestShop,
      maxShopDistanceMiles: maxDistance,
      final: {
        wouldCall: !!job.customerPhone,
        wouldPitchFlip: flipEligible,
        scenario: actualScenario,
        reason: flipEligible
          ? 'flip_offer_ready'
          : decision.flipEligible
            ? 'flip_suppressed_no_nearby_shop_within_max_distance'
            : decision.reasonCode,
      },
      scriptPreview: renderCallBody(actualScenario, ctx),
    };
  }

  private async loadSandboxJob(tenantId: string, jobId: string): Promise<PendingFlipJob> {
    const row = await this.db.query.unifiedJobs.findFirst({
      where: and(eq(unifiedJobs.id, jobId), eq(unifiedJobs.tenantId, tenantId)),
    });
    if (!row) {
      throw new NotFoundException({ status: 'error', code: 'JOB_NOT_FOUND' });
    }
    return unifiedJobToPendingFlipJob(row as UnifiedJobRow);
  }

  async callUnifiedJobManually(
    tenantId: string,
    jobId: string,
    opts: { scriptType?: ManualCallScriptType } = {},
  ): Promise<{ status: 'queued' | 'skipped'; message: string }> {
    const row = await this.db.query.unifiedJobs.findFirst({
      where: and(eq(unifiedJobs.id, jobId), eq(unifiedJobs.tenantId, tenantId)),
    });
    if (!row) {
      throw new NotFoundException({ status: 'error', code: 'JOB_NOT_FOUND' });
    }
    if (!row.callerPhone) {
      await this.voice.notifyManagersOfJobAttention({
        tenantId,
        jobId: row.id,
        customerName: row.callerName,
        customerPhone: row.callerPhone,
        reason: 'missing or incomplete customer phone number',
      });
      return { status: 'skipped', message: 'Job has no caller phone number.' };
    }

    const scriptType = opts.scriptType ?? 'auto_flip';
    if (scriptType === 'auto_flip') {
      await this.handleNewlyCreatedJob(tenantId, row as UnifiedJobRow, { automatic: false });
      return { status: 'queued', message: 'Customer call queued if this job has not already been called.' };
    }

    await this.enqueueManualScriptCall(tenantId, row as UnifiedJobRow, scriptType);
    return { status: 'queued', message: `Customer call queued with ${manualScriptLabel(scriptType)} script.` };
  }

  private async enqueueManualScriptCall(
    tenantId: string,
    job: UnifiedJobRow,
    scriptType: ManualCallScriptType,
  ): Promise<void> {
    if (!job.callerPhone) return;

    const tenantRows = await this.db
      .select({
        outboundVoiceEnabled: tenants.outboundVoiceEnabled,
        outboundVoiceConfig: tenants.outboundVoiceConfig,
        flipEngineConfig: tenants.flipEngineConfig,
        companyName: tenants.companyName,
        managerPhones: tenants.managerPhones,
        assignedPhoneNumber: tenants.assignedPhoneNumber,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const tenant = tenantRows[0];
    if (!tenant?.outboundVoiceEnabled) {
      throw new BadRequestException('Outbound AI calls are off for this account.');
    }
    if (demoCallsBlocked(tenant.outboundVoiceConfig)) {
      throw new BadRequestException('Demo calls are disabled for this account.');
    }

    const issue = this.issueClassifier.classify({
      reasonText: job.serviceType ?? null,
      vehicleNotes: null,
      motorClubServiceCode: job.serviceType ?? null,
    });
    const callPolicy = await this.getAgentCallPolicy(tenantId, issue.subcategory);
    if (callPolicy.outboundCallMode === 'OFF' || !callPolicy.serviceEnabled) {
      throw new BadRequestException(
        `${callPolicy.serviceName} is not enabled for AI customer calls.`,
      );
    }

    const globalConfig = await this.flipEngine.getGlobalConfig();
    const cfg = (tenant.flipEngineConfig as Record<string, unknown>) ?? {};
    const globalCfg = (globalConfig as Record<string, unknown>) ?? {};
    const callbackNumber =
      (cfg.callback_number as string) ||
      (globalCfg.callback_number as string) ||
      readFirstManagerPhone(tenant.managerPhones) ||
      tenant.assignedPhoneNumber ||
      '';

    await this.voice.enqueueCall({
      tenantId,
      purpose: 'custom',
      toPhone: job.callerPhone,
      toName: job.callerName ?? '',
      scriptTemplate: 'custom',
      scriptVariables: {
        body: renderManualScript(scriptType, {
          repName: (cfg.rep_name as string) || (globalCfg.rep_name as string) || 'Emily',
          companyName:
            (cfg.company_name as string) ||
            (globalCfg.company_name as string) ||
            tenant.companyName ||
            'Roadside Towing',
          customerFirstName: firstNameOf(job.callerName),
          vehicle:
            [job.vehicleYear, job.vehicleColor, job.vehicleMake, job.vehicleModel]
              .filter(Boolean)
              .join(' ') || 'your vehicle',
          pickupLocation: job.pickupAddress ?? 'your service location',
          destination: job.dropoffAddress ?? '',
          issue: issuePhrase(issue.subcategory),
          etaMinutes: job.etaMinutes,
          callbackNumber,
          conviniLink: (cfg.convini_link as string) || (globalCfg.convini_link as string) || 'https://convini.live',
          diagnosticValue: Number(cfg.diagnostic_value ?? globalCfg.diagnostic_value ?? 89),
        }),
      },
      relatedJobId: job.id,
      dedupeRelatedJob: false,
    });
  }

  async pingSandbox(tenantId: string, toPhone: string): Promise<void> {
    const [config, globalConfig] = await Promise.all([
      this.flipEngine.getConfig(tenantId),
      this.flipEngine.getGlobalConfig() as Promise<Record<string, unknown>>,
    ]);

    const cfg = (config.config as Record<string, unknown>) ?? {};
    const globalCfg = (globalConfig as Record<string, unknown>) ?? {};

    const tenantRows = await this.db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const tenant = tenantRows[0];

    const repName = (cfg.rep_name as string) || (globalCfg.rep_name as string) || 'Emily';
    const companyName = (cfg.company_name as string) || (globalCfg.company_name as string) || tenant?.companyName || 'Roadside Towing';
    const callbackNumber = (cfg.callback_number as string) || (globalCfg.callback_number as string) || tenant?.assignedPhoneNumber || '';

    const body = `Hi there! This is ${repName}, an AI agent for ${companyName}. This is a test ping from your support dashboard to verify that your voice settings and telecom routing are fully operational. Everything looks good. Please remember that if anything changes, you can reach us at <say-as interpret-as="telephone">${callbackNumber}</say-as>. Have a great day!`;

    await this.voice.enqueueCall({
      tenantId,
      purpose: 'custom',
      toPhone,
      toName: 'Sandbox Test',
      scriptTemplate: 'custom',
      scriptVariables: { body },
      dedupeRelatedJob: false,
    });
  }

  /**
   * Enqueue ONE combined welcome call on a newly-created unified_jobs row.
   *
   * Gated on tenant.outbound_voice_enabled (NOT the flip flag) so the
   * welcome call works for any tenant that has opted into outbound voice,
   * regardless of whether the flip engine is turned on.
   *
   * Script: confirm details + convini pitch always. Flip offers are layered
   * in ONLY when the dropoff address classifies as a competing repair shop
   * (destination.tag === 'competitor_repair'), so the call stays concise for
   * jobs heading to the customer's home or a dealer.
   *
   * Dedup: uses the same in-memory `seen` map as the flip cron, keyed on
   * `welcome:${tenantId}:${job.id}`, so a job that was already welcomed is
   * never called a second time even if the cron tick fires concurrently.
   */
  async handleNewlyCreatedJob(
    tenantId: string,
    job: UnifiedJobRow,
    opts: { automatic?: boolean } = {},
  ): Promise<void> {
    const automatic = opts.automatic ?? true;
    const seenKey = `welcome:${tenantId}:${job.id}`;
    if (automatic && this.seen.has(seenKey)) return;

    // Skip if no phone number — nothing to call.
    if (!job.callerPhone) {
      if (automatic) this.seen.set(seenKey, Date.now());
      await this.voice.notifyManagersOfJobAttention({
        tenantId,
        jobId: job.id,
        customerName: job.callerName,
        customerPhone: job.callerPhone,
        reason: 'missing or incomplete customer phone number',
      });
      return;
    }

    // Dedup: never enqueue the same job twice.
    // DB-level deduplication to prevent looping across server restarts
    const existingCalls = await this.db
      .select({ id: outboundCalls.id })
      .from(outboundCalls)
      .where(
        and(
          eq(outboundCalls.tenantId, tenantId),
          eq(outboundCalls.relatedJobId, job.id),
          eq(outboundCalls.purpose, 'custom')
        )
      )
      .limit(1);

    if (existingCalls.length > 0) {
      this.seen.set(seenKey, Date.now()); // populate memory cache too
      return;
    }

    if (automatic) this.seen.set(seenKey, Date.now());

    try {
      // Gate: only proceed if tenant has opted into outbound voice.
      const tenantRows = await this.db
        .select({
          outboundVoiceEnabled: tenants.outboundVoiceEnabled,
          outboundVoiceConfig: tenants.outboundVoiceConfig,
          flipEngineConfig: tenants.flipEngineConfig,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      const tenant = tenantRows[0];
      if (!tenant?.outboundVoiceEnabled) {
        if (!automatic) throw new BadRequestException('Outbound AI calls are off for this account.');
        return;
      }
      if (demoCallsBlocked(tenant.outboundVoiceConfig)) {
        if (!automatic) throw new BadRequestException('Demo calls are disabled for this account.');
        return;
      }

      const issue = this.issueClassifier.classify({
        reasonText: job.serviceType ?? null,
        vehicleNotes: null,
        motorClubServiceCode: job.serviceType ?? null,
      });
      const callPolicy = await this.getAgentCallPolicy(tenantId, issue.subcategory);
      if (callPolicy.outboundCallMode === 'OFF' || !callPolicy.serviceEnabled) {
        if (!automatic) {
          throw new BadRequestException(
            `${callPolicy.serviceName} is not enabled for AI customer calls.`,
          );
        }
        return;
      }
      if (automatic && callPolicy.outboundCallMode !== 'AUTO') return;

      // Classify destination to decide whether to layer in flip offers.
      const [blocklistRows, ourShops, globalConfig] = await Promise.all([
        this.flipEngine.listBlocklist(tenantId),
        this.flipEngine.listActiveShops(tenantId),
        this.flipEngine.getGlobalConfig(),
      ]);
      const blocklist = blocklistRows
        .filter((b) => b.active)
        .map((b) => ({
          matchType: b.matchType as 'NAME_PATTERN' | 'EXACT_NAME' | 'EXACT_ADDRESS' | 'PHONE',
          matchValue: b.matchValue,
          active: b.active,
        }));
      const ourShopNames = ourShops.map((s) => s.name.toLowerCase().trim());

      const destination: ClassifyDestinationResult = await this.destinationClassifier.classify({
        destinationName: null,
        destinationAddress: job.dropoffAddress ?? null,
        destinationPhone: null,
        source: job.source,
        blocklist,
        ourShopNames,
      });

      const globalCfg = (globalConfig as Record<string, unknown>) ?? {};
      const cfg = (tenant.flipEngineConfig as Record<string, unknown>) ?? {};

      const decision = decideFlip({
        source: job.source,
        destinationTag: destination.tag,
        issueSubcategory: issue.subcategory,
        issueConfidence: issue.confidence,
        config: cfg,
      });

      // Flip pick only when destination is a competing repair shop and issue is eligible.
      let nearestShopName: string | null = null;
      let distanceMilesSaved: number | null = null;
      if (decision.flipEligible && job.pickupLat != null && job.pickupLng != null) {
        const pick = await this.flipEngine.pickNearestShop({
          tenantId,
          pickupLat: Number(job.pickupLat),
          pickupLng: Number(job.pickupLng),
          shopType: 'REPAIR',
        });
        const maxDistance = Number(cfg.max_shop_distance_miles ?? globalCfg.max_shop_distance_miles ?? 100);
        if (pick.shop && pick.distanceMiles != null && pick.distanceMiles <= maxDistance) {
          nearestShopName = pick.shop.name;
          distanceMilesSaved = pick.distanceMiles;
        } else if (pick.shop) {
          this.logger.debug(
            `[flip-orchestrator] newly created job nearest shop ${pick.shop.name} is ${pick.distanceMiles} miles away, exceeding max distance of ${maxDistance} miles. Suppressing flip.`,
          );
        }
      }

      const scenario = scenarioForDestinationTag(destination.tag);
      const flipEligible = decision.flipEligible && !!nearestShopName;
      const actualScenario = flipEligible ? scenario : scenarioForNonEligible(destination.tag, decision);
      const mentionRentals = (cfg.mention_rentals ?? globalCfg.mention_rentals ?? true) !== false;

      const conditional = await this.resolveConditionalShop({
        tenantId,
        destinationTag: destination.tag,
        flipEligible,
        pickupLat: job.pickupLat != null ? Number(job.pickupLat) : null,
        pickupLng: job.pickupLng != null ? Number(job.pickupLng) : null,
        maxDistanceMiles: Number(
          cfg.max_shop_distance_miles ?? globalCfg.max_shop_distance_miles ?? 100,
        ),
      });

      const ctx: ScriptContext = {
        repName: (cfg.rep_name as string) || (globalCfg.rep_name as string) || '',
        companyName: (cfg.company_name as string) || (globalCfg.company_name as string) || 'Roadside Towing',
        motorClub: '',
        callbackNumber: (cfg.callback_number as string) || (globalCfg.callback_number as string) || '',
        conviniLink: (cfg.convini_link as string) || (globalCfg.convini_link as string) || 'https://convini.live',
        diagnosticValue: Number(cfg.diagnostic_value ?? globalCfg.diagnostic_value ?? 89),
        customerFirstName: firstNameOf(job.callerName),
        vehicle:
          [job.vehicleYear, job.vehicleColor, job.vehicleMake, job.vehicleModel]
            .filter(Boolean)
            .join(' ') || 'your vehicle',
        pickupLocation: job.pickupAddress ?? 'your location',
        destination: destination.resolvedAddress ?? job.dropoffAddress ?? 'your destination',
        issue: issuePhrase(issue.subcategory),
        issueSubcategory: issue.subcategory,
        nearestShop: flipEligible ? nearestShopName : null,
        nearestShopDistanceMiles:
          flipEligible && distanceMilesSaved != null ? Math.round(distanceMilesSaved) : null,
        conditionalShop: conditional.name,
        conditionalShopDistanceMiles:
          conditional.distanceMiles != null ? Math.round(conditional.distanceMiles) : null,
        bodyShop1: null,
        bodyShop2: null,
        rentalsAvailable: mentionRentals,
        pitchConvini: (cfg.pitch_convini ?? globalCfg.pitch_convini ?? true) !== false,
        customAgentRules: (cfg.custom_agent_rules as string) || (globalCfg.custom_agent_rules as string) || null,
        scriptBlocks: (cfg.script_blocks as Record<string, string>) || undefined,
        globalScriptBlocks: (globalCfg.script_blocks as Record<string, string>) || undefined,
      };

      const fullBody = renderCallBody(actualScenario, ctx);

      // Persist log row to Activity tab
      const [logRow] = await this.db
        .insert(outboundCallLogs)
        .values({
          tenantId,
          customerName: job.callerName ?? 'Unknown',
          customerPhone: job.callerPhone,
          motorClub: null,
          vehicle: [job.vehicleYear, job.vehicleColor, job.vehicleMake, job.vehicleModel].filter(Boolean).join(' ') || null,
          issueType: issue.subcategory,
          originalDestination: job.dropoffAddress ?? null,
          destinationBusinessName: destination.resolvedName ?? null,
          destinationType: destination.tag,
          flipEligible: flipEligible,
          nearestOurShop: nearestShopName,
          noFlipReason: flipEligible ? null : (decision.flipEligible ? 'flip_suppressed_no_nearby_shop_within_max_distance' : decision.reasonCode),
          // Attribution: which script text actually produced this call.
          scriptVersion: SCRIPT_VERSION,
          scenario: actualScenario,
        })
        .returning({ id: outboundCallLogs.id });

      try {
        await this.voice.enqueueCall({
          tenantId,
          purpose: 'custom',
          toPhone: job.callerPhone,
          toName: job.callerName ?? '',
          scriptTemplate: 'custom',
          scriptVariables: { body: fullBody },
          relatedJobId: job.id,
        });
      } catch (err) {
        this.logger.warn(
          `[flip-orchestrator] enqueue failed for newly created job ${job.id}: ${(err as Error).message}`,
        );
        await this.db
          .update(outboundCallLogs)
          .set({ flipOutcome: 'ENQUEUE_FAILED' })
          .where(eq(outboundCallLogs.id, logRow.id));
      }
    } catch (err) {
      this.logger.warn(
        `[flip-orchestrator] handleNewlyCreatedJob ${job.id} threw: ${(err as Error).message}`,
      );
      // Remove from seen so a retry on the next tick is possible.
      if (automatic) this.seen.delete(seenKey);
      if (!automatic) throw err;
    }
  }

  private gcSeen() {
    const cutoff = Date.now() - this.RETAIN_MS;
    for (const [k, t] of this.seen) {
      if (t < cutoff) this.seen.delete(k);
    }
  }

  private async getAgentCallPolicy(
    tenantId: string,
    issueSubcategory: string | null | undefined,
  ): Promise<{
    outboundCallMode: 'AUTO' | 'MANUAL_ONLY' | 'OFF';
    serviceName: string;
    serviceEnabled: boolean;
  }> {
    const row = await this.db.query.aiAgentConfigs.findFirst({
      where: eq(aiAgentConfigs.tenantId, tenantId),
    });
    const toggles = (row?.serviceToggles as Record<string, unknown> | null) ?? {};
    const settings = toggles.__settings as { outboundCallMode?: unknown } | undefined;
    const outboundCallMode =
      settings?.outboundCallMode === 'MANUAL_ONLY' || settings?.outboundCallMode === 'OFF'
        ? settings.outboundCallMode
        : 'AUTO';
    const serviceName = serviceNameForIssue(issueSubcategory);
    const service = toggles[serviceName] as { enabled?: unknown } | undefined;
    return {
      outboundCallMode,
      serviceName,
      // Backward-compatible: old tenants with no toggle row keep previous behavior.
      serviceEnabled: service?.enabled !== false,
    };
  }

  /**
   * Simulates a live call flow from the Test Agent Modal, returning the synchronous call result.
   */
  async simulateLiveCall(
    tenantId: string,
    input: {
      toPhone: string;
      customerName?: string;
      vehicle?: string;
      destination?: string;
      pickupLocation?: string;
      motorClub?: string;
    },
  ): Promise<any> {
    const [config, blocklistRows, ourShops, globalConfig] = await Promise.all([
      this.flipEngine.getConfig(tenantId),
      this.flipEngine.listBlocklist(tenantId),
      this.flipEngine.listActiveShops(tenantId),
      this.flipEngine.getGlobalConfig() as Promise<Record<string, unknown>>,
    ]);

    const blocklist = blocklistRows
      .filter((b) => b.active)
      .map((b) => ({
        matchType: b.matchType as 'NAME_PATTERN' | 'EXACT_NAME' | 'EXACT_ADDRESS' | 'PHONE',
        matchValue: b.matchValue,
        active: b.active,
      }));
    const ourShopNames = ourShops.map((s) => s.name.toLowerCase().trim());

    const geocoded = input.pickupLocation ? await this.geocoder.geocode(input.pickupLocation) : null;

    const destination = await this.destinationClassifier.classify({
      destinationName: null,
      destinationAddress: input.destination ?? null,
      destinationPhone: null,
      source: 'SIMULATION',
      blocklist,
      ourShopNames,
    });

    const issue = this.issueClassifier.classify({
      reasonText: null,
      vehicleNotes: null,
      motorClubServiceCode: null,
    });

    const cfg = (config.config as Record<string, unknown>) ?? {};
    const globalCfg = (globalConfig as Record<string, unknown>) ?? {};
    const decision = decideFlip({
      source: 'SIMULATION',
      destinationTag: destination.tag,
      issueSubcategory: issue.subcategory,
      issueConfidence: issue.confidence,
      config: cfg,
    });

    let nearestShopName: string | null = null;
    let distanceMilesSaved: number | null = null;
    if (decision.flipEligible && geocoded) {
      const pick = await this.flipEngine.pickNearestShop({
        tenantId,
        pickupLat: geocoded.lat,
        pickupLng: geocoded.lng,
        shopType: 'REPAIR',
      });
      const maxDistance = Number(cfg.max_shop_distance_miles ?? globalCfg.max_shop_distance_miles ?? 100);
      if (pick.shop && pick.distanceMiles != null && pick.distanceMiles <= maxDistance) {
        nearestShopName = pick.shop.name;
        distanceMilesSaved = pick.distanceMiles;
      } else if (pick.shop) {
        this.logger.debug(
          `[flip-orchestrator] simulateLiveCall nearest shop ${pick.shop.name} is ${pick.distanceMiles} miles away, exceeding max distance of ${maxDistance} miles. Suppressing flip.`,
        );
      }
    }

    const mentionRentals = (cfg.mention_rentals ?? globalCfg.mention_rentals ?? true) !== false;
    const bodyShops = pickTwoBodyShops(ourShops);
    const scenario = scenarioForDestinationTag(destination.tag);
    
    // If we have a car_repair tag but couldn't find a nearest shop, fallback to Convini
    const flipEligible = destination.tag === 'competitor_repair' && !!nearestShopName;
    const actualScenario = flipEligible ? scenario : scenarioForNonEligible(destination.tag, decision);

    const ctx: ScriptContext = {
      repName: (cfg.rep_name as string) || (globalCfg.rep_name as string) || '',
      companyName: (cfg.company_name as string) || (globalCfg.company_name as string) || 'Roadside Towing',
      motorClub: input.motorClub || '',
      callbackNumber: (cfg.callback_number as string) || (globalCfg.callback_number as string) || '',
      conviniLink: (cfg.convini_link as string) || (globalCfg.convini_link as string) || 'https://convini.live',
      diagnosticValue: Number(cfg.diagnostic_value ?? globalCfg.diagnostic_value ?? 89),
      customerFirstName: firstNameOf(input.customerName),
      vehicle: input.vehicle || 'your vehicle',
      pickupLocation: input.pickupLocation || 'your location',
      destination: destination.resolvedAddress ?? input.destination ?? 'your destination',
      issue: issuePhrase(issue.subcategory),
      issueSubcategory: issue.subcategory,
      nearestShop: flipEligible ? nearestShopName : null,
      nearestShopDistanceMiles: flipEligible && distanceMilesSaved != null ? Math.round(distanceMilesSaved) : null,
      bodyShop1: decision.bodyShopSoftMention ? bodyShops?.shop1 ?? null : null,
      bodyShop2: decision.bodyShopSoftMention ? bodyShops?.shop2 ?? null : null,
      rentalsAvailable: mentionRentals,
      pitchConvini: (cfg.pitch_convini ?? globalCfg.pitch_convini ?? true) !== false,
      customAgentRules:
        (cfg.custom_agent_rules as string) || (globalCfg.custom_agent_rules as string) || null,
      scriptBlocks: (cfg.script_blocks as Record<string, string>) || undefined,
      globalScriptBlocks: (globalCfg.script_blocks as Record<string, string>) || undefined,
    };

    const fullBody = renderCallBody(actualScenario, ctx);

    return this.voice.testCall(tenantId, {
      toPhone: input.toPhone,
      customerName: input.customerName,
      vehicle: input.vehicle,
      destination: destination.resolvedAddress ?? input.destination,
      pickupLocation: input.pickupLocation,
      motorClub: input.motorClub,
      scriptBody: fullBody,
    });
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
  relatedJobId?: string | null;
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

export interface FlipSandboxInput {
  jobId?: string;
  source?: string;
  customerName?: string | null;
  customerPhone?: string | null;
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

export interface FlipSandboxResult {
  dryRun: true;
  job: PendingFlipJob;
  destination: ClassifyDestinationResult;
  issue: ClassifyIssueResult;
  decision: FlipDecision;
  nearestShop: {
    name: string;
    distanceMiles: number | null;
    withinMaxDistance: boolean;
  } | null;
  maxShopDistanceMiles: number;
  final: {
    wouldCall: boolean;
    wouldPitchFlip: boolean;
    scenario: string;
    reason: string;
  };
  scriptPreview: string;
}

function manualSandboxJob(input: FlipSandboxInput): PendingFlipJob {
  return {
    source: input.source ?? 'SANDBOX',
    jobId: 'manual-sandbox',
    relatedJobId: null,
    customerName: input.customerName ?? 'Sandbox Customer',
    customerPhone: input.customerPhone ?? '',
    vehicle: input.vehicle ?? null,
    motorClub: input.motorClub ?? null,
    motorClubServiceCode: input.motorClubServiceCode ?? null,
    reasonText: input.reasonText ?? null,
    vehicleNotes: input.vehicleNotes ?? null,
    pickupAddress: input.pickupAddress ?? null,
    pickupLat: input.pickupLat ?? null,
    pickupLng: input.pickupLng ?? null,
    destinationName: input.destinationName ?? null,
    destinationAddress: input.destinationAddress ?? null,
    destinationPhone: input.destinationPhone ?? null,
    companyName: input.companyName ?? null,
  };
}

function unifiedJobToPendingFlipJob(row: UnifiedJobRow): PendingFlipJob {
  return {
    source: row.source,
    jobId: row.sourceJobId ?? row.id,
    relatedJobId: row.id,
    customerName: row.callerName ?? '',
    customerPhone: row.callerPhone ?? '',
    vehicle:
      [row.vehicleYear, row.vehicleColor, row.vehicleMake, row.vehicleModel]
        .filter(Boolean)
        .join(' ') || null,
    motorClub: null,
    motorClubServiceCode: row.serviceType ?? null,
    reasonText: row.serviceType ?? null,
    vehicleNotes: null,
    pickupAddress: row.pickupAddress ?? null,
    pickupLat: row.pickupLat != null ? Number(row.pickupLat) : null,
    pickupLng: row.pickupLng != null ? Number(row.pickupLng) : null,
    destinationName: null,
    destinationAddress: row.dropoffAddress ?? null,
    destinationPhone: null,
    companyName: null,
  };
}

function serviceNameForIssue(issueSubcategory: string | null | undefined): string {
  switch (issueSubcategory) {
    case 'jump_start':
      return 'Jump Start';
    case 'single_tire_issue':
    case 'full_tire_set':
      return 'Tire Change';
    case 'fuel_delivery':
      return 'Fuel Delivery';
    case 'lockout':
      return 'Lockout Service';
    case 'winch_out':
      return 'Winch Out & Recovery';
    default:
      return 'Towing';
  }
}

function demoCallsBlocked(config: unknown): boolean {
  const cfg = (config as Record<string, unknown> | null | undefined) ?? {};
  return cfg.demo_mode === true && cfg.demo_calls_enabled !== true;
}

function manualScriptLabel(scriptType: ManualCallScriptType): string {
  switch (scriptType) {
    case 'eta_confirmation':
      return 'ETA confirmation';
    case 'status_update':
      return 'status update';
    case 'winch_out':
      return 'winch-out';
    case 'convini_only':
      return 'CONVINI only';
    default:
      return 'auto flip';
  }
}

function renderManualScript(
  scriptType: ManualCallScriptType,
  vars: {
    repName: string;
    companyName: string;
    customerFirstName: string;
    vehicle: string;
    pickupLocation: string;
    destination: string;
    issue: string;
    etaMinutes: number | null;
    callbackNumber: string;
    conviniLink: string;
    diagnosticValue?: number | null;
  },
): string {
  const eta = vars.etaMinutes != null ? `${vars.etaMinutes} minutes` : 'as soon as possible';
  const destinationLine = vars.destination
    ? `I have the destination as ${vars.destination}.`
    : 'I do not have a separate delivery address on this job.';
  const callbackLine = vars.callbackNumber
    ? `If anything changes, please call us back at ${vars.callbackNumber}.`
    : 'If anything changes, please call dispatch back.';

  switch (scriptType) {
    case 'eta_confirmation':
      return [
        `Hi, this is ${vars.repName} calling from ${vars.companyName} about the tow request. I'm the AI assistant helping confirm the details. Am I speaking with ${vars.customerFirstName}?`,
        `I am calling to confirm your roadside service. I have the pickup as ${vars.pickupLocation}.`,
        destinationLine,
        `Your driver should arrive in about ${eta}. Please stay in a safe location while you wait.`,
        callbackLine,
      ].join('\n');
    case 'status_update':
      return [
        `Hi, this is ${vars.repName} calling from ${vars.companyName} about the service request. I'm the AI assistant helping confirm the details. Am I speaking with ${vars.customerFirstName}?`,
        `I am calling with an update on your service request for ${vars.vehicle}.`,
        `We have the issue listed as ${vars.issue}, and the pickup as ${vars.pickupLocation}.`,
        `Your request is active and our team is working on it now.`,
        callbackLine,
      ].join('\n');
    case 'winch_out':
      return [
        `Hi, this is ${vars.repName} calling from ${vars.companyName} about the recovery request. I'm the AI assistant helping confirm the details. Am I speaking with ${vars.customerFirstName}?`,
        `I am calling about your winch-out or recovery request at ${vars.pickupLocation}.`,
        'A winch-out usually means we come to get the vehicle back onto solid ground.',
        'Please have a few photos of the situation ready. When the driver calls, they may ask you to text those photos so they can see the depth of the problem before they arrive.',
        'Do not worry about a delivery destination unless the driver confirms a tow is also needed after the recovery.',
        callbackLine,
      ].join('\n');
    case 'convini_only':
      return [
        `Hi, this is ${vars.repName} calling from ${vars.companyName} about the service request. I'm the AI assistant helping confirm the details. Am I speaking with ${vars.customerFirstName}?`,
        `I am calling to quickly confirm your service request at ${vars.pickupLocation}.`,
        `I'm texting you the free CONVINIcar app link now so you can track this service live and request help faster next time.`,
        callbackLine,
      ].join('\n');
    default:
      return '';
  }
}

function readFirstManagerPhone(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const first = raw.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return first?.trim() ?? null;
}

/**
 * Pronounces 4-digit years correctly (e.g. "2015" -> "twenty fifteen")
 * and strips out license plates / VINs so they aren't read aloud.
 */
function formatVehicleYear(vehicle: string | null | undefined): string {
  if (!vehicle) return 'your vehicle';
  
  // Strip license plates / VINs
  let clean = vehicle.split(/(?:\/|\||\n| - )/)[0].trim();
  clean = clean.replace(/\b(?:LP|Lic(?:ense)?(?: Plate)?|Plate|VIN)[:#-]?\s*[A-Z0-9]+\b.*/i, '').trim();
  
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  
  return clean.replace(/\b(19|20)(\d{2})\b/g, (match, century, year) => {
    const y = Number(year);
    if (century === '20') {
      if (y === 0) return 'two thousand';
      if (y < 10) return `two thousand ${ones[y]}`;
      if (y < 20) return `twenty ${ones[y]}`;
      return `twenty ${tens[Math.floor(y/10)]} ${ones[y%10]}`.trim();
    }
    if (century === '19') {
      if (y === 0) return 'nineteen hundred';
      if (y < 20) return `nineteen ${ones[y]}`;
      return `nineteen ${tens[Math.floor(y/10)]} ${ones[y%10]}`.trim();
    }
    return match;
  });
}
