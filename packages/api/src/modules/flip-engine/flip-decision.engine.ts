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

export function decideFlip(input: FlipDecisionInput): FlipDecision {
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

  // Hard rule 3: auto body → no flip, soft mention our body shops.
  if (input.destinationTag === 'auto_body') {
    return {
      flipEligible: false,
      conviniIntensity: 'medium',
      bodyShopSoftMention: true,
      reasonCode: 'destination_auto_body',
    };
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
