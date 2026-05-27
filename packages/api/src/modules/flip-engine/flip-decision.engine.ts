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
}

export interface FlipDecision {
  flipEligible: boolean;
  conviniIntensity: 'soft' | 'medium' | 'hard';
  bodyShopSoftMention: boolean;
  reasonCode: string;
}

const DEFAULT_NO_FLIP_THRESHOLD = 0.85;
const DEFAULT_NO_FLIP_CATEGORIES: IssueSubcategory[] = [
  'single_tire_issue',
  'jump_start',
  'lockout',
  'fuel_delivery',
  'winch_out',
  'accident_with_airbags',
];

export function decideFlip(input: FlipDecisionInput): FlipDecision {
  // Hard rule 1: AAA-branded → never flip.
  if (input.destinationTag === 'aaa_branded') {
    return {
      flipEligible: false,
      conviniIntensity: 'soft',
      bodyShopSoftMention: false,
      reasonCode: 'aaa_branded_hard_block',
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
