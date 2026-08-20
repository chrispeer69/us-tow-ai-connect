/**
 * Session 49d — Manager SMS templates.
 *
 * Three streams:
 *   1. Real-time WIN text (full detail) — every flip win.
 *   2. Batch summary (compact) — after every N flip attempts (default 10).
 *   3. Daily 24-hour summary — once per day at the configured local hour.
 *
 * All renderers return a single SMS-ready string. Each line is intentionally
 * short so the message wraps cleanly on a phone screen.
 */

export interface FlipWinTextInput {
  companyName: string;
  customer: { name: string; phone: string };
  vehicle: string;
  issue: string;
  pickup: string;
  originalDestination: string;
  redirectedTo: string;
  distanceSavedMiles: number | null;
  acceptedOffer: 1 | 2 | 3;
  conviniLinkSent: boolean;
  rentalMentioned: boolean;
  driverName: string | null;
  jobNumber: string;
  callTimeLocal: string; // "14:22 EDT"
  callDuration: string; // "2m 41s"
  transcriptUrl?: string | null;
}

const OFFER_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Offer 1 (free diagnostic + 10% off)',
  2: 'Offer 2 (same-day priority + 1hr estimate)',
  3: 'Offer 3 ($50 credit on this repair)',
};

export function renderFlipWinSms(i: FlipWinTextInput): string {
  const lines: string[] = [
    `FLIP WIN — ${i.companyName}`,
    '',
    `Customer: ${i.customer.name} (${i.customer.phone})`,
    `Vehicle: ${i.vehicle}`,
    `Issue: ${i.issue}`,
    `Pickup: ${i.pickup}`,
    '',
    `ORIGINAL: ${i.originalDestination}`,
    `REDIRECTED TO: ${i.redirectedTo}`,
  ];
  if (i.distanceSavedMiles != null) {
    lines.push(`Distance saved for driver: ${i.distanceSavedMiles} mi`);
  }
  lines.push('');
  lines.push(`Offer accepted: ${OFFER_LABELS[i.acceptedOffer]}`);
  lines.push(`CONVINI link: ${i.conviniLinkSent ? 'sent' : 'not sent'}`);
  lines.push(`Rental mentioned: ${i.rentalMentioned ? 'yes' : 'no'}`);
  lines.push('');
  if (i.driverName) lines.push(`Driver: ${i.driverName} (assigned)`);
  lines.push(`Job #: ${i.jobNumber}`);
  lines.push(`Call time: ${i.callTimeLocal}  |  Duration: ${i.callDuration}`);
  if (i.transcriptUrl) lines.push(`Transcript: ${i.transcriptUrl}`);
  return lines.join('\n');
}

export interface BatchSummaryInput {
  companyName: string;
  windowSize: number; // typically 10
  wins: Array<{ jobNumber: string; redirectedTo: string; offer: 1 | 2 | 3 }>;
  losses: string[]; // job numbers only
  todayWins: number;
  todayLosses: number;
}

export function renderBatchSummarySms(i: BatchSummaryInput): string {
  const lines: string[] = [
    `FLIP BATCH — ${i.companyName}`,
    `Last ${i.windowSize}: ${i.wins.length} wins / ${i.losses.length} losses`,
    '',
  ];
  if (i.wins.length > 0) {
    lines.push('WINS:');
    for (const w of i.wins) {
      lines.push(`${w.jobNumber}  ${w.redirectedTo} (Off ${w.offer})`);
    }
    lines.push('');
  }
  if (i.losses.length > 0) {
    lines.push('LOSSES:');
    // Wrap losses in compact comma-separated form per spec.
    lines.push(i.losses.join(', '));
    lines.push('');
  }
  lines.push(`ON THE DAY: ${i.todayWins} wins / ${i.todayLosses} losses`);
  return lines.join('\n');
}

export interface DailyReportInput {
  companyName: string;
  dateLocal: string; // "2026-05-27"
  totalAttempts: number;
  wins: number;
  losses: number;
  winsByShop: Array<{ shopName: string; count: number }>;
  winsByOffer: { offer1: number; offer2: number; offer3: number };
  source: { towbookAttempts: number; towbookWins: number; aaaAttempts: number; aaaWins: number };
  conviniSent: number;
  skippedAaaBranded: number;
}

export function renderDailyReportSms(i: DailyReportInput): string {
  const lines: string[] = [
    `FLIP DAILY — ${i.companyName}`,
    i.dateLocal,
    '',
    `${i.totalAttempts} attempts. ${i.wins} wins / ${i.losses} losses.`,
    '',
    'WINS BY SHOP:',
    ...i.winsByShop.map((s) => `${s.shopName}: ${s.count}`),
    '',
    'WINS BY OFFER:',
    `Off 1: ${i.winsByOffer.offer1}  |  Off 2: ${i.winsByOffer.offer2}  |  Off 3: ${i.winsByOffer.offer3}`,
    '',
    'SOURCE:',
    `Towbook: ${i.source.towbookAttempts} (${i.source.towbookWins} wins)`,
    `AAA: ${i.source.aaaAttempts} (${i.source.aaaWins} wins)`,
    '',
    `CONVINI links sent: ${i.conviniSent}`,
    `Skipped (AAA-branded): ${i.skippedAaaBranded}`,
  ];
  return lines.join('\n');
}

/**
 * The text Options 3/4 promise on a collision call. Deliberately mirrors what
 * she said: an estimate review, not a pitch to switch shops. Nothing in here
 * describes the customer's rights, their insurer, or the insurer's shop — the
 * safe lane applies to what we write as much as to what she says.
 */
export function renderBodyInfoSms(i: { companyName: string; customerName?: string | null }): string {
  const who = (i.customerName ?? '').trim().split(/\s+/)[0];
  const greeting = who ? `Hi ${who}` : 'Hi';
  return (
    `${greeting}, ${i.companyName} here — the info I mentioned. ` +
    `We run our own body shops and we do free estimate reviews: ` +
    `whenever your estimate is written up, send it over and we'll give it a second read ` +
    `before anything is finalised. No charge, no obligation. Reply ESTIMATE and we'll take it from there.`
  );
}
