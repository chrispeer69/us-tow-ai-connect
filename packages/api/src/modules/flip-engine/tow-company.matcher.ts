/**
 * Session 74 — tow-company detection, for jobs we must NOT call.
 *
 * When a vehicle is collected from another tow company's yard, the motor club
 * routinely enters that tow company in the CUSTOMER fields instead of the
 * notes. The result is that we place a confirmation-and-flip call to a
 * competitor's dispatch line. Over the 30 days to 2026-08-13 that happened 20
 * times; the destination was a collision shop in nearly every case, so there
 * was never a flip to win either.
 *
 * These jobs are handled manually. The right outcome is no call at all.
 *
 * ⚠️ PRECISION OVER RECALL — this gate SUPPRESSES a customer call, so a false
 * positive means a real motorist never hears from us. That is worse than the
 * problem being solved. Every rule here is therefore exact or strongly
 * distinctive, there is no fuzzy matching, and anything uncertain is left to
 * ring. Missing a few tow yards is an acceptable cost; silencing one customer
 * is not.
 *
 * Two deliberate omissions:
 *   - "recovery" on its own is NOT a token. Wrench Recovery is one of our own
 *     partner shops. "towing and recovery" still matches, via "towing".
 *   - "transport", "hauling", "salvage" and "auto" are not tokens — far too
 *     many ordinary businesses and customer surnames contain them.
 *
 * The operator list (`entries`) is authoritative and is the only rule that can
 * match on address. Chris is supplying one; until it lands, the name tokens
 * carry the gate on their own.
 */

/** Distinctive enough that a private individual will not be called this. */
const TOW_NAME_TOKENS: readonly RegExp[] = [
  /\btowing\b/i,
  /\btow\s*yard\b/i,
  /\bwrecker(s)?\b/i,
  /\bimpound(ed|ment)?\b/i,
  /\btow\s*service(s)?\b/i,
  /\btow\s*lot\b/i,
  /\bpro[-\s]?tow\b/i,
  /\btowing\s*&?\s*recovery\b/i,
];

export interface TowCompanyEntry {
  /** EXACT_NAME and EXACT_ADDRESS are compared on normalised text. */
  matchType: 'EXACT_NAME' | 'EXACT_ADDRESS' | 'NAME_PATTERN' | 'PHONE';
  matchValue: string;
  active: boolean;
}

export interface TowCompanyCheckInput {
  /** Whoever the club put in the customer fields — the usual tell. */
  customerName?: string | null;
  /** Business name resolved for the pickup, when we have one. */
  pickupName?: string | null;
  pickupAddress?: string | null;
  customerPhone?: string | null;
  /** Operator-supplied list. Authoritative. */
  entries?: TowCompanyEntry[];
  /**
   * Names that must NEVER match, whatever else fires: our own partner shops and
   * the tenant's own company. "Roadside Towing" contains a tow token, and so
   * would any towing tenant we onboard later.
   */
  neverMatch?: string[];
}

export interface TowCompanyCheckResult {
  matched: boolean;
  rule: 'name_token' | 'exact_name' | 'exact_address' | 'name_pattern' | 'phone' | null;
  /** The field that matched, so the skip reason can name it in the log. */
  field: 'customer_name' | 'pickup_name' | 'pickup_address' | 'customer_phone' | null;
  matchedValue: string | null;
}

const NO_MATCH: TowCompanyCheckResult = {
  matched: false,
  rule: null,
  field: null,
  matchedValue: null,
};

function norm(v: string | null | undefined): string {
  return (v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function digitsOnly(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '');
}

export function isTowCompany(input: TowCompanyCheckInput): TowCompanyCheckResult {
  const customerName = norm(input.customerName);
  const pickupName = norm(input.pickupName);
  const pickupAddress = norm(input.pickupAddress);
  const phone = digitsOnly(input.customerPhone);
  const never = (input.neverMatch ?? []).map(norm).filter(Boolean);
  const entries = (input.entries ?? []).filter((e) => e.active && e.matchValue?.trim());

  // Our own shops and our own company can never be "another tow company",
  // however the name reads. Checked first so nothing below can override it.
  const isProtected = (value: string) =>
    !!value && never.some((n) => value === n || value.includes(n) || n.includes(value));
  if (isProtected(customerName) || isProtected(pickupName)) return NO_MATCH;

  // Rule 1 — operator list, exact matches only. Authoritative.
  for (const e of entries) {
    const v = norm(e.matchValue);
    if (e.matchType === 'EXACT_NAME') {
      if (v && customerName === v) return hit('exact_name', 'customer_name', e.matchValue);
      if (v && pickupName === v) return hit('exact_name', 'pickup_name', e.matchValue);
    }
    if (e.matchType === 'EXACT_ADDRESS' && v && pickupAddress === v) {
      return hit('exact_address', 'pickup_address', e.matchValue);
    }
    if (e.matchType === 'NAME_PATTERN' && v) {
      if (customerName.includes(v)) return hit('name_pattern', 'customer_name', e.matchValue);
      if (pickupName.includes(v)) return hit('name_pattern', 'pickup_name', e.matchValue);
    }
    if (e.matchType === 'PHONE') {
      const d = digitsOnly(e.matchValue);
      if (d && phone && d === phone) return hit('phone', 'customer_phone', e.matchValue);
    }
  }

  // Rule 2 — distinctive tokens in a business-style name. Deliberately NOT
  // applied to the address: a street named "Towing Ln" must not silence a call.
  for (const token of TOW_NAME_TOKENS) {
    if (customerName && token.test(customerName)) {
      return hit('name_token', 'customer_name', input.customerName ?? null);
    }
    if (pickupName && token.test(pickupName)) {
      return hit('name_token', 'pickup_name', input.pickupName ?? null);
    }
  }

  return NO_MATCH;
}

function hit(
  rule: NonNullable<TowCompanyCheckResult['rule']>,
  field: NonNullable<TowCompanyCheckResult['field']>,
  matchedValue: string | null,
): TowCompanyCheckResult {
  return { matched: true, rule, field, matchedValue };
}
