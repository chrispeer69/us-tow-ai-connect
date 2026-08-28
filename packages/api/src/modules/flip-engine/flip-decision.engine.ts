import type { DestinationTag } from './destination-classifier.service';
import type { IssueSubcategory } from './issue-classifier.service';

export interface FlipDecisionInput {
  source: 'TOWBOOK' | 'AAA_PORTAL' | string;
  destinationTag: DestinationTag;
  issueSubcategory: IssueSubcategory;
  issueConfidence: number;
  config: {
    no_flip_confidence_threshold?: number;
    no_flip_categories?: string[];
  };
  destinationReason?: string;
  vehicleMake?: string | null;
}

export interface FlipDecision {
  flipEligible: boolean;
  conviniIntensity: 'soft' | 'medium' | 'hard';
  bodyShopSoftMention: boolean;
  reasonCode: string;
}

const DEFAULT_NO_FLIP_THRESHOLD = 0.85;
const DEFAULT_NO_FLIP_CATEGORIES: IssueSubcategory[] = [
  // 'single_tire_issue' was here until 2026-08-13. Removed on Chris's call.
  //
  // The reasoning it encoded — one tire is not worth much — was about the
  // VALUE of the job, not about whether an offer belongs on the call. Those are
  // different questions. A single tire still arrives at somebody's shop, and
  // giving that away for free was the actual cost: the 08-11 review found the
  // agent suppressing tire calls unprompted, and one of that day's two wins was
  // a tire blowout it pitched anyway.
  //
  // Note the classifier already splits `full_tire_set` out separately, and that
  // was never on this list — so removing this only affects genuine single-tire
  // jobs, which are exactly the ones being handed to competitors.
  'jump_start',
  'lockout',
  'fuel_delivery',
  'winch_out',
  'accident_with_airbags',
];

/**
 * Session 74 — body and glass work, refused REGARDLESS of classifier confidence.
 *
 * From the 2026-08-11 review: four customers with collision or glass damage were
 * offered a free MECHANICAL diagnostic at a brake shop; all declined instantly
 * and two had said "body shop" a turn earlier. Adding these to the ordinary
 * no-flip list was not enough — that list is confidence-gated at 0.85 and the
 * collision classifier only emits 0.70, so the rule never fired.
 *
 * Deliberately unconditional and not tenant-overridable: pitching mechanical
 * repair on a wrecked or glass-damaged car is wrong at any confidence, and the
 * cost of a rare missed flip is far below the cost of that conversation.
 */
const ALWAYS_NO_FLIP_CATEGORIES: readonly string[] = [
  'accident_minor',
  'accident_with_airbags',
  'glass_damage',
];

/**
 * Chris's call, 2026-08-27: no flip pitches on motorcycles — none of our
 * partner shops are a sensible alternative for a bike, and the 08-26 review
 * found one motorcycle job offered three car-repair shops 10-16 miles away.
 *
 * `vehicleMake` is a best-effort parse of a free-text Towbook field, so this
 * only catches marques that sell motorcycles and nothing else in the US
 * (Honda and BMW deliberately excluded — they also sell cars under the same
 * make name and a false block there costs more than an occasional missed
 * motorcycle flip).
 */
const MOTORCYCLE_ONLY_MAKES = new Set([
  'harley-davidson', 'harley davidson', 'harley',
  'ducati', 'kawasaki', 'yamaha', 'suzuki', 'ktm', 'triumph',
  'indian', 'indian motorcycle', 'vespa', 'piaggio', 'aprilia',
  'royal enfield', 'moto guzzi', 'husqvarna', 'victory', 'buell',
]);

export function decideFlip(input: FlipDecisionInput): FlipDecision {
  // Hard rule 0: motorcycle → never flip. See MOTORCYCLE_ONLY_MAKES above.
  if (input.vehicleMake && MOTORCYCLE_ONLY_MAKES.has(input.vehicleMake.trim().toLowerCase())) {
    return {
      flipEligible: false,
      conviniIntensity: 'soft',
      bodyShopSoftMention: false,
      reasonCode: 'vehicle_is_motorcycle',
    };
  }

  // Hard rule 1: AAA-branded / Blocklist → never flip.
  if (input.destinationTag === 'aaa_branded') {
    return {
      flipEligible: false,
      conviniIntensity: 'soft',
      bodyShopSoftMention: false,
      reasonCode: input.destinationReason || 'aaa_branded_hard_block',
    };
  }

  // Hard rule 2: our shop already → no flip needed.
  if (input.destinationTag === 'our_shop') {
    return {
      flipEligible: false,
      conviniIntensity: 'soft',
      bodyShopSoftMention: false,
      reasonCode: 'destination_is_our_shop',
    };
  }

  // Rule 3: auto body → our own body shops, as a SOFT offer.
  //
  // This was a hard no-flip until 2026-08-18. It was written when we had
  // nowhere to send a collision job, and that stopped being true when Excite
  // Collision and T&C went live on 08-17 — both are active in `alpha_shops`.
  //
  // The cost of leaving it closed was the largest single gap in the funnel: on
  // 2026-08-18, 16 of 79 calls (20%) went to a body shop, 9 of them held a real
  // conversation, and not one received any offer at all.
  //
  // `flipEligible` is now true so the call is counted and an offer can be
  // recorded, while `bodyShopSoftMention` still routes it to Scenario B. The two
  // are independent: the orchestrator picks the scenario from the mention flag,
  // not from eligibility. Scenario B stays a SOFT single ask — no ladder, no
  // invented discount — because body work runs through insurance and a hard
  // pitch on someone's wrecked car is the wrong instrument.
  if (input.destinationTag === 'auto_body') {
    // ...but ONLY when the work is actually body work.
    //
    // 2026-08-19, Chara Booth: a bad alternator, going to a shop the customer
    // confirmed on the call as a repair shop, and the agent ran the body-shop
    // script — "we own our own body shops here in the area, but since this is a
    // mechanical issue with the alternator, that wouldn't apply here" — and then
    // made no offer at all. A flip-eligible mechanical job, lost outright. The
    // agent was reasoning correctly about a scenario it should never have been
    // handed.
    //
    // The destination tag alone was choosing the scenario. It is a guess about a
    // BUSINESS, made from a name and a map pin; the issue is what the customer
    // just told us about their CAR. When they disagree, the car wins. A shop
    // that does collision work also fixes alternators, and a customer with an
    // alternator wants the mechanical offer.
    //
    // So body-shop routing now requires body-shop WORK. Anything else falls
    // through to the normal repair-flip path below and gets the real offer.
    const isBodyWork = ALWAYS_NO_FLIP_CATEGORIES.includes(input.issueSubcategory);
    if (isBodyWork) {
      return {
        flipEligible: true,
        conviniIntensity: 'medium',
        bodyShopSoftMention: true,
        reasonCode: 'destination_auto_body',
      };
    }
    // Mechanical work heading to a body shop: treat it as the ordinary repair
    // flip it is. Falls through deliberately rather than returning here.
  }

  // Hard rule 4: residential / unknown → no flip, hard CONVINI pitch.
  if (input.destinationTag === 'residence' || input.destinationTag === 'unknown') {
    return {
      flipEligible: false,
      conviniIntensity: 'hard',
      bodyShopSoftMention: false,
      reasonCode: `destination_${input.destinationTag}`,
    };
  }

  // Body / glass work: refused regardless of confidence. See
  // ALWAYS_NO_FLIP_CATEGORIES for why this cannot be confidence-gated.
  if (ALWAYS_NO_FLIP_CATEGORIES.includes(input.issueSubcategory)) {
    return {
      flipEligible: false,
      conviniIntensity: 'medium',
      bodyShopSoftMention: true,
      reasonCode: `no_flip_body_or_glass_${input.issueSubcategory}`,
    };
  }

  // Confidence-gated no-flip categories. Apply only when the AI is
  // confident; below threshold the flip pitch proceeds (we accept the
  // occasional misclassified single-tire flip rather than miss real
  // flips because of low classifier confidence).
  const threshold = input.config.no_flip_confidence_threshold ?? DEFAULT_NO_FLIP_THRESHOLD;
  const categories = (input.config.no_flip_categories?.length
    ? input.config.no_flip_categories
    : DEFAULT_NO_FLIP_CATEGORIES) as readonly string[];
  if (
    categories.includes(input.issueSubcategory) &&
    input.issueConfidence >= threshold
  ) {
    return {
      flipEligible: false,
      conviniIntensity: 'medium',
      bodyShopSoftMention: false,
      reasonCode: `no_flip_category_${input.issueSubcategory}_conf_${input.issueConfidence.toFixed(2)}`,
    };
  }

  // Default: competitor repair → flip pitch.
  return {
    flipEligible: true,
    conviniIntensity: 'soft', // soft close on the back of a successful (or attempted) flip
    bodyShopSoftMention: false,
    reasonCode: `flip_eligible_dest_${input.destinationTag}`,
  };
}
