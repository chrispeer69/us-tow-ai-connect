/**
 * Session 49b — AAA-branded shop hard guardrail.
 *
 * Returns TRUE if the destination is a AAA-owned/branded repair location.
 * The flip engine treats a TRUE result as a hard "never flip" signal —
 * no override, no per-tenant opt-in, no exception. This is a fireable-
 * offense rule per CLAW.md.
 *
 * Match order (any one returns true):
 *   1. Standalone "AAA" word in the business name (regex /\bAAA\b/i).
 *      The standalone-word constraint avoids false positives for
 *      shops whose names contain the letters AAA as a substring of
 *      another word (e.g., "Maaaco" — though Maaco doesn't actually
 *      contain AAA, the principle is the same).
 *   2. NAME_PATTERN entries from the per-tenant blocklist (case-
 *      insensitive substring match).
 *   3. EXACT_NAME entries (case-insensitive equality on trimmed name).
 *   4. EXACT_ADDRESS entries (case-insensitive equality on trimmed
 *      single-line address).
 *   5. PHONE entries (digits-only equality).
 *
 * The literal regex check (rule 1) is hard-coded so it survives even
 * if the database is empty / unreachable. Rules 2-5 augment it with
 * operator-managed entries.
 */

export interface BlocklistEntry {
  matchType: 'STANDALONE_WORD' | 'NAME_PATTERN' | 'EXACT_NAME' | 'EXACT_ADDRESS' | 'PHONE';
  matchValue: string;
  active: boolean;
}

export interface AaaBrandedCheckInput {
  destinationName?: string | null;
  destinationAddress?: string | null;
  destinationPhone?: string | null;
  blocklist?: BlocklistEntry[];
}

export interface AaaBrandedCheckResult {
  matched: boolean;
  rule:
    | 'standalone_word'
    | 'name_pattern'
    | 'exact_name'
    | 'exact_address'
    | 'phone'
    | null;
  matchedValue: string | null;
}

export function isAaaBrandedShop(input: AaaBrandedCheckInput): AaaBrandedCheckResult {
  const name = (input.destinationName ?? '').trim();
  const address = (input.destinationAddress ?? '').trim();
  const phoneDigits = digitsOnly(input.destinationPhone ?? '');
  const blocklist = (input.blocklist ?? []).filter((b) => b.active);

  // Rule 1: STANDALONE_WORD regex match (case-insensitive word boundary).
  if (name) {
    for (const entry of blocklist) {
      if (entry.matchType !== 'STANDALONE_WORD') continue;
      // Safely escape the input for regex
      const escaped = entry.matchValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').trim();
      if (!escaped) continue;
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(name)) {
        return { matched: true, rule: 'standalone_word', matchedValue: entry.matchValue };
      }
    }
  }

  // Rule 2: NAME_PATTERN substring match (case-insensitive).
  if (name) {
    const lowerName = name.toLowerCase();
    for (const entry of blocklist) {
      if (entry.matchType !== 'NAME_PATTERN') continue;
      if (lowerName.includes(entry.matchValue.toLowerCase().trim())) {
        return { matched: true, rule: 'name_pattern', matchedValue: entry.matchValue };
      }
    }
  }

  // Rule 3: EXACT_NAME equality (case-insensitive, trimmed).
  if (name) {
    const lowerName = name.toLowerCase();
    for (const entry of blocklist) {
      if (entry.matchType !== 'EXACT_NAME') continue;
      if (entry.matchValue.toLowerCase().trim() === lowerName) {
        return { matched: true, rule: 'exact_name', matchedValue: entry.matchValue };
      }
    }
  }

  // Rule 4: EXACT_ADDRESS equality.
  if (address) {
    const lowerAddress = address.toLowerCase();
    for (const entry of blocklist) {
      if (entry.matchType !== 'EXACT_ADDRESS') continue;
      if (entry.matchValue.toLowerCase().trim() === lowerAddress) {
        return { matched: true, rule: 'exact_address', matchedValue: entry.matchValue };
      }
    }
  }

  // Rule 5: PHONE digits-only equality. We compare the last 10 digits to
  // tolerate country-code differences (US-style numbers commonly come in
  // both +1614... and 614... shapes).
  if (phoneDigits) {
    const inputLast10 = lastN(phoneDigits, 10);
    for (const entry of blocklist) {
      if (entry.matchType !== 'PHONE') continue;
      const entryLast10 = lastN(digitsOnly(entry.matchValue), 10);
      if (entryLast10 && entryLast10 === inputLast10) {
        return { matched: true, rule: 'phone', matchedValue: entry.matchValue };
      }
    }
  }

  return { matched: false, rule: null, matchedValue: null };
}

function digitsOnly(s: string): string {
  return s.replace(/\D+/g, '');
}

function lastN(s: string, n: number): string {
  return s.length <= n ? s : s.slice(-n);
}
