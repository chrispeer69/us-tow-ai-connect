/**
 * Motor-club call-centre lines, recognised by caller ID.
 *
 * 2026-10-16 — Agero reps (520-733-4xxx) were about a quarter of inbound
 * calls on 10-15 and nearly a third of the transfers: Emily could not tell a
 * club rep from a customer, so she asked who they were instead of asking for
 * the PO. Towbook payloads carry no club name, so the caller ID is the only
 * signal we have. Chris confirmed the blocks below.
 *
 * Kept in code and returned on the lookup Emily already runs at the start of
 * every call, so it costs nothing in the core prompt (Chris: the prompt must
 * stay under 4,000 tokens or the per-minute rate doubles).
 */
const CLUB_PREFIXES: Array<{ prefix: string; club: string }> = [
  { prefix: '5207334', club: 'Agero' },
  // Chris, 10-16: "based on volume I assume Agero — not 100 percent sure".
  { prefix: '332230', club: 'Agero (likely)' },
  { prefix: '727540', club: 'Allstate' },
  { prefix: '800222', club: 'AAA' },
];

/** The club whose call centre this caller ID belongs to, or null. */
export function motorClubForCallerId(callerId: string | null | undefined): string | null {
  const digits = (callerId ?? '').replace(/\D/g, '');
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  if (ten.length !== 10) return null;
  return CLUB_PREFIXES.find((c) => ten.startsWith(c.prefix))?.club ?? null;
}

/** What Emily is told on the lookup result when the caller is a club line. */
export function motorClubCallerFields(callerId: string | null | undefined) {
  const club = motorClubForCallerId(callerId);
  if (!club) return {};
  return {
    motor_club_caller: club,
    motor_club_note:
      'Caller ID is a motor club call centre: this is a club rep, not the customer. Ask for the PO number and look it up by po_number.',
  };
}
