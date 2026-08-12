import { Injectable } from '@nestjs/common';

export type IssueSubcategory =
  | 'single_tire_issue'
  | 'full_tire_set'
  | 'jump_start'
  | 'lockout'
  | 'fuel_delivery'
  | 'winch_out'
  | 'accident_with_airbags'
  | 'accident_minor'
  | 'glass_damage'
  | 'mechanical'
  | 'unknown';

export interface ClassifyIssueInput {
  reasonText?: string | null;     // free-text from the dispatch board
  vehicleNotes?: string | null;
  motorClubServiceCode?: string | null;
}

export interface ClassifyIssueResult {
  subcategory: IssueSubcategory;
  confidence: number; // 0..1
  signals: string[];
}

/**
 * Session 49c — Issue classifier.
 *
 * v1: deterministic keyword + service-code matcher. Fast, no external
 * dependency, easy to debug. Returns a confidence in [0,1] driven by how
 * many independent signals matched.
 *
 * v2 (future): swap the body of `classify()` for a Forge LLM call that
 * returns the same shape. The flip-decision engine doesn't care which
 * implementation classified the call.
 */
@Injectable()
export class IssueClassifierService {
  classify(input: ClassifyIssueInput): ClassifyIssueResult {
    const blob = [
      input.reasonText ?? '',
      input.vehicleNotes ?? '',
      input.motorClubServiceCode ?? '',
    ]
      .join(' ')
      .toLowerCase();
    const signals: string[] = [];

    const has = (...needles: string[]) => needles.some((n) => blob.includes(n));

    // --- single tire (no flip) ---
    if (
      has('flat tire', 'flat rear', 'flat front', 'one tire', 'single tire',
        'plug a tire', 'patch a tire', 'tire repair', 'punctured tire')
    ) {
      // But explicit mention of a full set overrides
      if (has('all four', 'all 4', 'set of tires', 'four tires', 'new tires')) {
        signals.push('tire_full_set');
        return { subcategory: 'full_tire_set', confidence: 0.92, signals };
      }
      signals.push('tire_single');
      return { subcategory: 'single_tire_issue', confidence: 0.9, signals };
    }
    if (has('full set of tires', 'all 4 tires', 'all four tires', 'tire package')) {
      signals.push('tire_full_set');
      return { subcategory: 'full_tire_set', confidence: 0.93, signals };
    }

    if (has('jump start', 'jumpstart', 'dead battery', 'wont start battery', 'needs a jump')) {
      signals.push('jump_start_kw');
      return { subcategory: 'jump_start', confidence: 0.93, signals };
    }
    if (has('lockout', 'locked out', 'keys in car', 'locked keys')) {
      signals.push('lockout_kw');
      return { subcategory: 'lockout', confidence: 0.94, signals };
    }
    if (has('out of gas', 'fuel delivery', 'gas delivery', 'ran out of fuel')) {
      signals.push('fuel_kw');
      return { subcategory: 'fuel_delivery', confidence: 0.93, signals };
    }
    if (
      has(
        'winch out',
        'winch-out',
        'stuck in mud',
        'stuck in snow',
        'stuck on ice',
        'stuck on a rock',
        'stuck on rock',
        'stuck on rocks',
        'slid off road',
        'slipped off road',
        'off the road',
        'off-road recovery',
        'in a ditch',
        'embankment',
        'recovery',
      )
    ) {
      signals.push('winch_kw');
      return { subcategory: 'winch_out', confidence: 0.91, signals };
    }
    if (has('airbag', 'airbags deployed', 'airbag deployed')) {
      signals.push('airbag_kw');
      return { subcategory: 'accident_with_airbags', confidence: 0.95, signals };
    }
    if (has('accident', 'collision', 'rear-ended', 'fender bender', 'crash')) {
      signals.push('collision_kw');
      return { subcategory: 'accident_minor', confidence: 0.7, signals };
    }
    // Session 74 — glass had no subcategory at all, so a cracked-windshield job
    // fell through to `unknown`, stayed flip-eligible, and got pitched a free
    // MECHANICAL diagnostic at a brake shop. Must sit after the collision check:
    // a crash that also broke glass is a collision first.
    if (has('glass', 'windshield', 'windscreen', 'window', 'rock chip')) {
      signals.push('glass_kw');
      return { subcategory: 'glass_damage', confidence: 0.85, signals };
    }
    if (
      has('wont start', "won't start", 'no start', 'engine', 'transmission', 'brake',
        'check engine', 'overheating', 'mechanical')
    ) {
      signals.push('mechanical_kw');
      return { subcategory: 'mechanical', confidence: 0.75, signals };
    }

    return { subcategory: 'unknown', confidence: 0.3, signals };
  }
}
