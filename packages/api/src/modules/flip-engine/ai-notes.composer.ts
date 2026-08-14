/**
 * Session 75 — "AI Notes": the block we write back into the dispatch system's
 * details box so a driver sees what the customer actually told the AI.
 *
 * Chris, 2026-08-14: call it AI Notes so we know they came from the AI
 * conversation. That naming is not cosmetic — it is what makes the write
 * auditable. A dispatcher reading the details box must be able to tell in one
 * glance which lines a human typed and which a machine did, and an append-only
 * block with a fixed header is the cheapest way to guarantee that.
 *
 * WHY THIS EXISTS AT ALL: on 2026-08-14, 118 of the previous 421 calls carried
 * a real, dispatch-useful correction in `corrections_made` —
 *
 *   "Corrected pickup address from 766 to 763 South Richardson Avenue and
 *    clarified car is parked in the alley behind the address."
 *
 * — and `towbook_notes_updated` was false on all 421. Every one of those
 * corrections died in our database. The driver went to the address on the
 * ticket. This module turns that column into something a driver can read.
 *
 * DESIGN RULES, all of them safety rather than style:
 *
 *  1. APPEND, NEVER OVERWRITE. The details box is the customer's system of
 *     record and may contain dispatcher notes a driver depends on. We add; we
 *     never replace. Enforced by the adapter, but composed for it here — the
 *     block is self-contained and carries its own header.
 *  2. SAY NOTHING RATHER THAN SAY NOTHING USEFUL. The extractor returns prose
 *     even when the call never reached a human: "No corrections were made as
 *     the agent did not reach the motorist." Writing that into a live ticket is
 *     noise that teaches dispatchers to ignore the block. `composeAiNotes`
 *     returns null for these and the caller skips the write entirely.
 *  3. NEVER INVENT. Every line is a value we actually captured. No inference,
 *     no summarising the summary.
 *  4. IDEMPOTENCY IS THE CALLER'S JOB, but we make it checkable: the header is
 *     a fixed, greppable marker so the adapter can detect an existing block for
 *     the same call and refuse to double-write.
 */

/** Fixed marker. Changing it orphans every previously written block. */
export const AI_NOTES_HEADER = 'AI Notes';

export interface AiNotesInput {
  /** Free-text corrections from post-call extraction. The valuable field. */
  correctionsMade?: string | null;
  /** What the customer said was wrong with the vehicle, if captured. */
  issueDescription?: string | null;
  /** Destination the customer confirmed, when it differs from the ticket. */
  confirmedDestination?: string | null;
  /** Set when the customer accepted a shop switch — the driver must see this. */
  newDestination?: string | null;
  /** Call outcome, only rendered when it changes where the vehicle goes. */
  flipOutcome?: string | null;
  /** ISO timestamp of the call. Rendered so notes are orderable by eye. */
  callTimeIso?: string | null;
}

/**
 * Phrases the post-call extractor produces when there is genuinely nothing to
 * report. Matched case-insensitively as substrings because the model varies the
 * wording around a stable core ("no corrections were made", "none").
 *
 * Deliberately conservative: a phrase only belongs here if it cannot co-occur
 * with real information. "No corrections made; agent was unable to proceed past
 * the automated menu" is still a no-op — there is no customer contact in it.
 */
const NO_OP_PATTERNS = [
  'no corrections were made',
  'no corrections made',
  'no corrections',
  'no changes were made',
  'no changes made',
  'did not reach',
  'unable to reach',
  'no answer',
  'voicemail',
  'not applicable',
];

function isNoOp(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!t || t === 'null' || t === 'none' || t === 'n/a' || t === '-') return true;
  // A no-op phrase only disqualifies the text when it IS the text, rather than
  // one clause of something longer that also carries real detail. Compare on
  // the leading clause so "No corrections made; agent was unable to proceed" is
  // caught, while "Corrected pickup... no changes to the vehicle" survives.
  const leadingClause = t.split(/[;.]/)[0].trim();
  return NO_OP_PATTERNS.some(
    (p) => leadingClause.includes(p) || t === p || t.startsWith(p),
  );
}

function clean(value: string | null | undefined): string | null {
  const t = (value ?? '').trim();
  if (!t || t.toLowerCase() === 'null' || t.toLowerCase() === 'undefined') return null;
  return t.replace(/\s+/g, ' ');
}

/**
 * Build the block, or null when there is nothing worth a driver's attention.
 *
 * Returning null is the common case and the correct one — roughly 70% of calls
 * produce no correction at all, and a details box full of "AI Notes: nothing to
 * report" is worse than no integration.
 */
export function composeAiNotes(input: AiNotesInput): string | null {
  const lines: string[] = [];

  const corrections = clean(input.correctionsMade);
  if (corrections && !isNoOp(corrections)) {
    lines.push(corrections);
  }

  const issue = clean(input.issueDescription);
  if (issue && !isNoOp(issue) && issue.toLowerCase() !== 'unknown') {
    lines.push(`Customer described: ${issue}`);
  }

  // A destination change is the single highest-consequence thing on this list.
  // If the customer accepted a shop switch, the driver is going somewhere other
  // than the ticket says, and that must be legible without reading a transcript.
  const newDestination = clean(input.newDestination);
  if (newDestination && (input.flipOutcome ?? '').toUpperCase() === 'ACCEPTED') {
    lines.push(`DESTINATION CHANGED — customer agreed to ${newDestination}.`);
  } else {
    const confirmed = clean(input.confirmedDestination);
    if (confirmed) lines.push(`Destination confirmed by customer: ${confirmed}.`);
  }

  if (lines.length === 0) return null;

  const stamp = formatStamp(input.callTimeIso);
  const header = stamp ? `${AI_NOTES_HEADER} (${stamp})` : AI_NOTES_HEADER;
  return [`--- ${header} ---`, ...lines.map((l) => l.replace(/\s*$/, ''))].join('\n');
}

/**
 * `2026-08-14 15:42 ET`. Read by humans scanning a details box, so local time
 * beats ISO here. Falls back to no stamp rather than a wrong one.
 */
function formatStamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ET`;
  } catch {
    return null;
  }
}

/**
 * Has this block already been written into the target text?
 *
 * The adapter calls this before appending. A retried call, a webhook delivered
 * twice, or an operator re-running a backfill must not stack duplicate blocks
 * in a live ticket. Compares on the header line, which carries the timestamp
 * and is therefore unique per call.
 */
export function alreadyContainsAiNote(
  existingText: string | null | undefined,
  block: string,
): boolean {
  const existing = (existingText ?? '').trim();
  if (!existing) return false;
  const headerLine = block.split('\n')[0]?.trim();
  if (!headerLine) return false;
  return existing.includes(headerLine);
}

/**
 * Append the block to whatever is already in the details box.
 *
 * Pure so the append rule is testable without a browser. The adapter's only job
 * is to read the field, call this, and write the result back — it never
 * constructs the new value itself, which is what keeps "never overwrite" from
 * being a code-review promise rather than a property.
 */
export function appendAiNotes(
  existingText: string | null | undefined,
  block: string,
): string {
  const existing = (existingText ?? '').replace(/\s+$/, '');
  if (!existing) return block;
  if (alreadyContainsAiNote(existing, block)) return existing;
  return `${existing}\n\n${block}`;
}
