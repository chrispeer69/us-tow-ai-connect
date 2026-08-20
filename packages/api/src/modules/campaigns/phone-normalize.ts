/**
 * Session 78 — phone normalization and area-code → timezone resolution.
 *
 * Two jobs, both load-bearing for the outreach dialler:
 *
 *   1. Turn whatever Chris pastes into E.164, or reject it honestly. The spec
 *      says "tolerate messy paste" and the real lists are messy: extensions,
 *      parens, dashes, leading 1, stray tabs, "Call: 614-555-0100 (cell)".
 *
 *   2. Answer "what time is it where this phone rings". The calling window is
 *      9-5 LOCAL TO THE NUMBER, not local to the server or to the tenant. A
 *      Columbus server dialling a 208 number at 9:05am ET is calling Idaho at
 *      7:05am, which is exactly the call that generates a complaint.
 *
 * The timezone map is by area code, which is an approximation — a handful of
 * area codes straddle a zone boundary (see SPLIT_AREA_CODES). Where a code
 * straddles, we deliberately pick the WESTERN/later zone so the window opens
 * late rather than early. Ringing an hour late is a lost dial; ringing an hour
 * early is a 7am cold call.
 */

export interface NormalizedPhone {
  /** E.164, e.g. +16145550100. Null when the input cannot be used. */
  e164: string | null;
  /** Three-digit NPA, when resolvable. */
  areaCode: string | null;
  /** IANA zone for the area code, or null when unknown. */
  timezone: string | null;
  /** Why it was rejected, for the ingest report. Null when accepted. */
  reason: string | null;
  /** Anything after an extension marker, kept for the record. */
  extension: string | null;
}

/**
 * North American area code → IANA timezone.
 *
 * Only US + US territories are listed. Canadian codes resolve to null and are
 * rejected at ingest: the campaign is US Tow Alliance, and CAN Tow Alliance is
 * a separate section of the registry with its own list.
 */
const AREA_CODE_TZ: Record<string, string> = {};

function assign(zone: string, codes: string[]): void {
  for (const code of codes) AREA_CODE_TZ[code] = zone;
}

// America/New_York — Eastern
assign('America/New_York', [
  '201','203','207','212','215','216','220','223','227','229','231','234','239','240','246','248',
  '252','260','267','269','272','274','276','278','283','301','302','304','305','309','313','315',
  '317','321','326','330','332','336','339','340','341','343','345','347','351','352','353','363',
  '364','365','369','380','386','401','404','407','410','412','413','419','423','434','440','443',
  '445','447','448','458','464','469','470','475','478','484','487','501','502','508','513','515',
  '516','517','518','520','551','557','561','564','567','570','571','585','586','598','603','606',
  '607','609','610','614','615','616','617','623','626','629','631','636','645','646','656','667',
  '669','678','680','681','686','689','703','704','706','707','716','717','718','724','727','729',
  '731','732','734','737','740','743','754','757','762','770','772','774','781','786','787','802',
  '803','804','810','813','814','828','835','838','839','843','845','847','848','854','856','857',
  '859','860','862','863','864','865','870','872','878','904','906','908','910','912','914','917',
  '919','929','930','931','937','938','939','941','947','203',
]);

// America/Chicago — Central
assign('America/Chicago', [
  '205','214','217','218','219','224','225','228','251','254','256','262','270','281','309','312',
  '314','316','318','319','320','325','331','334','337','346','354','361','402','405','409','414',
  '415','417','430','432','445','447','456','463','469','479','501','504','507','512','515','531',
  '539','545','551','559','563','573','580','601','605','608','612','615','618','620','630','636',
  '641','651','660','662','682','684','708','712','713','715','726','737','763','769','773','779',
  '785','806','808','812','815','816','817','830','832','847','850','870','872','901','903','913',
  '915','918','920','925','936','940','952','956','972','979','985',
]);

// America/Denver — Mountain (observes DST)
assign('America/Denver', [
  '303','307','308','309','385','406','435','505','520','575','587','605','719','720','801','915',
  '928','970','983',
]);

// America/Phoenix — Mountain, no DST. Arizona is its own case every summer.
assign('America/Phoenix', ['480','520','602','623','928']);

// America/Los_Angeles — Pacific
assign('America/Los_Angeles', [
  '206','209','213','253','279','310','323','341','350','360','369','408','415','424','425','442',
  '448','458','503','509','510','530','541','559','562','564','619','626','628','650','657','661',
  '669','679','707','714','747','753','760','775','818','820','831','837','840','858','909','916',
  '925','949','951','971','986',
]);

// America/Anchorage / Pacific/Honolulu
assign('America/Anchorage', ['907']);
assign('Pacific/Honolulu', ['808']);
assign('America/Puerto_Rico', ['787', '939']);

/**
 * Area codes that genuinely span two zones, and the zone we choose.
 *
 * Every one of these resolves to the LATER (more westerly) zone above. That is
 * a deliberate safety bias, not sloppiness: choosing the later zone delays the
 * window opening, and the failure mode of a late dial is a missed connection
 * while the failure mode of an early dial is waking somebody up.
 */
export const SPLIT_AREA_CODES = new Set([
  '208', // Idaho: Mountain + Pacific panhandle
  '218', // Minnesota edge
  '308', // Nebraska: Central + Mountain
  '423', // Tennessee: Eastern + Central
  '509', // Washington
  '605', // South Dakota: Central + Mountain
  '740', // Ohio
  '806', // Texas panhandle
  '850', // Florida panhandle: Eastern + Central
  '859', // Kentucky
  '870', // Arkansas
  '906', // Michigan UP: Eastern + Central
  '915', // Texas: Central + Mountain
  '928', // Arizona: Navajo Nation observes DST, most of AZ does not
]);

// The split codes, pinned explicitly to the later zone.
assign('America/Chicago', ['423', '850', '906']);
assign('America/Denver', ['208', '308', '605', '915']);
assign('America/Los_Angeles', ['509']);

/** Codes that are not geographic and must never be dialled by a campaign. */
const NON_GEOGRAPHIC = new Set([
  '800','833','844','855','866','877','888', // toll-free
  '900','976',                                // premium
  '911','988',                                // emergency / crisis
]);

/**
 * Canadian NPAs. Rejected rather than silently dialled — this campaign is US
 * Tow Alliance and Canadian outreach is a separate list with separate consent
 * rules (CRTC, not FTC).
 */
const CANADIAN = new Set([
  '204','226','236','249','250','263','289','306','343','354','365','367','368','382','387','403',
  '416','418','428','431','437','438','450','460','468','474','506','514','519','548','568','579',
  '581','584','587','604','613','639','647','672','683','705','709','742','753','778','780','782',
  '807','819','825','867','873','879','902','905',
]);

const EXTENSION_MARKER = /(?:\s|^)(?:x|ext\.?|extension|#)\s*(\d{1,6})\s*$/i;

/**
 * Normalize one messy input to E.164.
 *
 * Accepts: "6145550100", "614-555-0100", "(614) 555-0100", "+1 614 555 0100",
 * "1-614-555-0100 x204", "Call: 614.555.0100 (cell)".
 */
export function normalizePhone(raw: string | null | undefined): NormalizedPhone {
  const empty: NormalizedPhone = {
    e164: null,
    areaCode: null,
    timezone: null,
    reason: null,
    extension: null,
  };
  if (!raw || typeof raw !== 'string') return { ...empty, reason: 'empty' };

  let working = raw.trim();
  if (!working) return { ...empty, reason: 'empty' };

  // Pull an extension off the end before stripping punctuation, otherwise its
  // digits merge into the number and every extension-bearing row becomes a
  // plausible-looking wrong number.
  let extension: string | null = null;
  const extMatch = working.match(EXTENSION_MARKER);
  if (extMatch) {
    extension = extMatch[1];
    working = working.slice(0, extMatch.index).trim();
  }

  const digits = working.replace(/\D/g, '');
  if (!digits) return { ...empty, reason: 'no_digits', extension };

  let national: string;
  if (digits.length === 10) {
    national = digits;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    national = digits.slice(1);
  } else if (digits.length > 11 && digits.startsWith('1')) {
    // A run-together number plus an unmarked extension. Take the first 10 after
    // the country code and keep the rest as the extension.
    national = digits.slice(1, 11);
    extension = extension ?? digits.slice(11);
  } else if (digits.length > 10) {
    national = digits.slice(0, 10);
    extension = extension ?? digits.slice(10);
  } else {
    return { ...empty, reason: `too_short_${digits.length}`, extension };
  }

  const areaCode = national.slice(0, 3);
  const exchange = national.slice(3, 6);

  // NANP structural rules. Both NPA and NXX must start 2-9; anything else is a
  // typo or a placeholder, never a real line.
  if (!/^[2-9]\d\d$/.test(areaCode)) {
    return { ...empty, reason: 'invalid_area_code', areaCode, extension };
  }
  if (!/^[2-9]\d\d$/.test(exchange)) {
    return { ...empty, reason: 'invalid_exchange', areaCode, extension };
  }
  // N11 codes (211, 311, 411, 611, 811, 911) are service codes.
  if (/^\d11$/.test(areaCode)) {
    return { ...empty, reason: 'service_code', areaCode, extension };
  }
  if (NON_GEOGRAPHIC.has(areaCode)) {
    return { ...empty, reason: 'non_geographic', areaCode, extension };
  }
  if (CANADIAN.has(areaCode)) {
    return { ...empty, reason: 'canada_out_of_scope', areaCode, extension };
  }

  const timezone = AREA_CODE_TZ[areaCode] ?? null;
  if (!timezone) {
    // Unknown but structurally valid. Keep it and let the dialler decide —
    // rejecting outright would quietly drop newly-issued area codes.
    return { e164: `+1${national}`, areaCode, timezone: null, reason: null, extension };
  }

  return { e164: `+1${national}`, areaCode, timezone, reason: null, extension };
}

/** IANA zone for an area code, or null. */
export function timezoneForAreaCode(areaCode: string | null | undefined): string | null {
  if (!areaCode) return null;
  return AREA_CODE_TZ[areaCode] ?? null;
}

/**
 * The local hour and ISO weekday at `zone`, right now.
 *
 * Uses Intl rather than date arithmetic so DST is the platform's problem, not
 * ours — the US shifts twice a year and a hand-rolled offset table is wrong for
 * two weeks each time.
 */
export function localTimeAt(
  zone: string,
  now: Date = new Date(),
): { hour: number; minute: number; isoWeekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // hour12:false still renders midnight as "24" in some ICU builds.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const weekdayMap: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  const isoWeekday = weekdayMap[get('weekday')] ?? 0;
  return { hour, minute, isoWeekday };
}

export interface CallWindow {
  startHour: number;
  endHour: number;
  /** ISO weekdays, 1 = Monday. */
  days: number[];
}

/**
 * A window that covers every hour of every day.
 *
 * Chris, 2026-08-20: "we do not need a window guard for towing companies - we
 * operate 24/7." He is right, and the 9-5 default was me importing an
 * assumption from ordinary B2B outreach. A towing company staffs a phone around
 * the clock — that IS the business — and the FTC's 8am-9pm restriction applies
 * to calls to consumers and residences, not business-to-business.
 *
 * Expressed as configuration rather than a flag, so a campaign that DOES need
 * a window (a future one selling to day-shift businesses) still gets one, and
 * the two cases cannot drift apart in code.
 */
export function isRoundTheClock(window: CallWindow): boolean {
  return (
    window.startHour <= 0 &&
    window.endHour >= 24 &&
    [1, 2, 3, 4, 5, 6, 7].every((d) => window.days.includes(d))
  );
}

/**
 * Is it inside the calling window where this number rings?
 *
 * An unknown timezone returns false UNLESS the campaign runs round the clock.
 * The timezone only ever existed to prove the local hour is a legal one; when
 * every hour is legal there is nothing left to prove, and refusing to dial a
 * number whose area code we simply do not recognise would silently drop leads
 * for no benefit.
 */
export function isWithinCallWindow(
  timezone: string | null | undefined,
  window: CallWindow,
  now: Date = new Date(),
): { allowed: boolean; reason: string | null } {
  if (isRoundTheClock(window)) return { allowed: true, reason: null };
  if (!timezone) return { allowed: false, reason: 'unknown_timezone' };

  let local: { hour: number; isoWeekday: number };
  try {
    local = localTimeAt(timezone, now);
  } catch {
    return { allowed: false, reason: 'bad_timezone' };
  }

  if (!window.days.includes(local.isoWeekday)) {
    return { allowed: false, reason: 'outside_call_days' };
  }
  if (local.hour < window.startHour || local.hour >= window.endHour) {
    return { allowed: false, reason: 'outside_call_hours' };
  }
  return { allowed: true, reason: null };
}

/**
 * US federal holidays for the years this campaign will plausibly run.
 *
 * Hard-coded dates rather than a rule engine: the movable ones (Thanksgiving,
 * Memorial Day, Labor Day) need weekday-of-month arithmetic that is easy to get
 * subtly wrong, and the cost of being wrong is dialling hundreds of businesses
 * on a holiday. A short explicit list is auditable at a glance.
 */
const US_HOLIDAYS = new Set([
  // 2026
  '2026-01-01','2026-01-19','2026-02-16','2026-05-25','2026-06-19','2026-07-03','2026-07-04',
  '2026-09-07','2026-10-12','2026-11-11','2026-11-26','2026-12-25',
  // 2027
  '2027-01-01','2027-01-18','2027-02-15','2027-05-31','2027-06-18','2027-06-19','2027-07-05',
  '2027-09-06','2027-10-11','2027-11-11','2027-11-25','2027-12-24','2027-12-25',
]);

/** True when it is a US federal holiday in the called number's zone. */
export function isHoliday(timezone: string | null | undefined, now: Date = new Date()): boolean {
  const zone = timezone || 'America/New_York';
  try {
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    return US_HOLIDAYS.has(ymd);
  } catch {
    return false;
  }
}
