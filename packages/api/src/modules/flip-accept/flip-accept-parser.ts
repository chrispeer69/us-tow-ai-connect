/**
 * Parses a manager's reply SMS into a structured decision.
 *
 * Protocol (case-insensitive on the keyword, payload may be mixed):
 *   "YES"                      → approve, no notes
 *   "YES NOTE ALL CAPS NOTES"  → approve with manager notes (anything after
 *                                 the YES keyword is treated as the note)
 *   "NO REASON ..."            → decline, with the trailing text as reason
 *   "NO"                       → decline, no reason
 *
 * Anything else returns kind="unknown" so the controller can SMS the
 * manager a help reminder instead of silently dropping the message.
 *
 * The "ALL CAPS" expectation is a convention for human readability, not a
 * hard requirement — the parser preserves whatever the manager typed.
 */
export type ParsedFlipReply =
  | { kind: 'approve'; notes: string | null }
  | { kind: 'decline'; reason: string | null }
  | { kind: 'unknown' };

const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);

export function parseFlipReply(raw: string): ParsedFlipReply {
  if (!raw) return { kind: 'unknown' };
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'unknown' };

  const first = trimmed.split(/\s+/, 1)[0].toUpperCase();
  if (STOP_KEYWORDS.has(first)) {
    // STOP is for SMS opt-out — handled separately by the SMS subsystem.
    return { kind: 'unknown' };
  }

  // YES patterns
  const yesMatch = /^yes\b(.*)$/i.exec(trimmed);
  if (yesMatch) {
    const tail = yesMatch[1].trim();
    if (!tail) return { kind: 'approve', notes: null };

    // Optional "NOTE" / "NOTES" keyword between YES and the actual notes.
    const noteStripped = tail.replace(/^notes?\b[:\-\s]*/i, '').trim();
    return { kind: 'approve', notes: noteStripped.length > 0 ? noteStripped : tail };
  }

  // NO patterns
  const noMatch = /^no\b(.*)$/i.exec(trimmed);
  if (noMatch) {
    const tail = noMatch[1].trim();
    if (!tail) return { kind: 'decline', reason: null };
    const reasonStripped = tail.replace(/^reason\b[:\-\s]*/i, '').trim();
    return { kind: 'decline', reason: reasonStripped.length > 0 ? reasonStripped : tail };
  }

  return { kind: 'unknown' };
}
